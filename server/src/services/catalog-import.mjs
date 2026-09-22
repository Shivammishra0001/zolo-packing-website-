// Catalog import v2 — simple AND variable products, validated first, written
// in ONE transaction.
//
// The client (import wizard) parses the spreadsheet, maps columns and groups
// rows into products (same Product ID / name ⇒ one product, one row per
// variant). It sends the grouped shape below; the server re-validates all of
// it (never trusts the client), answers a dry-run summary for the Validation
// step, and on confirmation writes everything or nothing.
//
//   {
//     products: [{
//       productId?, sku?, name, kind: "simple" | "variable",
//       category, subcategory?, description?, material?, gsm?, thickness?,
//       brand?, manufacturer?, productType?, status?, featured?, images?: [url],
//       // simple products: price / stock / moq / size / color live here
//       priceMinor?, compareAtPriceMinor?, stock?, moq?, sizeLabel?, color?, weightGrams?, length?, width?, height?, dimUnit?,
//       // variable products:
//       variantOptions?: [{ name, values }],   // optional — derived from the variants when absent
//       variants?: [{ sku?, attributes: { Size: "6x6x4", Color: "Kraft Brown" }, priceMinor?, compareAtPriceMinor?, stock?, moq?, weightGrams?, length?, width?, height?, dimUnit?, material?, thickness?, image?, isActive? }]
//     }],
//     mode: "update" | "skip",        // what to do with a product that already exists
//     createCategories: boolean        // unknown category → create (true) or error (false)
//   }
import { prisma } from "../lib/prisma.mjs";
import { badRequest } from "../lib/http.mjs";
import { resolveCategory, resolveSubcategory, slugify } from "./catalog.mjs";
import { normalizeOptions, prepareVariants, syncVariants, generateSku } from "./variants.mjs";
import { recordEvent } from "./events.mjs";

const text = (v) => { const s = String(v ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(); return s || null; };
// Numbers: currency symbols, thousands separators and units are tolerated
// ("₹1,200", "500 pcs"); letters in place of a number are NOT (→ NaN → error).
const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/^[₹$€£]\s*/, "").replace(/,/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:[a-z%]{0,6})?$/i);
  return m ? Number(m[1]) : NaN;
};
const int = (v) => { const n = num(v); return n == null || Number.isNaN(n) ? n : Math.round(n); };
const VALID_STATUS = new Set(["draft", "active", "archived"]);
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,59}$/;

/** Product ids follow PRD-xxxx; a caller's "Product ID" is only a matching key. */
async function nextProductId(tx) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `PRD-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await tx.product.findUnique({ where: { id }, select: { id: true } }))) return id;
  }
  return `PRD-${Date.now().toString().slice(-8)}`;
}
async function uniqueSlug(name, sku, tx, excludeId) {
  const base = slugify(`${name}-${sku}`, slugify(sku, "product"));
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const hit = await tx.product.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === excludeId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString().slice(-5)}`;
}

/** Derive option axes from the variants' attribute keys (in first-seen order). */
function optionsFromVariants(variants) {
  const axes = new Map();
  for (const v of variants) for (const [k, val] of Object.entries(v.attributes ?? {})) {
    const key = text(k); const value = text(val);
    if (!key || !value) continue;
    if (!axes.has(key)) axes.set(key, []);
    if (!axes.get(key).includes(value)) axes.get(key).push(value);
  }
  return [...axes].map(([name, values]) => ({ name, values }));
}

/**
 * Normalise + validate one grouped product. Pushes into `errors`/`warnings`
 * (with the product's name/id for the wizard) and returns the clean record
 * (or null when it cannot be imported).
 */
function normalizeProduct(raw, i, errors, warnings) {
  const ref = text(raw.productId) ?? text(raw.sku) ?? text(raw.name) ?? `row ${i + 1}`;
  const err = (message, field = null) => errors.push({ product: ref, field, message });
  const warn = (message, field = null) => warnings.push({ product: ref, field, message });

  const name = text(raw.name);
  if (!name) { err("Product Name is required", "name"); return null; }
  const kindRaw = String(raw.kind ?? raw.type ?? "").trim().toLowerCase();
  const variants = Array.isArray(raw.variants) ? raw.variants : [];
  const kind = kindRaw === "variable" || (kindRaw !== "simple" && variants.length > 1) ? "variable" : "simple";
  const category = text(raw.category);
  if (!category) err("Category is required", "category");
  const statusRaw = (text(raw.status) ?? "draft").toLowerCase();
  if (!VALID_STATUS.has(statusRaw)) warn(`Unknown status "${statusRaw}" — imported as draft`, "status");
  const gsm = int(raw.gsm); if (Number.isNaN(gsm)) err("GSM must be a number", "gsm");
  const images = (Array.isArray(raw.images) ? raw.images : [raw.image]).map((u) => text(u)).filter(Boolean);

  const base = {
    ref, productId: text(raw.productId), name, kind, category, subcategory: text(raw.subcategory),
    description: text(raw.description), material: text(raw.material), gsm: Number.isNaN(gsm) ? null : gsm,
    thickness: text(raw.thickness), brand: text(raw.brand), manufacturer: text(raw.manufacturer), productType: text(raw.productType ?? raw.type),
    status: VALID_STATUS.has(statusRaw) ? statusRaw : "draft",
    isFeatured: ["1", "true", "yes", "y"].includes(String(raw.featured ?? raw.isFeatured ?? "").trim().toLowerCase()),
    images,
  };

  if (kind === "simple") {
    const v = variants[0] ?? raw;
    const sku = text(v.sku ?? raw.sku) ?? text(raw.productId);
    if (!sku) err("SKU is required", "sku"); else if (!SKU_RE.test(sku)) err(`SKU "${sku}" may only use letters, numbers, . _ - /`, "sku");
    const priceMinor = v.priceMinor != null ? int(v.priceMinor) : raw.priceMinor != null ? int(raw.priceMinor) : (num(v.price ?? raw.price) == null ? null : Math.round(num(v.price ?? raw.price) * 100));
    if (Number.isNaN(priceMinor) || (priceMinor != null && priceMinor < 0)) err("Price must be a number", "price");
    else if (priceMinor == null || priceMinor === 0) warn("No price — imported as quotation-only", "price");
    const stock = int(v.stock ?? raw.stock); if (Number.isNaN(stock) || (stock != null && stock < 0)) err("Stock must be a whole number ≥ 0", "stock");
    const moq = int(v.moq ?? raw.moq); if (Number.isNaN(moq) || (moq != null && moq < 1)) err("MOQ must be a whole number ≥ 1", "moq");
    if (!images.length && !text(v.image)) warn("No image", "image");
    const dims = [num(v.length ?? raw.length), num(v.width ?? raw.width), num(v.height ?? raw.height)];
    if (dims.some((d) => Number.isNaN(d))) err("Length / Width / Height must be numbers", "length");
    const given = dims.filter((d) => d != null).length;
    if (given > 0 && given < 3) err("Enter Length, Width and Height together", "length");
    return {
      ...base, sku: sku ? sku.toUpperCase() : null, priceMinor: priceMinor ?? 0,
      compareAtPriceMinor: v.compareAtPriceMinor != null ? int(v.compareAtPriceMinor) : num(v.compareAtPrice ?? raw.compareAtPrice) == null ? null : Math.round(num(v.compareAtPrice ?? raw.compareAtPrice) * 100),
      stock: stock ?? 0, moq: moq ?? 1, sizeLabel: text(v.attributes?.Size ?? v.size ?? raw.size ?? raw.sizeLabel), color: text(v.attributes?.Color ?? v.color ?? raw.color),
      weightGrams: int(v.weightGrams ?? raw.weightGrams) || null,
      length: given === 3 ? dims[0] : null, width: given === 3 ? dims[1] : null, height: given === 3 ? dims[2] : null, dimUnit: given === 3 ? (text(v.dimUnit ?? raw.dimUnit) ?? "cm") : null,
      images: images.length ? images : [text(v.image)].filter(Boolean),
    };
  }

  // VARIABLE
  if (!variants.length) { err("A variable product needs at least one variant row", "variants"); return null; }
  const baseSku = text(raw.sku) ?? text(raw.productId) ?? slugify(name, "sku").toUpperCase();
  const cleanVariants = variants.map((v, j) => {
    const attributes = {};
    for (const [k, val] of Object.entries(v.attributes ?? {})) { const kk = text(k); const vv = text(val); if (kk && vv) attributes[kk] = vv; }
    const priceMinor = v.priceMinor != null ? int(v.priceMinor) : num(v.price) == null ? null : Math.round(num(v.price) * 100);
    if (Number.isNaN(priceMinor) || (priceMinor != null && priceMinor < 0)) err(`Variant ${j + 1}: price must be a number`, "price");
    else if (!priceMinor) warn(`Variant ${j + 1}: no price — quotation-only`, "price");
    const stock = int(v.stock); if (Number.isNaN(stock) || (stock != null && stock < 0)) err(`Variant ${j + 1}: stock must be a whole number ≥ 0`, "stock");
    const moq = int(v.moq); if (Number.isNaN(moq) || (moq != null && moq < 1)) err(`Variant ${j + 1}: MOQ must be a whole number ≥ 1`, "moq");
    const dims = [num(v.length), num(v.width), num(v.height)];
    if (dims.some((d) => Number.isNaN(d))) err(`Variant ${j + 1}: dimensions must be numbers`, "length");
    const given = dims.filter((d) => d != null).length;
    if (given > 0 && given < 3) err(`Variant ${j + 1}: enter Length, Width and Height together`, "length");
    const sku = text(v.sku);
    if (sku && !SKU_RE.test(sku)) err(`Variant ${j + 1}: SKU "${sku}" may only use letters, numbers, . _ - /`, "sku");
    if (!text(v.image) && !images.length) warn(`Variant ${j + 1}: no image`, "image");
    const statusV = (text(v.status) ?? "active").toLowerCase();
    return {
      sku: sku ? sku.toUpperCase() : undefined, attributes, priceMinor: priceMinor ?? 0,
      compareAtPriceMinor: v.compareAtPriceMinor != null ? int(v.compareAtPriceMinor) : num(v.compareAtPrice) == null ? null : Math.round(num(v.compareAtPrice) * 100),
      stock: stock ?? 0, moq: moq ?? 1, weightGrams: int(v.weightGrams) || null,
      length: given === 3 ? dims[0] : null, width: given === 3 ? dims[1] : null, height: given === 3 ? dims[2] : null, dimUnit: given === 3 ? (text(v.dimUnit) ?? "cm") : null,
      material: text(v.material), thickness: text(v.thickness), image: text(v.image), isActive: statusV !== "inactive" && statusV !== "archived", sortOrder: j,
    };
  });
  let options;
  try {
    options = normalizeOptions(Array.isArray(raw.variantOptions) && raw.variantOptions.length ? raw.variantOptions : optionsFromVariants(cleanVariants));
    if (!options.length) err("Variants need at least one option column (e.g. Size or Color) with values", "variants");
    else prepareVariants(cleanVariants, options, baseSku); // combos + SKUs + per-row rules
  } catch (e) {
    err(e?.issues?.[0]?.message ?? e.message, "variants");
  }
  return { ...base, sku: baseSku.toUpperCase(), variantOptions: options ?? [], variants: cleanVariants };
}

/**
 * Dry run. Returns everything the wizard shows in the Validation + Preview
 * steps. Nothing is written.
 */
export async function validateImport({ products = [], mode = "update", createCategories = false } = {}) {
  if (!Array.isArray(products) || !products.length) throw badRequest("No products to import", "EMPTY");
  if (products.length > 2000) throw badRequest("At most 2000 products per import", "TOO_MANY");
  const errors = []; const warnings = [];
  const clean = products.map((p, i) => normalizeProduct(p ?? {}, i, errors, warnings)).filter(Boolean);

  // Duplicate products / SKUs inside the file.
  const seenRef = new Map(); const seenSku = new Map();
  for (const p of clean) {
    const key = (p.productId ?? p.sku ?? p.name).toLowerCase();
    if (seenRef.has(key)) errors.push({ product: p.ref, field: "productId", message: `Duplicate product "${p.productId ?? p.sku ?? p.name}" — rows for one product must share one Product ID` });
    seenRef.set(key, p);
    const skus = p.kind === "simple" ? [p.sku] : p.variants.map((v, j) => v.sku ?? generateSku(p.sku, v.attributes, p.variantOptions));
    for (const s of skus) {
      if (!s) continue;
      if (seenSku.has(s)) errors.push({ product: p.ref, field: "sku", message: `Duplicate SKU ${s} (also on ${seenSku.get(s)})` });
      seenSku.set(s, p.ref);
    }
  }

  // Categories: must exist (or be creatable); subcategory must belong to the category.
  const cats = await prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true, parentId: true, isActive: true } });
  const findCat = (name, parentId = null) => cats.find((c) => c.parentId === parentId && c.name.toLowerCase() === String(name ?? "").toLowerCase());
  let categoriesMatched = 0; let subcategoriesMatched = 0; const newCategories = new Set(); const newSubcategories = new Set();
  for (const p of clean) {
    if (!p.category) continue;
    const cat = findCat(p.category);
    if (cat) { categoriesMatched++; if (!cat.isActive) warnings.push({ product: p.ref, field: "category", message: `Category "${cat.name}" is inactive — the product will not show until it is activated` }); }
    else if (createCategories) { newCategories.add(p.category); warnings.push({ product: p.ref, field: "category", message: `Category "${p.category}" does not exist — it will be created` }); }
    else errors.push({ product: p.ref, field: "category", message: `Category "${p.category}" does not exist. Create it under Product Catalog → Categories, or tick "Create missing categories".` });
    if (p.subcategory && p.subcategory.toLowerCase() !== "general") {
      const sub = cat ? findCat(p.subcategory, cat.id) : null;
      if (sub) subcategoriesMatched++;
      else if (createCategories || !cat) { if (cat || createCategories) { newSubcategories.add(`${p.category} › ${p.subcategory}`); warnings.push({ product: p.ref, field: "subcategory", message: `Subcategory "${p.subcategory}" will be created under ${p.category}` }); } }
      else errors.push({ product: p.ref, field: "subcategory", message: `Subcategory "${p.subcategory}" does not exist under ${cat.name}` });
    }
  }

  // Existing products / SKU ownership in the database. A variable product's
  // base SKU is a lookup key too (it identifies the parent row).
  const allSkus = [...new Set([...seenSku.keys(), ...clean.map((p) => p.sku).filter(Boolean), ...clean.map((p) => p.productId?.toUpperCase()).filter(Boolean)])];
  const [existingProducts, existingVariants, byRefId] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: allSkus } }, select: { id: true, sku: true, name: true, hasVariants: true, deletedAt: true } }),
    prisma.productVariant.findMany({ where: { sku: { in: allSkus } }, select: { id: true, sku: true, productId: true, deletedAt: true, product: { select: { id: true, sku: true, name: true } } } }),
    prisma.product.findMany({ where: { id: { in: clean.map((p) => p.productId).filter(Boolean) } }, select: { id: true, sku: true, name: true, hasVariants: true } }),
  ]);
  const productBySku = new Map(existingProducts.map((p) => [p.sku, p]));
  const variantBySku = new Map(existingVariants.map((v) => [v.sku, v]));
  const productById = new Map(byRefId.map((p) => [p.id, p]));

  const preview = [];
  for (const p of clean) {
    // Which existing product (if any) does this row set belong to? A given
    // Product ID is authoritative (Product.id or a product SKU); without one,
    // the product SKU or any variant SKU already in the catalog identifies it.
    // A Product ID that matches nothing never adopts another product's SKUs —
    // that is reported as a SKU conflict below instead of a silent merge.
    const target = p.productId
      ? (productById.get(p.productId) ?? productBySku.get(p.productId.toUpperCase()) ?? null)
      : (productBySku.get(p.sku) ?? (p.kind === "variable" ? p.variants.map((v) => variantBySku.get(v.sku ?? "")).find(Boolean)?.product : null) ?? null);
    p.existingId = target?.id ?? null;
    p.action = target ? (mode === "skip" ? "skip" : "update") : "create";
    if (target && target.hasVariants !== (p.kind === "variable") && mode !== "skip") {
      warnings.push({ product: p.ref, field: "kind", message: `"${target.name}" is currently a ${target.hasVariants ? "variable" : "simple"} product — it will be converted to ${p.kind}` });
    }
    // SKUs owned by ANOTHER product are a hard error.
    const skus = p.kind === "simple" ? [p.sku] : p.variants.map((v) => v.sku ?? generateSku(p.sku, v.attributes, p.variantOptions));
    for (const s of skus) {
      const owner = productBySku.get(s) ?? variantBySku.get(s)?.product;
      if (owner && owner.id !== p.existingId) errors.push({ product: p.ref, field: "sku", message: `SKU ${s} already belongs to "${owner.name}"` });
    }
    preview.push({
      ref: p.ref, name: p.name, kind: p.kind, category: p.category, subcategory: p.subcategory, action: p.action, sku: p.sku,
      images: p.images.length, options: p.variantOptions ?? [],
      variants: p.kind === "variable"
        ? p.variants.map((v) => ({ sku: v.sku ?? generateSku(p.sku, v.attributes, p.variantOptions), label: (p.variantOptions ?? []).map((o) => v.attributes[o.name]).filter(Boolean).join(" / "), priceMinor: v.priceMinor, stock: v.stock, moq: v.moq, image: v.image }))
        : [],
    });
  }

  const variantsDetected = clean.reduce((n, p) => n + (p.kind === "variable" ? p.variants.length : 0), 0);
  return {
    ok: errors.length === 0,
    summary: {
      products: clean.length, simple: clean.filter((p) => p.kind === "simple").length, variable: clean.filter((p) => p.kind === "variable").length,
      variants: variantsDetected, categoriesMatched, subcategoriesMatched, newCategories: [...newCategories], newSubcategories: [...newSubcategories],
      toCreate: clean.filter((p) => p.action === "create").length, toUpdate: clean.filter((p) => p.action === "update").length, toSkip: clean.filter((p) => p.action === "skip").length,
      productsWithoutImages: clean.filter((p) => !p.images.length && !(p.variants ?? []).some((v) => v.image)).length,
    },
    errors, warnings, preview, _clean: clean,
  };
}

/**
 * Validate, then write EVERYTHING in one transaction. Any failure rolls the
 * whole import back — the database is never left half-imported.
 */
export async function runImport({ products, mode = "update", createCategories = false, fileName = null, actorId = null } = {}) {
  const v = await validateImport({ products, mode, createCategories });
  if (!v.ok) {
    const e = badRequest(`Import has ${v.errors.length} error${v.errors.length === 1 ? "" : "s"} — fix them and validate again`, "IMPORT_INVALID");
    e.details = v.errors;
    throw e;
  }
  const clean = v._clean;
  const counts = { created: 0, updated: 0, skipped: 0, variantsWritten: 0 };
  const written = [];

  await prisma.$transaction(async (tx) => {
    const catCache = new Map(); const subCache = new Map();
    for (const p of clean) {
      if (p.action === "skip") { counts.skipped++; continue; }
      const category = await resolveCategory(p.category, catCache, tx);
      const subcategory = p.subcategory && p.subcategory.toLowerCase() !== "general" ? await resolveSubcategory(p.subcategory, category, subCache, tx) : null;
      const common = {
        name: p.name, description: p.description, material: p.material, gsm: p.gsm, thickness: p.thickness, brand: p.brand, manufacturer: p.manufacturer,
        productType: p.productType, status: p.status, isFeatured: p.isFeatured,
        category: category.name, categoryId: category.id, subcategory: subcategory?.name ?? "General", subcategoryId: subcategory?.id ?? null,
        deletedAt: null,
      };
      if (p.images.length) { common.images = p.images; common.imageEmoji = p.images[0]; }
      let row;
      if (p.existingId) {
        const data = { ...common };
        if (p.kind === "simple") {
          Object.assign(data, { sku: p.sku, hasVariants: false, variantOptions: [], basePriceMinor: p.priceMinor, salePriceMinor: null, stock: p.stock, moq: p.moq, sizeLabel: p.sizeLabel, color: p.color, weightGrams: p.weightGrams, length: p.length, width: p.width, height: p.height, dimUnit: p.dimUnit });
          await tx.productVariant.updateMany({ where: { productId: p.existingId, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
        } else {
          data.sku = p.sku;
        }
        row = await tx.product.update({ where: { id: p.existingId }, data });
        counts.updated++;
      } else {
        const id = await nextProductId(tx);
        row = await tx.product.create({
          data: {
            id, sku: p.sku, slug: await uniqueSlug(p.name, p.sku, tx), ...common, images: p.images, imageEmoji: p.images[0] ?? "📦",
            hasVariants: p.kind === "variable",
            ...(p.kind === "simple" ? { basePriceMinor: p.priceMinor, stock: p.stock, moq: p.moq, sizeLabel: p.sizeLabel, color: p.color, weightGrams: p.weightGrams, length: p.length, width: p.width, height: p.height, dimUnit: p.dimUnit } : { moq: 1 }),
          },
        });
        if (p.kind === "simple" && p.stock > 0) {
          await tx.stockMovement.create({ data: { productId: row.id, type: "RECEIPT", quantity: p.stock, balance: p.stock, reason: "Opening stock (import)", refType: "import", actorId } });
        }
        counts.created++;
      }
      if (p.kind === "variable") {
        const live = await syncVariants(tx, row, p.variants, p.variantOptions);
        counts.variantsWritten += live.length;
      }
      written.push({ id: row.id, sku: row.sku, name: row.name, kind: p.kind, action: p.action });
    }
    await recordEvent({ eventType: "catalog.import", actorId, entityType: "CatalogImport", entityId: fileName ?? "import", metadata: { fileName, ...counts, products: written.length } }, tx);
  }, { timeout: 180_000, maxWait: 15_000 });

  return { ...counts, products: written, warnings: v.warnings, summary: v.summary };
}
