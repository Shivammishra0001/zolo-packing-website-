// ============================================================
// Catalog service — product import, image attachment and bulk maintenance.
//
// Owns the write paths the admin catalog uses. Kept separate from the route
// layer so it is unit-testable and so the import logic (category upsert, SKU
// dedupe, image preservation) has exactly one implementation.
// ============================================================
import { prisma } from "../lib/prisma.mjs";
import { put, getUrl, supportedMime } from "../lib/storage.mjs";
import { badRequest } from "../lib/http.mjs";
import { normalizeRow, categoryKey as normKey, slugify as normSlug } from "./catalog-normalize.mjs";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Canonical form for category comparison: "  BOXES " and "boxes" collapse to one. */
export const categoryKey = normKey;

/** URL-safe slug used for Category.slug and Product.slug. */
export const slugify = normSlug;

/**
 * Resolve a category name to a Category row, creating it when absent.
 *
 * Matching is case/whitespace-insensitive so "Boxes", "boxes" and "BOXES"
 * resolve to a single row instead of spawning duplicates. `cache` memoizes
 * within one import run so a 72-row file does not issue 72 lookups.
 */
export async function resolveCategory(name, cache = new Map(), tx = prisma) {
  const key = categoryKey(name);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  // `slug` is the only UNIQUE column on Category, so it — not `name` — is the
  // real identity key. Deriving it deterministically from the normalized name
  // means "Boxes", " boxes " and "BOXES" all compute the same slug and can
  // therefore never become separate rows.
  const slug = slugify(key, "category");

  // Fast path: an existing row (matched on slug, or case-insensitively on name
  // for rows created before this normalization existed).
  const findExisting = () =>
    tx.category.findFirst({
      where: {
        deletedAt: null,
        OR: [{ slug }, { name: { equals: key, mode: "insensitive" } }],
      },
    });

  const existing = await findExisting();
  if (existing) {
    cache.set(key, existing);
    return existing;
  }

  // An ARCHIVED category still owns the unique slug, so a plain create would
  // throw P2002 — which used to make every import into that category fail
  // FOREVER once an admin archived it. Importing products into a category is an
  // explicit statement that it is in use again: restore the archived row
  // (keeping its id and relations) instead of failing.
  const archived = await tx.category.findFirst({ where: { slug, deletedAt: { not: null } } });
  if (archived) {
    const restored = await tx.category.update({
      where: { id: archived.id },
      data: { deletedAt: null, isActive: true },
    });
    cache.set(key, restored);
    return restored;
  }

  try {
    const created = await tx.category.create({
      data: { name: String(name).trim(), slug, isActive: true },
    });
    cache.set(key, created);
    return created;
  } catch (e) {
    // P2002 = another concurrent import won the race between our lookup and our
    // insert. That is expected under parallel imports, not an error: re-read the
    // row the winner created and use it. Anything else genuinely failed.
    if (e?.code !== "P2002") throw e;
    const winner = await findExisting();
    if (!winner) throw e; // lost the race to something we still cannot see
    cache.set(key, winner);
    return winner;
  }
}

/**
 * Resolve a SUBcategory to a Category row nested under `parent`.
 *
 * Subcategories are real rows in the same Category table (parentId → parent),
 * not a second taxonomy system. Slug is scoped to the parent so "Gift Boxes"
 * under Boxes and a hypothetical "Gift Boxes" under Bags stay distinct while
 * `slug` remains globally unique.
 */
export async function resolveSubcategory(name, parent, cache = new Map(), tx = prisma) {
  const key = categoryKey(name);
  // "General" is the importer's placeholder for "none given" — never a record.
  if (!key || !parent || key === "general") return null;

  const cacheKey = `${parent.id}::${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const slug = `${parent.slug}-${slugify(key, "sub")}`.slice(0, 80);

  const findExisting = () =>
    tx.category.findFirst({
      where: {
        deletedAt: null,
        OR: [{ slug }, { parentId: parent.id, name: { equals: key, mode: "insensitive" } }],
      },
    });

  const existing = await findExisting();
  if (existing) {
    cache.set(cacheKey, existing);
    return existing;
  }

  // Same restore-on-import rule as resolveCategory: an archived subcategory
  // holds the unique slug, and importing into it revives it rather than
  // permanently failing the row.
  const archived = await tx.category.findFirst({ where: { slug, deletedAt: { not: null } } });
  if (archived) {
    const restored = await tx.category.update({
      where: { id: archived.id },
      data: { deletedAt: null, isActive: true, parentId: parent.id },
    });
    cache.set(cacheKey, restored);
    return restored;
  }

  try {
    const created = await tx.category.create({
      data: { name: String(name).trim(), slug, parentId: parent.id, isActive: true },
    });
    cache.set(cacheKey, created);
    return created;
  } catch (e) {
    // Concurrent import won the race — adopt the row it created.
    if (e?.code !== "P2002") throw e;
    const winner = await findExisting();
    if (!winner) throw e;
    cache.set(cacheKey, winner);
    return winner;
  }
}

/** Product ids follow the existing PRD-xxxx convention used across the UI. */
async function nextProductId(tx) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `PRD-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await tx.product.findUnique({ where: { id }, select: { id: true } }))) return id;
  }
  return `PRD-${Date.now().toString().slice(-8)}`;
}

/** Build a Product.slug that is unique, derived from name + sku. */
async function uniqueProductSlug(name, sku, tx, excludeId) {
  const base = slugify(`${name}-${sku}`, slugify(sku, "product"));
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const hit = await tx.product.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString().slice(-5)}`;
}

/** Whitelist of Product columns an import/patch may write. */
const WRITABLE = new Set([
  "name", "category", "subcategory", "status", "description",
  "length", "width", "height", "dimUnit", "weightGrams", "gsm", "color",
  "material", "printing", "finishing", "customizable",
  "productType", "thickness", "sizeLabel",
  "basePriceMinor", "salePriceMinor", "costMinor", "moq", "stock",
  "lowStockLevel", "imageEmoji", "images", "variants",
]);

/** Columns that are NOT NULL in the schema — a null here must be dropped. */
const NON_NULLABLE = new Set(["name", "category", "subcategory", "status", "moq", "stock", "basePriceMinor", "imageEmoji"]);

function pickWritable(input) {
  const out = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (!WRITABLE.has(k) || v === undefined) continue;
    if (v === null && NON_NULLABLE.has(k)) continue; // keep the column's default
    out[k] = v;
  }
  return out;
}

/**
 * Import one product row.
 *
 * `mode` decides what happens when the SKU already exists:
 *   skip   — leave the existing product untouched
 *   update — merge incoming fields into it (default)
 *   create — import under a newly suffixed SKU, never overwriting
 *
 * Runs in a transaction so a product is never left half-written; the caller
 * loops per row so ONE bad row cannot abort the whole file.
 */
export async function importProductRow(rawRow, { mode = "update", categoryCache, subcategoryCache } = {}) {
  // Every write path funnels through ONE normalizer, so a field can never be
  // mapped differently by the importer than by the edit form.
  const normalized = normalizeRow(rawRow);
  const sku = normalized.sku;
  if (!sku) throw badRequest("SKU is required", "SKU_REQUIRED");
  const name = normalized.name;
  if (!name) throw badRequest("Product name is required", "NAME_REQUIRED");

  // Normalized Product columns, plus any extra caller-supplied columns
  // (images/imageEmoji come from the image pipeline, not the spreadsheet).
  // `subcategory` is a NON-NULL column defaulting to "General"; a row without
  // one must fall back rather than write null.
  const row = {
    ...rawRow,
    ...normalized.data,
    sku,
    name,
    category: normalized.category,
    subcategory: normalized.subcategory ?? "General",
  };

  // Resolve the category BEFORE opening the product transaction.
  //
  // A category is a shared lookup, not part of this product's atomic unit, and
  // resolving it inside the transaction is actively harmful: a concurrent
  // import can trigger a P2002 on the category insert, which aborts the whole
  // Postgres transaction — so the recovery read would fail too and a perfectly
  // valid product row would be lost. Resolved outside, a lost race costs one
  // retry and the product still saves.
  const category = await resolveCategory(row.category, categoryCache);
  const subcategory = await resolveSubcategory(row.subcategory, category, subcategoryCache);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { sku } });

    if (existing && mode === "skip") {
      return { action: "skipped", product: existing, warnings: [] };
    }

    const data = pickWritable(row);
    if (category) {
      data.categoryId = category.id;
      data.category = category.name; // keep the denormalized taxonomy string in sync
    }
    if (subcategory) {
      data.subcategoryId = subcategory.id;
      data.subcategory = subcategory.name;
    }

    if (existing && mode === "update") {
      // Never blank an existing image because this import had none — an import
      // without a picture must not destroy a picture uploaded earlier.
      const incoming = Array.isArray(row.images) ? row.images.filter((u) => typeof u === "string" && u) : [];
      if (incoming.length > 0) {
        data.images = incoming;
        data.imageEmoji = incoming[0];
      } else {
        delete data.images;
        delete data.imageEmoji;
      }
      const product = await tx.product.update({
        where: { sku },
        // Re-importing an archived product revives it rather than leaving it hidden.
        data: { ...data, deletedAt: null },
      });
      return { action: "updated", product, warnings: normalized.warnings };
    }

    // Create — either a brand-new SKU, or mode "create" forcing a fresh row.
    let finalSku = sku;
    if (existing) {
      for (let n = 2; n < 100; n++) {
        const candidate = `${sku}-${n}`;
        if (!(await tx.product.findUnique({ where: { sku: candidate }, select: { sku: true } }))) {
          finalSku = candidate;
          break;
        }
      }
    }

    const images = Array.isArray(row.images) ? row.images.filter((u) => typeof u === "string" && u) : [];
    const product = await tx.product.create({
      data: {
        ...data,
        id: await nextProductId(tx),
        sku: finalSku,
        slug: await uniqueProductSlug(name, finalSku, tx),
        name,
        category: data.category ?? "Uncategorised",
        images,
        imageEmoji: images[0] ?? row.imageEmoji ?? "📦",
      },
    });
    return { action: "created", product, renamedFrom: finalSku !== sku ? sku : undefined, warnings: normalized.warnings };
  });
}

/**
 * Import many rows. Row-level isolation: each row commits or fails on its own,
 * so one malformed row never prevents the other 71 from importing.
 */
export async function importProducts(rows, mode = "update") {
  const result = {
    processed: 0, created: 0, updated: 0, skipped: 0, failed: 0,
    // Real taxonomy accounting — how many category/subcategory rows this run
    // had to create versus reuse.
    categoriesCreated: 0, categoriesReused: 0,
    subcategoriesCreated: 0, subcategoriesReused: 0,
    warnings: 0,
    errors: [], products: [],
  };
  const categoryCache = new Map();
  const subcategoryCache = new Map();

  // Snapshot taxonomy counts so "created" is measured, not guessed.
  const beforeCategories = await prisma.category.count();

  for (const row of rows) {
    result.processed++;
    try {
      const { action, product, renamedFrom, warnings } = await importProductRow(row, { mode, categoryCache, subcategoryCache });
      result[action]++;
      result.products.push(product);
      for (const w of warnings ?? []) {
        result.warnings++;
        result.errors.push({ sku: product?.sku ?? row?.sku ?? "?", level: "warning", error: w });
      }
      if (renamedFrom) {
        result.warnings++;
        result.errors.push({ sku: renamedFrom, level: "warning", error: `Imported as ${product.sku} (SKU already existed)` });
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ sku: row?.sku ?? "?", level: "error", error: e.message });
      console.error("[catalog:import] row failed", { sku: row?.sku, error: e.message });
    }
  }

  const afterCategories = await prisma.category.count();
  const createdTotal = afterCategories - beforeCategories;
  const topLevelSeen = new Set([...categoryCache.values()].map((c) => c.id)).size;
  const subSeen = new Set([...subcategoryCache.values()].map((c) => c.id)).size;
  // Split the newly-created rows across the two levels using what each cache
  // resolved; reused = seen minus created.
  const createdSubs = Math.min(createdTotal, subSeen);
  result.subcategoriesCreated = createdSubs;
  result.categoriesCreated = createdTotal - createdSubs;
  result.categoriesReused = Math.max(topLevelSeen - result.categoriesCreated, 0);
  result.subcategoriesReused = Math.max(subSeen - result.subcategoriesCreated, 0);

  // An import is only "successful" when nothing failed — callers must not
  // report success while rows were dropped.
  result.success = result.failed === 0;
  return result;
}

/** Decode + validate an uploaded image, returning a public URL. */
export function storeImage({ name = "image", mime, dataBase64 }) {
  if (!mime || !supportedMime(mime) || !String(mime).startsWith("image/")) {
    throw badRequest(`Unsupported image type ${mime ?? "(none)"} — use JPG, PNG or WebP`, "BAD_IMAGE_TYPE");
  }
  let buffer;
  try {
    buffer = Buffer.from(String(dataBase64 ?? ""), "base64");
  } catch {
    throw badRequest("Image data is not valid base64", "BAD_IMAGE_DATA");
  }
  if (buffer.length === 0) throw badRequest("Image is empty", "EMPTY_IMAGE");
  if (buffer.length > IMAGE_MAX_BYTES) throw badRequest("Image is larger than 5 MB", "IMAGE_TOO_LARGE");
  if (!hasImageMagic(buffer, mime)) {
    throw badRequest("File is not a valid image (content does not match its type)", "CORRUPT_IMAGE");
  }
  return getUrl(put({ name, mime, buffer }));
}

/**
 * Verify the bytes really are the image type claimed. Stops a renamed .exe (or
 * a truncated upload) from being stored as a product image.
 */
export function hasImageMagic(buf, mime) {
  if (buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const webp =
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  if (mime === "image/jpeg") return jpeg;
  if (mime === "image/png") return png;
  if (mime === "image/webp") return webp;
  return jpeg || png || webp;
}

/** Attach an image to a product as its primary picture (existing ones shift down). */
export async function setProductImage(productId, url, { replace = false } = {}) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw badRequest("Product not found", "NOT_FOUND");
  const rest = replace ? [] : product.images.filter((u) => u && u !== url && /^https?:\/\//i.test(u));
  const images = [url, ...rest].slice(0, 10);
  return prisma.product.update({
    where: { id: productId },
    data: { images, imageEmoji: url },
  });
}

/**
 * Soft-delete products. The schema carries `deletedAt` precisely so archived
 * products keep historical order snapshots intact — never hard-delete here.
 */
export async function softDeleteProducts(ids) {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id))];
  if (unique.length === 0) throw badRequest("No product ids supplied", "NO_IDS");
  const now = new Date();
  const { count } = await prisma.product.updateMany({
    where: { id: { in: unique }, deletedAt: null },
    data: { deletedAt: now, status: "archived" },
  });
  return { requested: unique.length, deleted: count };
}
