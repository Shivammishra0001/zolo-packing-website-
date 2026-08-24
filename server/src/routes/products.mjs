// Product/catalog routes. The public contract (envelope shape, paths) is
// preserved so the existing admin catalog + storefront keep working; the write
// paths now delegate to services/catalog.mjs for category upsert, SKU dedupe,
// image validation and soft-delete.
import { Router } from "express";
import { ok, wrap, badRequest, notFound } from "../lib/http.mjs";
import { prisma } from "../lib/prisma.mjs";
import {
  importProducts,
  storeImage,
  setProductImage,
  softDeleteProducts,
  resolveCategory,
  resolveSubcategory,
  slugify,
} from "../services/catalog.mjs";

export const productsRouter = Router();

/**
 * List products. Soft-deleted rows are hidden by default so the storefront and
 * catalog never show archived stock; `?includeDeleted=1` is for admin tooling.
 * Supports optional pagination — omitted params keep the original "all rows"
 * behavior that existing callers depend on.
 */
productsRouter.get("/products", wrap(async (req, res) => {
  const includeDeleted = req.query.includeDeleted === "1" || req.query.includeDeleted === "true";
  const where = includeDeleted ? {} : { deletedAt: null };

  const take = Math.min(Number(req.query.limit) || 0, 500);
  const skip = Math.max(Number(req.query.offset) || 0, 0);

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...(take > 0 ? { take, skip } : {}),
    }),
    prisma.product.count({ where }),
  ]);
  ok(res, { products, total });
}));

productsRouter.post("/products", wrap(async (req, res) => {
  const body = req.body ?? {};
  if (!String(body.sku ?? "").trim()) throw badRequest("SKU is required", "SKU_REQUIRED");
  if (!String(body.name ?? "").trim()) throw badRequest("Product name is required", "NAME_REQUIRED");

  // Route single creates through the same importer so categories are upserted
  // and slugs stay unique — one implementation, no drift.
  const result = await importProducts([body], "create");
  if (result.failed > 0) throw badRequest(result.errors[0]?.error ?? "Could not create product", "CREATE_FAILED");
  ok(res, { product: result.products[0] }, 201);
}));

/**
 * Resolve the category/subcategory NAMES on an update into real FK links, so
 * a taxonomy change made in the admin form persists as a relation and not just
 * a denormalized string.
 */
async function applyTaxonomy(data) {
  if (!data.category) return data;
  const cat = await resolveCategory(data.category);
  if (!cat) return data;
  data.categoryId = cat.id;
  data.category = cat.name;

  if (data.subcategory && String(data.subcategory).toLowerCase() !== "general") {
    const sub = await resolveSubcategory(data.subcategory, cat);
    if (sub) { data.subcategoryId = sub.id; data.subcategory = sub.name; }
  } else if (data.subcategory !== undefined) {
    // Explicitly cleared → drop the link rather than leaving a stale one.
    data.subcategoryId = null;
    data.subcategory = "General";
  }
  return data;
}

productsRouter.put("/products/:id", wrap(async (req, res) => {
  const { id: _ignore, createdAt, updatedAt, ...data } = req.body ?? {};
  await applyTaxonomy(data);
  if (data.name && !data.slug) delete data.slug;
  const updated = await prisma.product.update({ where: { id: req.params.id }, data });
  ok(res, { product: updated });
}));

// PATCH mirrors PUT for callers that prefer partial semantics.
productsRouter.patch("/products/:id", wrap(async (req, res) => {
  const { id: _ignore, createdAt, updatedAt, ...data } = req.body ?? {};
  await applyTaxonomy(data);
  const updated = await prisma.product.update({ where: { id: req.params.id }, data });
  ok(res, { product: updated });
}));

/**
 * Delete a product. Soft-delete by default (preserves order history);
 * `?hard=1` is deliberately NOT supported — financial snapshots depend on the
 * row surviving.
 */
productsRouter.delete("/products/:id", wrap(async (req, res) => {
  const { deleted } = await softDeleteProducts([req.params.id]);
  if (deleted === 0) {
    const exists = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) throw notFound("Product not found");
  }
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  ok(res, { product });
}));

/** Bulk soft-delete for the catalog's multi-select toolbar. */
productsRouter.post("/products/bulk-delete", wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const result = await softDeleteProducts(ids);
  ok(res, result);
}));

/**
 * Bulk import. Row-isolated: one bad row is reported and skipped while every
 * other row still commits.
 */
productsRouter.post("/products/import", wrap(async (req, res) => {
  const { products = [], mode = "update" } = req.body ?? {};
  if (!Array.isArray(products)) throw badRequest("`products` must be an array", "BAD_PAYLOAD");
  if (!["update", "skip", "create"].includes(mode)) {
    throw badRequest(`Unknown duplicate mode "${mode}" (use update/skip/create)`, "BAD_MODE");
  }
  const result = await importProducts(products, mode);
  console.log(`[catalog:import] mode=${mode} processed=${result.processed} created=${result.created} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`);
  ok(res, result);
}));

/** Attach an image to one product (admin "Upload Image" action). */
productsRouter.post("/products/:id/image", wrap(async (req, res) => {
  const { name, mime, dataBase64, replace } = req.body ?? {};
  const url = storeImage({ name, mime, dataBase64 });
  const product = await setProductImage(req.params.id, url, { replace: replace === true });
  ok(res, { product, url }, 201);
}));

/**
 * Bulk image attach: [{ sku, name, mime, dataBase64 }]. Matches each image to a
 * product by SKU; unmatched images and invalid files are reported rather than
 * failing the batch.
 */
productsRouter.post("/products/images/bulk", wrap(async (req, res) => {
  const items = Array.isArray(req.body?.images) ? req.body.images : [];
  if (items.length === 0) throw badRequest("No images supplied", "NO_IMAGES");
  if (items.length > 500) throw badRequest("Too many images in one batch (max 500)", "TOO_MANY");

  const result = { processed: 0, matched: 0, unmatched: 0, invalid: 0, errors: [] };
  for (const item of items) {
    result.processed++;
    const sku = String(item?.sku ?? "").trim();
    try {
      const product = await prisma.product.findUnique({ where: { sku } });
      if (!product) {
        result.unmatched++;
        result.errors.push({ sku, level: "warning", error: "No product with this SKU" });
        continue;
      }
      const url = storeImage({ name: item.name ?? sku, mime: item.mime, dataBase64: item.dataBase64 });
      await setProductImage(product.id, url, { replace: item.replace === true });
      result.matched++;
    } catch (e) {
      result.invalid++;
      result.errors.push({ sku: sku || "?", level: "error", error: e.message });
    }
  }
  console.log(`[catalog:images:bulk] processed=${result.processed} matched=${result.matched} unmatched=${result.unmatched} invalid=${result.invalid}`);
  ok(res, result);
}));

// Generic image upload — unchanged public contract (used by the editor + import).
productsRouter.post("/uploads", wrap(async (req, res) => {
  const { name = "image", mime, dataBase64 } = req.body ?? {};
  const url = storeImage({ name, mime, dataBase64 });
  ok(res, { url }, 201);
}));

/**
 * Categories — the SINGLE source of truth for Admin and the storefront.
 *
 * Returns a two-level tree with REAL product counts, so nothing has to
 * hardcode a category list or count. Counts exclude archived/soft-deleted
 * products so the storefront never advertises items it will not show.
 */
productsRouter.get("/categories", wrap(async (req, res) => {
  const includeEmpty = req.query.includeEmpty !== "0";
  const rows = await prisma.category.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          products: { where: { deletedAt: null, status: "active" } },
          subProducts: { where: { deletedAt: null, status: "active" } },
        },
      },
    },
  });

  const byId = new Map(rows.map((c) => [c.id, c]));
  const tree = rows
    .filter((c) => !c.parentId)
    .map((parent) => ({
      id: parent.id,
      name: parent.name,
      slug: parent.slug,
      isActive: parent.isActive,
      productCount: parent._count.products,
      subcategories: rows
        .filter((c) => c.parentId === parent.id)
        .map((sub) => ({
          id: sub.id,
          name: sub.name,
          slug: sub.slug,
          isActive: sub.isActive,
          // Products carry subcategoryId, so a sub's count is its subProducts.
          productCount: sub._count.subProducts,
        }))
        .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name)),
    }))
    .filter((c) => includeEmpty || c.productCount > 0 || c.subcategories.length > 0)
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));

  // Flat list retained for existing callers; `tree` is the richer shape.
  ok(res, { categories: rows.map((c) => ({ ...c, _count: undefined, parentName: c.parentId ? byId.get(c.parentId)?.name ?? null : null })), tree });
}));

/** Create a category, or a subcategory when `parentId` is supplied. */
productsRouter.post("/categories", wrap(async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) throw badRequest("Category name is required", "NAME_REQUIRED");
  const parentId = req.body?.parentId ? String(req.body.parentId) : null;

  if (!parentId) {
    ok(res, { category: await resolveCategory(name) }, 201);
    return;
  }
  const parent = await prisma.category.findFirst({ where: { id: parentId, deletedAt: null } });
  if (!parent) throw badRequest("Parent category not found", "PARENT_NOT_FOUND");
  ok(res, { category: await resolveSubcategory(name, parent) }, 201);
}));

/**
 * Deactivate a category. Never a hard delete: products reference it, and
 * order history must keep resolving. Products keep their link and simply stop
 * surfacing under an inactive category.
 */
productsRouter.delete("/categories/:id", wrap(async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) throw notFound("Category not found");
  const inUse = await prisma.product.count({
    where: { OR: [{ categoryId: category.id }, { subcategoryId: category.id }], deletedAt: null },
  });
  const updated = await prisma.category.update({
    where: { id: category.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  ok(res, { category: updated, productsAffected: inUse });
}));

export { slugify };
