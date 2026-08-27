// Admin routes — /api/v1/admin/*. Mounted behind authenticate + requireAdmin.
import { Router } from "express";
import { ok, wrap, notFound } from "../lib/http.mjs";
import { changeRequestSchema, rejectSchema, suspendSchema, orderStatusUpdateSchema } from "../lib/validation.mjs";
import * as admin from "../services/admin.mjs";
import * as documents from "../services/documents.mjs";
import * as orders from "../services/orders.mjs";
import * as aiGen from "../services/ai-generate.mjs";
import * as dashboards from "../services/dashboards.mjs";
import * as inventory from "../services/inventory.mjs";
import * as pricing from "../services/pricing.mjs";
import * as payouts from "../services/payouts.mjs";
import * as cms from "../services/cms.mjs";
import { z } from "zod";

export const adminRouter = Router();

// ---- AI product generation from existing images (admin only) ----
adminRouter.get("/ai/images", wrap(async (_req, res) => ok(res, { images: aiGen.scanImages() })));

adminRouter.get("/ai/analyses", wrap(async (_req, res) => ok(res, await aiGen.listAnalyses())));

const analyzeSchema = z.object({ filenames: z.array(z.string().max(300)).min(1).max(200), force: z.boolean().optional() });
adminRouter.post("/ai/analyze", wrap(async (req, res) => {
  const { filenames, force } = analyzeSchema.parse(req.body);
  ok(res, await aiGen.analyzeImages({ filenames, force: !!force, actorId: req.user.id }));
}));

const approveSchema = z.object({
  overrides: z.object({
    name: z.string().max(160).optional(),
    sku: z.string().max(60).optional(),
    category: z.string().max(120).optional(),
    subcategory: z.string().max(120).optional(),
    description: z.string().max(4000).optional(),
    color: z.string().max(80).optional(),
    material: z.string().max(120).optional(),
    basePriceMinor: z.number().int().min(0).optional(),
  }).optional(),
  dupeMode: z.enum(["update", "skip", "create-new"]).optional(),
});
adminRouter.post("/ai/analyses/:id/approve", wrap(async (req, res) => {
  const { overrides, dupeMode } = approveSchema.parse(req.body ?? {});
  ok(res, await aiGen.approveAnalysis(req.params.id, { overrides: overrides ?? {}, dupeMode: dupeMode ?? "update", actorId: req.user.id }), 201);
}));

adminRouter.post("/ai/analyses/:id/reject", wrap(async (req, res) => {
  ok(res, await aiGen.rejectAnalysis(req.params.id, { actorId: req.user.id }));
}));

// ---- Order management ----
// ---- Dashboards & activity (all figures computed from PostgreSQL) --------

/** One request powers the whole admin overview. */
adminRouter.get("/dashboard", wrap(async (req, res) => {
  ok(res, await dashboards.adminDashboard({
    recentLimit: Number(req.query.recentLimit) || 10,
    activityLimit: Number(req.query.activityLimit) || 15,
  }));
}));

/** Paginated business activity feed (cursor-based). */
adminRouter.get("/activity", wrap(async (req, res) => {
  ok(res, await dashboards.activityFeed({
    limit: req.query.limit,
    cursor: req.query.cursor ?? null,
    eventType: req.query.eventType ?? null,
    entityType: req.query.entityType ?? null,
  }));
}));

/** Inventory with availability (stock − reserved) and low-stock state. */
adminRouter.get("/inventory", wrap(async (req, res) => {
  ok(res, await dashboards.inventoryOverview({
    limit: req.query.limit, offset: req.query.offset,
    lowOnly: req.query.lowOnly === "1" || req.query.lowOnly === "true",
  }));
}));

/** Revenue/orders per day plus best sellers, aggregated in SQL. */
adminRouter.get("/analytics", wrap(async (req, res) => {
  ok(res, await dashboards.salesAnalytics({ days: req.query.days }));
}));

/**
 * Customers. Derived from User(role=buyer) + aggregated order totals — the
 * `Customer` table exists in the schema but is never written to (0 rows while
 * 564 buyers exist), so User is the only correct source.
 */
adminRouter.get("/customers", wrap(async (req, res) => {
  ok(res, await dashboards.customerList({
    limit: req.query.limit, offset: req.query.offset,
    search: req.query.search?.trim() || null,
    includeInactive: req.query.includeInactive === "1" || req.query.includeInactive === "true",
  }));
}));

adminRouter.get("/customers/:id", wrap(async (req, res) => {
  const detail = await dashboards.customerDetail(req.params.id);
  if (!detail) throw notFound("Customer not found");
  ok(res, detail);
}));

/** Finance: invoices, payments, receivables. */
adminRouter.get("/finance", wrap(async (req, res) => {
  ok(res, await dashboards.financeOverview({ limit: req.query.limit }));
}));

/** Shipping: shipments and pending dispatch count. */
adminRouter.get("/shipping", wrap(async (req, res) => {
  ok(res, await dashboards.shippingOverview({ limit: req.query.limit }));
}));

/** Marketing: coupons with real redemption counts. */
adminRouter.get("/marketing", wrap(async (req, res) => {
  ok(res, await dashboards.marketingOverview({ limit: req.query.limit }));
}));

adminRouter.get("/orders/stats", wrap(async (_req, res) => ok(res, await orders.adminOrderStats())));

adminRouter.get("/orders", wrap(async (req, res) => {
  const { status, paymentStatus, search, from, to, page, pageSize } = req.query;
  ok(res, await orders.adminListOrders({
    status, paymentStatus, search, from, to,
    page: page ? Number(page) : 1, pageSize: pageSize ? Number(pageSize) : 20,
  }));
}));

adminRouter.get("/orders/:id", wrap(async (req, res) => ok(res, await orders.adminGetOrder(req.params.id))));

adminRouter.patch("/orders/:id/status", wrap(async (req, res) => {
  const input = orderStatusUpdateSchema.parse(req.body);
  ok(res, await orders.adminUpdateStatus(req.user, req.params.id, input));
}));

// Inventory ledger. Every stock change is explainable: the movement row and
// the new Product.stock are written in one transaction.
adminRouter.get("/inventory/movements", wrap(async (req, res) => {
  ok(res, await inventory.listMovements({
    productId: req.query.productId ?? null,
    type: req.query.type ?? null,
    limit: Number(req.query.limit) || 100,
    offset: Number(req.query.offset) || 0,
  }));
}));

adminRouter.post("/inventory/movements", wrap(async (req, res) => {
  const { productId, type, quantity, reason, refType, refId } = req.body ?? {};
  ok(res, { movement: await inventory.adminRecordMovement(req.user, { productId, type, quantity, reason, refType, refId }) }, 201);
}));

// Drift check: ledger sum vs Product.stock. Non-empty `drift` means something
// bypassed the ledger.
adminRouter.get("/inventory/reconcile", wrap(async (_req, res) => ok(res, await inventory.reconcile())));

// Shipments — the Shipping module's write path. Tracking events advance both
// the shipment and its order so admin and customer read one timeline.
adminRouter.post("/orders/:id/shipment", wrap(async (req, res) => {
  const { courier, trackingNumber, expectedAt, note } = req.body ?? {};
  ok(res, { shipment: await orders.adminCreateShipment(req.user, req.params.id, { courier, trackingNumber, expectedAt, note }) }, 201);
}));

adminRouter.get("/shipments/:id", wrap(async (req, res) => ok(res, { shipment: await orders.adminGetShipment(req.params.id) })));

adminRouter.post("/shipments/:id/events", wrap(async (req, res) => {
  const { status, location, note } = req.body ?? {};
  ok(res, { shipment: await orders.adminAddShipmentEvent(req.user, req.params.id, { status, location, note }) });
}));

// Payments & refunds — the Finance module's write path.
adminRouter.patch("/payments/:id", wrap(async (req, res) => {
  const { status, reference, method, note } = req.body ?? {};
  ok(res, { order: await orders.adminUpdatePayment(req.user, req.params.id, { status, reference, method, note }) });
}));

adminRouter.post("/payments/:id/refund", wrap(async (req, res) => {
  const { amountMinor, reason } = req.body ?? {};
  ok(res, { refund: await orders.adminCreateRefund(req.user, req.params.id, { amountMinor, reason }) });
}));

adminRouter.get("/orders/:id/invoice", wrap(async (req, res) => {
  ok(res, await orders.getInvoice(req.params.id, { isAdmin: true }));
}));

adminRouter.get("/sellers", wrap(async (req, res) => {
  const { status, verificationStatus, businessType, search, take, skip } = req.query;
  ok(res, await admin.listSellers({
    status, verificationStatus, businessType, search,
    take: take ? Number(take) : 50, skip: skip ? Number(skip) : 0,
  }));
}));

adminRouter.get("/sellers/:id", wrap(async (req, res) => {
  ok(res, await admin.getSeller(req.params.id));
}));

adminRouter.post("/sellers/:id/review", wrap(async (req, res) => {
  ok(res, await admin.startReview(req.params.id, req.user));
}));

adminRouter.post("/sellers/:id/approve", wrap(async (req, res) => {
  ok(res, await admin.approve(req.params.id, req.user));
}));

adminRouter.post("/sellers/:id/reject", wrap(async (req, res) => {
  const { reason } = rejectSchema.parse(req.body);
  ok(res, await admin.reject(req.params.id, reason, req.user));
}));

adminRouter.post("/sellers/:id/request-changes", wrap(async (req, res) => {
  const { issues } = changeRequestSchema.parse(req.body);
  ok(res, await admin.requestChanges(req.params.id, issues, req.user));
}));

adminRouter.post("/sellers/:id/suspend", wrap(async (req, res) => {
  const { reason } = suspendSchema.parse(req.body);
  ok(res, await admin.suspend(req.params.id, reason, req.user));
}));

adminRouter.post("/sellers/:id/reactivate", wrap(async (req, res) => {
  ok(res, await admin.reactivate(req.params.id, req.user));
}));

// Document verification + authorized preview URL.
const verifySchema = z.object({ status: z.enum(["VERIFIED", "REJECTED"]), reason: z.string().max(1000).optional() });
adminRouter.post("/documents/:id/verify", wrap(async (req, res) => {
  const input = verifySchema.parse(req.body);
  ok(res, await documents.verify(req.params.id, input, req.user));
}));

adminRouter.get("/documents/:id/file", wrap(async (req, res) => {
  const { buffer, fileName, mimeType } = await documents.readAdminFile(req.params.id);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}));

// ---- Tiered pricing + commission (admin-only) ---------------------------
// Prices and rates are set here and resolved server-side at checkout; the
// browser never supplies either.
adminRouter.get("/products/:id/tiers", wrap(async (req, res) => {
  ok(res, { tiers: await pricing.listTiers(req.params.id) });
}));

// Replaces the whole ladder, so a partial edit can never leave two tiers
// claiming the same threshold.
adminRouter.put("/products/:id/tiers", wrap(async (req, res) => {
  ok(res, { tiers: await pricing.setTiers(req.params.id, req.body?.tiers ?? []) });
}));

adminRouter.patch("/products/:id/commission", wrap(async (req, res) => {
  ok(res, await pricing.setCommissionBps(req.params.id, req.body?.commissionBps));
}));

// ---- Payouts (admin-only settlement ledger) -----------------------------
adminRouter.get("/payouts", wrap(async (req, res) => {
  ok(res, await payouts.listPayouts({ supplierId: req.query.supplierId, status: req.query.status, take: req.query.take, skip: req.query.skip }));
}));

// Preview computes the chain WITHOUT writing, so an admin can check a cycle
// before freezing it.
adminRouter.get("/payouts/preview", wrap(async (req, res) => {
  ok(res, await payouts.previewPayout(req.query.supplierId, {
    periodStart: req.query.periodStart, periodEnd: req.query.periodEnd,
  }));
}));

adminRouter.post("/payouts", wrap(async (req, res) => {
  const { supplierId, periodStart, periodEnd, notes } = req.body ?? {};
  ok(res, await payouts.createPayout(req.user.id, supplierId, { periodStart, periodEnd, notes }), 201);
}));

adminRouter.post("/payouts/:id/pay", wrap(async (req, res) => {
  const updated = await payouts.markPaid(req.user.id, req.params.id, req.body ?? {});
  return updated ? ok(res, updated) : res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
}));

adminRouter.patch("/payouts/:id/status", wrap(async (req, res) => {
  const updated = await payouts.updatePayoutStatus(req.user.id, req.params.id, req.body?.status);
  return updated ? ok(res, updated) : res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
}));

// ---- CMS ----------------------------------------------------------------
adminRouter.get("/cms", wrap(async (_req, res) => ok(res, { blocks: await cms.listAllBlocks() })));

adminRouter.put("/cms", wrap(async (req, res) => ok(res, await cms.saveBlock(req.user.id, req.body ?? {}))));

adminRouter.delete("/cms/:key", wrap(async (req, res) => {
  const removed = await cms.deleteBlock(req.user.id, req.params.key);
  return removed ? ok(res, removed) : res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
}));
