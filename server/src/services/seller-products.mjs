// ===========================================================================
// Supplier-owned catalog listings.
//
// See docs/adr/ADR-001-supplier-owned-products.md. Two rules hold everywhere
// in this file, and they are the reason it exists instead of letting sellers
// call the admin product routes:
//
//   1. OWNERSHIP IS NEVER TAKEN FROM THE REQUEST. `supplierProfileId` is set
//      from `req.supplierProfile`, resolved from the caller's session by the
//      route mount. A body that supplies its own supplierProfileId/sellerId
//      is ignored, so a supplier cannot list a product "as" a competitor.
//   2. A SUPPLIER CANNOT PUBLISH. Create and update both force
//      `pending_review`; only an admin moves a listing to `active`. Every
//      edit to a live listing sends it back for review (decided in the ADR),
//      so an approved supplier cannot swap a ₹50 product to ₹5,000 silently.
//
// Commission (`commissionBps`) is admin-only and stripped here, matching the
// admin routes which already strip it from client input.
// ===========================================================================
import { prisma } from "../lib/prisma.mjs";
import { badRequest, forbidden, notFound } from "../lib/http.mjs";
import { createProduct, updateProduct } from "./product-write.mjs";
import { recordEvent } from "./events.mjs";

/** Fields a supplier may never set, whatever the request body says. */
const FORBIDDEN_FIELDS = [
  "supplierProfileId", // ownership — comes from the session
  "sellerId", // attribution — comes from the session
  "status", // publication — admin only
  "commissionBps", // marketplace economics — admin only
  "id",
  "slug",
  "deletedAt",
  "reservedStock",
];

/** Drop everything a supplier is not allowed to decide. */
function sellerInput(body = {}) {
  const clean = { ...body };
  for (const f of FORBIDDEN_FIELDS) delete clean[f];
  return clean;
}

/** The listing must belong to the calling supplier, or it does not exist.
 *  404 (not 403) so we never confirm another supplier's product id. */
async function ownedOrNotFound(profileId, productId) {
  const row = await prisma.product.findFirst({
    where: { id: productId, supplierProfileId: profileId, deletedAt: null },
  });
  if (!row) throw notFound("Product not found");
  return row;
}

/** Only an approved supplier may list products at all. */
function assertApproved(profile) {
  if (profile?.status !== "APPROVED") {
    throw forbidden("Your account must be approved before you can list products");
  }
}

/** This supplier's listings, newest first. Never another supplier's. */
export async function listMine(profile, { status, q, page = 1, limit = 25 } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const where = { supplierProfileId: profile.id, deletedAt: null };
  if (status) where.status = status;
  const term = String(q ?? "").trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
    ];
  }

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      select: {
        id: true, sku: true, name: true, status: true, basePriceMinor: true,
        moq: true, stock: true, category: true, subcategory: true,
        images: true, updatedAt: true, rejectionNote: true,
      },
    }),
  ]);

  return { products, total, page: Math.max(1, Number(page) || 1), limit: take, pages: Math.max(1, Math.ceil(total / take)) };
}

/** Submit a new listing. Always lands in pending_review, owned by the caller. */
export async function createMine(profile, actorId, body = {}) {
  assertApproved(profile);

  const product = await createProduct(
    { ...sellerInput(body), status: "pending_review" },
    { actorId },
  );

  // product-write owns validation/taxonomy/images; ownership is stamped here
  // so there is exactly one place that decides who a listing belongs to.
  const owned = await prisma.product.update({
    where: { id: product.id },
    data: { supplierProfileId: profile.id, sellerId: actorId },
  });

  await recordEvent({
    eventType: "seller.product.submitted",
    actorId,
    entityType: "Product",
    entityId: owned.id,
    metadata: { sku: owned.sku, name: owned.name, supplierProfileId: profile.id },
  });

  return owned;
}

/** Edit a listing. Any change returns it to review and off the storefront. */
export async function updateMine(profile, actorId, productId, body = {}) {
  assertApproved(profile);
  const existing = await ownedOrNotFound(profile.id, productId);

  const wasLive = existing.status === "active";
  const product = await updateProduct(
    productId,
    { ...sellerInput(body), status: "pending_review" },
    { actorId },
  );

  await recordEvent({
    eventType: "seller.product.updated",
    actorId,
    entityType: "Product",
    entityId: productId,
    metadata: { sku: existing.sku, supplierProfileId: profile.id, wasLive, returnedToReview: true },
  });

  return product;
}

/** Take a listing off sale. Soft only — order history snapshots must hold. */
export async function withdrawMine(profile, actorId, productId) {
  assertApproved(profile);
  const existing = await ownedOrNotFound(profile.id, productId);
  if (existing.status === "archived") throw badRequest("This listing is already withdrawn");

  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: "archived" },
  });

  await recordEvent({
    eventType: "seller.product.withdrawn",
    actorId,
    entityType: "Product",
    entityId: productId,
    metadata: { sku: existing.sku, supplierProfileId: profile.id, from: existing.status },
  });

  return product;
}

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

/** The review queue: supplier listings waiting on a decision. */
export async function pendingQueue({ page = 1, limit = 25 } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { status: "pending_review", supplierProfileId: { not: null }, deletedAt: null };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "asc" }, // oldest waiting first
      skip,
      take,
      include: {
        supplierProfile: { select: { id: true, legalName: true, displayName: true, status: true } },
      },
    }),
  ]);

  return { products, total, page: Math.max(1, Number(page) || 1), limit: take, pages: Math.max(1, Math.ceil(total / take)) };
}

/** Every listing owned by one supplier — the admin supplier detail section. */
export async function listForSupplier(supplierProfileId, { page = 1, limit = 25 } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { supplierProfileId, deletedAt: null };

  const [total, products, counts] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      select: {
        id: true, sku: true, name: true, status: true, basePriceMinor: true,
        moq: true, stock: true, category: true, images: true, updatedAt: true,
      },
    }),
    prisma.product.groupBy({ by: ["status"], where, _count: true }),
  ]);

  return {
    products,
    total,
    page: Math.max(1, Number(page) || 1),
    limit: take,
    pages: Math.max(1, Math.ceil(total / take)),
    byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}

/** Approve a listing: it goes live. Commission is set here, by the admin. */
export async function approveListing(adminId, productId, { commissionBps } = {}) {
  const row = await prisma.product.findUnique({ where: { id: productId } });
  if (!row) throw notFound("Product not found");
  if (!row.supplierProfileId) throw badRequest("This is a house-catalog product, not a supplier listing");
  if (row.status !== "pending_review") throw badRequest(`Only a listing awaiting review can be approved (this one is ${row.status})`);

  const data = { status: "active", rejectionNote: null };
  if (commissionBps !== undefined && commissionBps !== null) {
    const bps = Number(commissionBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw badRequest("Commission must be between 0 and 10000 basis points");
    }
    data.commissionBps = bps;
  }

  const product = await prisma.product.update({ where: { id: productId }, data });
  await recordEvent({
    eventType: "seller.product.approved",
    actorId: adminId,
    entityType: "Product",
    entityId: productId,
    metadata: { sku: row.sku, supplierProfileId: row.supplierProfileId, commissionBps: data.commissionBps ?? row.commissionBps },
  });
  return product;
}

/** Reject a listing back to the supplier with a reason they can act on. */
export async function rejectListing(adminId, productId, reason) {
  const note = String(reason ?? "").trim();
  if (!note) throw badRequest("Give the supplier a reason so they can fix the listing");

  const row = await prisma.product.findUnique({ where: { id: productId } });
  if (!row) throw notFound("Product not found");
  if (!row.supplierProfileId) throw badRequest("This is a house-catalog product, not a supplier listing");
  if (row.status !== "pending_review") throw badRequest(`Only a listing awaiting review can be rejected (this one is ${row.status})`);

  // Back to draft, not archived: the supplier edits and resubmits.
  const product = await prisma.product.update({
    where: { id: productId },
    data: { status: "draft", rejectionNote: note },
  });
  await recordEvent({
    eventType: "seller.product.rejected",
    actorId: adminId,
    entityType: "Product",
    entityId: productId,
    metadata: { sku: row.sku, supplierProfileId: row.supplierProfileId, reason: note },
  });
  return product;
}
