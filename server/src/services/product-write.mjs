// Single-product create / update — the write path behind the admin
// "Add product" / "Edit product" form.
//
// The bulk importer (catalog.mjs importProducts) deliberately tolerates messy
// spreadsheet rows and renames duplicate SKUs. A human filling in ONE form
// needs the opposite: strict validation with field-level errors, a hard
// "SKU already exists" conflict, a category that must really exist, and
// images that are stored permanently in the same transaction as the row —
// with any files written for a failed transaction removed again, so neither
// an orphan product nor an orphan image is ever left behind.
import { z } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { put, getUrl, remove as removeStored, supportedMime } from "../lib/storage.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { resolveCategory, resolveSubcategory, hasImageMagic, IMAGE_MAX_BYTES, slugify } from "./catalog.mjs";
import { recordEvent } from "./events.mjs";

const MAX_IMAGES = 10;
const UPLOAD_TOKEN = /^upload:(\d+)$/;

const optText = (max) => z.union([z.string().trim().max(max), z.null()]).optional();
const optNum = z.union([z.number().finite(), z.null()]).optional();
const optInt = (min, max) => z.union([z.number().int().min(min).max(max), z.null()]).optional();

const uploadSchema = z.object({
  name: z.string().max(200).optional(),
  mime: z.string().max(100),
  dataBase64: z.string().min(1),
});

export const productWriteSchema = z.object({
  name: z.string().trim().min(2, "Product name must be at least 2 characters").max(200),
  sku: z.string().trim().min(2, "SKU must be at least 2 characters").max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, "SKU may contain letters, numbers, dots, dashes and underscores"),
  // Either a real category id (preferred — the dropdown) or a name.
  categoryId: optText(64),
  category: optText(120),
  subcategoryId: optText(64),
  subcategory: optText(120),
  description: optText(5000),
  length: optNum,
  width: optNum,
  height: optNum,
  dimUnit: z.union([z.enum(["in", "cm", "mm"]), z.null()]).optional(),
  gsm: optInt(0, 5000),
  // color / sizeLabel hold a comma-separated LIST ("Brown, White, Black",
  // "6x6x4 in, 8x8x6 in, …") in the existing text columns, so they get room
  // for up to MAX_OPTION_VALUES entries.
  color: optText(2000),
  material: optText(120),
  productType: optText(120),
  thickness: optText(60),
  sizeLabel: optText(2000),
  basePriceMinor: z.number().int().min(0, "Price cannot be negative").max(1_000_000_000).optional(),
  salePriceMinor: optInt(0, 1_000_000_000),
  moq: z.number().int().min(1, "MOQ must be at least 1").max(100_000_000).optional(),
  stock: z.number().int().min(0, "Stock cannot be negative").max(1_000_000_000).optional(),
  lowStockLevel: optInt(0, 1_000_000_000),
  status: z.enum(["draft", "active", "archived"]).optional(),
  // Homepage merchandising (admin-controlled; see schema.prisma). Order is an
  // optional positive integer; it is forced to null whenever its flag is off.
  isFeatured: z.boolean().optional(),
  featuredOrder: optInt(1, 999_999),
  isNewArrival: z.boolean().optional(),
  newArrivalOrder: optInt(1, 999_999),
  // Ordered gallery: existing URLs and/or "upload:N" tokens into imageUploads.
  images: z.array(z.string().max(1000)).max(MAX_IMAGES).optional(),
  imageUploads: z.array(uploadSchema).max(MAX_IMAGES).optional(),
  variants: z.array(z.record(z.string(), z.unknown())).optional(),
}).strict();

/** Cross-field rules zod cannot express per key. */
function validateShape(p) {
  const dims = [p.length, p.width, p.height].map((v) => (v == null ? null : v));
  const given = dims.filter((v) => v != null);
  if (given.length > 0 && given.length < 3) {
    throw badRequest("Enter length, width and height together (or leave all three blank)", "DIMENSIONS_PARTIAL");
  }
  if (given.some((v) => v <= 0)) throw badRequest("Dimensions must be greater than 0", "DIMENSIONS_INVALID");
  if (given.length === 3 && !p.dimUnit) throw badRequest("Choose a dimension unit", "DIM_UNIT_REQUIRED");
  if (p.salePriceMinor != null && p.basePriceMinor != null && p.salePriceMinor > p.basePriceMinor) {
    throw badRequest("Sale price cannot exceed the base price", "SALE_PRICE_INVALID");
  }
}

/** Decode + validate an upload WITHOUT writing it yet. */
function decodeUpload(u, index) {
  const mime = String(u.mime ?? "").toLowerCase();
  if (!supportedMime(mime) || !mime.startsWith("image/")) {
    throw badRequest(`Image ${index + 1}: unsupported type ${u.mime || "(none)"} — use JPG, PNG or WebP`, "BAD_IMAGE_TYPE");
  }
  const buffer = Buffer.from(String(u.dataBase64 ?? ""), "base64");
  if (buffer.length === 0) throw badRequest(`Image ${index + 1} is empty`, "EMPTY_IMAGE");
  if (buffer.length > IMAGE_MAX_BYTES) throw badRequest(`Image ${index + 1} is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB`, "IMAGE_TOO_LARGE");
  if (!hasImageMagic(buffer, mime)) throw badRequest(`Image ${index + 1} is not a valid ${mime.split("/")[1].toUpperCase()} file`, "CORRUPT_IMAGE");
  return { name: u.name || `image-${index + 1}`, mime, buffer };
}

const isStoredUrl = (s) => typeof s === "string" && /^(https?:\/\/|\/)/.test(s) && !/^blob:|^data:/.test(s);

/**
 * Resolve the final ordered image list: keep stored URLs, replace "upload:N"
 * tokens with freshly stored files. Returns { images, writtenKeys } so the
 * caller can delete the files if the transaction later fails.
 */
function materializeImages(images, uploads) {
  const decoded = (uploads ?? []).map(decodeUpload);
  const writtenKeys = [];
  const written = new Map();
  const out = [];
  const source = images && images.length ? images : decoded.map((_, i) => `upload:${i}`);
  for (const entry of source) {
    const m = UPLOAD_TOKEN.exec(String(entry));
    if (m) {
      const idx = Number(m[1]);
      const file = decoded[idx];
      if (!file) throw badRequest(`Image reference ${entry} has no matching upload`, "IMAGE_REF_INVALID");
      if (!written.has(idx)) {
        const key = put(file);
        writtenKeys.push(key);
        written.set(idx, getUrl(key));
      }
      out.push(written.get(idx));
    } else if (isStoredUrl(entry)) {
      out.push(entry);
    } else if (typeof entry === "string" && /^(blob:|data:)/.test(entry)) {
      throw badRequest("Images must be uploaded — a browser preview URL cannot be saved", "IMAGE_NOT_UPLOADED");
    }
    // Anything else (an emoji placeholder) is dropped: only real files are stored.
  }
  return { images: [...new Set(out)].slice(0, MAX_IMAGES), writtenKeys };
}

const storageKeyOf = (url) => String(url).split("/").pop();

/** Remove stored files no longer referenced by any product. */
async function removeUnreferenced(urls) {
  for (const url of urls) {
    if (!isStoredUrl(url)) continue;
    try {
      const stillUsed = await prisma.product.count({ where: { images: { has: url } } });
      if (stillUsed === 0) removeStored(storageKeyOf(url));
    } catch (e) {
      console.warn("[catalog] could not remove old image", url, e.message);
    }
  }
}

async function assertSkuFree(sku, excludeId = null) {
  const hit = await prisma.product.findFirst({
    where: { sku: { equals: sku, mode: "insensitive" }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, sku: true, deletedAt: true },
  });
  if (hit) throw conflict(`SKU "${hit.sku}" already exists${hit.deletedAt ? " (on an archived product)" : ""}. Use a different SKU.`, "SKU_EXISTS");
}

/**
 * Resolve the taxonomy for a write. An explicit id must exist (400 otherwise);
 * a name is resolved / created the same way the importer does.
 */
async function resolveTaxonomy(p, { required, keep = {} }) {
  let category = null;
  if (p.categoryId) {
    category = await prisma.category.findFirst({ where: { id: p.categoryId, deletedAt: null, parentId: null } });
    if (!category) throw badRequest("Category not found — refresh the category list and try again", "CATEGORY_NOT_FOUND");
    // An inactive category keeps the products it already has, but takes no
    // new ones. `keep` = the product's current ids, which are always allowed.
    if (!category.isActive && p.categoryId !== keep.categoryId) throw badRequest(`${category.name} is inactive — activate it or choose another category`, "CATEGORY_INACTIVE");
  } else if (p.category) {
    category = await resolveCategory(p.category);
  }
  if (required && !category) throw badRequest("Choose a category", "CATEGORY_REQUIRED");

  let subcategory = null;
  if (category && p.subcategoryId) {
    subcategory = await prisma.category.findFirst({ where: { id: p.subcategoryId, deletedAt: null, parentId: category.id } });
    if (!subcategory) throw badRequest("Subcategory not found under the chosen category", "SUBCATEGORY_NOT_FOUND");
    if (!subcategory.isActive && p.subcategoryId !== keep.subcategoryId) throw badRequest(`${subcategory.name} is inactive — activate it or choose another subcategory`, "SUBCATEGORY_INACTIVE");
  } else if (category && p.subcategory && String(p.subcategory).toLowerCase() !== "general") {
    subcategory = await resolveSubcategory(p.subcategory, category);
  }
  return { category, subcategory };
}

async function nextProductId(tx) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `PRD-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await tx.product.findUnique({ where: { id }, select: { id: true } }))) return id;
  }
  return `PRD-${Date.now().toString().slice(-8)}`;
}

async function uniqueSlug(name, sku, tx, excludeId = null) {
  const base = slugify(`${name}-${sku}`, slugify(sku, "product"));
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const hit = await tx.product.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString().slice(-5)}`;
}

/** Columns copied 1:1 from the validated payload when present. */
const SCALARS = [
  "name", "description", "length", "width", "height", "dimUnit", "gsm", "color", "material",
  "productType", "thickness", "sizeLabel", "basePriceMinor", "salePriceMinor", "moq", "stock",
  "lowStockLevel", "status", "variants",
  "isFeatured", "featuredOrder", "isNewArrival", "newArrivalOrder",
];

function scalarData(p) {
  const data = {};
  for (const k of SCALARS) if (p[k] !== undefined) data[k] = p[k];
  if (data.description === "") data.description = null;
  // A rail's order only means something while its flag is on.
  if (data.isFeatured === false) data.featuredOrder = null;
  if (data.isNewArrival === false) data.newArrivalOrder = null;
  if (p.length == null && p.width == null && p.height == null && (p.length !== undefined || p.width !== undefined || p.height !== undefined)) {
    data.length = null; data.width = null; data.height = null; data.dimUnit = null;
  }
  return data;
}

/** Create one product. Everything is validated before any file is written. */
export async function createProduct(input, { actorId = null } = {}) {
  const p = productWriteSchema.parse(input ?? {});
  validateShape(p);
  await assertSkuFree(p.sku);
  const { category, subcategory } = await resolveTaxonomy(p, { required: true });

  const { images, writtenKeys } = materializeImages(p.images, p.imageUploads);
  try {
    const product = await prisma.$transaction(async (tx) => {
      const id = await nextProductId(tx);
      const row = await tx.product.create({
        data: {
          id,
          sku: p.sku,
          slug: await uniqueSlug(p.name, p.sku, tx),
          ...scalarData(p),
          status: p.status ?? "draft",
          moq: p.moq ?? 1,
          stock: p.stock ?? 0,
          basePriceMinor: p.basePriceMinor ?? 0,
          category: category.name,
          categoryId: category.id,
          subcategory: subcategory?.name ?? "General",
          subcategoryId: subcategory?.id ?? null,
          images,
          imageEmoji: images[0] ?? "📦",
          variants: p.variants ?? [],
        },
      });
      if ((p.stock ?? 0) > 0) {
        // Opening stock goes into the inventory ledger so Inventory → history
        // can explain where the on-hand quantity came from.
        await tx.stockMovement.create({
          data: { productId: row.id, type: "RECEIPT", quantity: p.stock, balance: p.stock, reason: "Opening stock (product created)", refType: "product_form", actorId },
        });
      }
      await recordEvent({ eventType: "product.created", actorId, entityType: "Product", entityId: row.id, metadata: { sku: row.sku, name: row.name, category: row.category, images: images.length } }, tx);
      return row;
    });
    return product;
  } catch (e) {
    // Roll back the files written for this attempt — no orphan images.
    for (const key of writtenKeys) { try { removeStored(key); } catch { /* ignore */ } }
    if (e?.code === "P2002") throw conflict("SKU already exists. Use a different SKU.", "SKU_EXISTS");
    throw e;
  }
}

/** Update one product (partial: only supplied fields change). */
export async function updateProduct(id, input, { actorId = null } = {}) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw notFound("Product not found");
  const p = productWriteSchema.partial({ name: true, sku: true }).parse(input ?? {});
  validateShape({ ...existing, ...p });
  if (p.sku && p.sku !== existing.sku) await assertSkuFree(p.sku, id);

  const wantsTaxonomy = p.categoryId !== undefined || p.category !== undefined || p.subcategoryId !== undefined || p.subcategory !== undefined;
  const { category, subcategory } = wantsTaxonomy
    ? await resolveTaxonomy({ ...p, category: p.category ?? (p.categoryId ? undefined : existing.category) }, { required: false, keep: { categoryId: existing.categoryId, subcategoryId: existing.subcategoryId } })
    : { category: null, subcategory: null };

  const wantsImages = p.images !== undefined || (p.imageUploads && p.imageUploads.length > 0);
  const { images, writtenKeys } = wantsImages ? materializeImages(p.images ?? [...existing.images], p.imageUploads) : { images: null, writtenKeys: [] };

  try {
    const product = await prisma.$transaction(async (tx) => {
      const data = scalarData(p);
      if ((p.isFeatured ?? existing.isFeatured) === false) data.featuredOrder = null;
      if ((p.isNewArrival ?? existing.isNewArrival) === false) data.newArrivalOrder = null;
      if (p.sku && p.sku !== existing.sku) data.sku = p.sku;
      if (p.name && p.name !== existing.name) data.slug = await uniqueSlug(p.name, p.sku ?? existing.sku, tx, id);
      if (category) {
        data.category = category.name;
        data.categoryId = category.id;
        data.subcategory = subcategory?.name ?? "General";
        data.subcategoryId = subcategory?.id ?? null;
      }
      if (images) {
        data.images = images;
        data.imageEmoji = images[0] ?? "📦";
      }
      const row = await tx.product.update({ where: { id }, data });
      if (p.stock !== undefined && p.stock !== existing.stock) {
        // Signed delta + resulting balance, matching services/inventory.mjs.
        await tx.stockMovement.create({
          data: { productId: id, type: "ADJUSTMENT", quantity: p.stock - existing.stock, balance: p.stock, reason: "Edited in product form", refType: "product_form", actorId },
        });
      }
      await recordEvent({ eventType: "product.updated", actorId, entityType: "Product", entityId: id, metadata: { sku: row.sku, fields: Object.keys(data) } }, tx);
      return row;
    });
    if (images) {
      const dropped = existing.images.filter((u) => !images.includes(u));
      await removeUnreferenced(dropped);
    }
    return product;
  } catch (e) {
    for (const key of writtenKeys) { try { removeStored(key); } catch { /* ignore */ } }
    if (e?.code === "P2002") throw conflict("SKU already exists. Use a different SKU.", "SKU_EXISTS");
    throw e;
  }
}
