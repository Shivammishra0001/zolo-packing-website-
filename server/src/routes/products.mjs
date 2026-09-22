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
import { recordImport } from "../services/catalog-imports.mjs";
import { createProduct, updateProduct } from "../services/product-write.mjs";
import { authenticate, requireAdmin } from "../middleware/auth.mjs";

export const productsRouter = Router();

// Reads (GET /products, GET /categories) stay public for the storefront.
// Every WRITE below requires an authenticated admin — hiding a button in the
// UI is not authorization.
const adminOnly = [authenticate, requireAdmin];

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

/**
 * Create ONE product from the admin form. Strict validation (400 with
 * field-level issues), a hard 409 on a duplicate SKU, a category that must
 * exist, and images stored in the same transaction as the row. The id is
 * generated server-side — a client-supplied id is ignored.
 */
productsRouter.post("/products", ...adminOnly, wrap(async (req, res) => {
  const { id: _clientId, slug: _slug, imageEmoji: _emoji, createdAt, updatedAt, ...body } = req.body ?? {};
  const product = await createProduct(body, { actorId: req.user.id });
  ok(res, { product }, 201);
}));

// Strip fields the client may echo back but must never write directly.
const editable = (body) => {
  const { id: _id, slug: _slug, imageEmoji: _emoji, createdAt, updatedAt, deletedAt, categoryRef, subcategoryRef, sellerId, reservedStock, commissionBps, ...rest } = body ?? {};
  return rest;
};

// PUT and PATCH share one validated, transactional update (partial semantics:
// only supplied fields change; images/taxonomy are re-linked when supplied).
productsRouter.put("/products/:id", ...adminOnly, wrap(async (req, res) => {
  ok(res, { product: await updateProduct(req.params.id, editable(req.body), { actorId: req.user.id }) });
}));

productsRouter.patch("/products/:id", ...adminOnly, wrap(async (req, res) => {
  ok(res, { product: await updateProduct(req.params.id, editable(req.body), { actorId: req.user.id }) });
}));

/**
 * Delete a product. Soft-delete by default (preserves order history);
 * `?hard=1` is deliberately NOT supported — financial snapshots depend on the
 * row surviving.
 */
productsRouter.delete("/products/:id", ...adminOnly, wrap(async (req, res) => {
  const { deleted } = await softDeleteProducts([req.params.id]);
  if (deleted === 0) {
    const exists = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) throw notFound("Product not found");
  }
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  ok(res, { product });
}));

/** Bulk soft-delete for the catalog's multi-select toolbar. */
productsRouter.post("/products/bulk-delete", ...adminOnly, wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const result = await softDeleteProducts(ids);
  ok(res, result);
}));

/**
 * Bulk import. Row-isolated: one bad row is reported and skipped while every
 * other row still commits.
 */
productsRouter.post("/products/import", ...adminOnly, wrap(async (req, res) => {
  const { products = [], mode = "update", fileName = null, fileSizeBytes = null, imagesMatched = 0, createMissingCategories = false } = req.body ?? {};
  if (!Array.isArray(products)) throw badRequest("`products` must be an array", "BAD_PAYLOAD");
  if (!["update", "skip", "create"].includes(mode)) {
    throw badRequest(`Unknown duplicate mode "${mode}" (use update/skip/create)`, "BAD_MODE");
  }
  // Unknown categories fail their row unless the admin explicitly opted into
  // creating them (the importer's "Create missing categories" checkbox).
  const result = await importProducts(products, mode, { createMissingCategories: createMissingCategories === true });
  console.log(`[catalog:import] mode=${mode} processed=${result.processed} created=${result.created} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`);
  // Persist the run for Import History + audit (Phases 14/16/19). Never blocks
  // or fails the import — history bookkeeping is best-effort. actorId is set
  // once the catalog write endpoints are authenticated (see known issues).
  const record = await recordImport({
    result, mode, fileName,
    fileSizeBytes: Number(fileSizeBytes) || null,
    actorId: req.user?.id ?? null,
    imagesMatched: Number(imagesMatched) || 0,
  });
  ok(res, { ...result, importId: record?.id ?? null });
}));

/** Attach an image to one product (admin "Upload Image" action). */
productsRouter.post("/products/:id/image", ...adminOnly, wrap(async (req, res) => {
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
productsRouter.post("/products/images/bulk", ...adminOnly, wrap(async (req, res) => {
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
productsRouter.post("/uploads", ...adminOnly, wrap(async (req, res) => {
  const { name = "image", mime, dataBase64 } = req.body ?? {};
  const url = storeImage({ name, mime, dataBase64 });
  ok(res, { url }, 201);
}));

// Categories moved to routes/categories.mjs (admin CRUD + public tree).

export { slugify };
