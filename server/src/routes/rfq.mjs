// RFQ + Quotation routes.
//   /api/v1/rfqs/*        buyer-owned (authenticated)
//   /api/v1/quotations/*  buyer responds to quotations
//   /api/v1/admin/rfqs/*  admin queue + pricing
//
// Ownership is enforced in the service by querying on { id, userId }: a
// foreign RFQ returns null and 404s here rather than 403ing, so the API never
// confirms that someone else's RFQ number exists.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import { authenticate, requireAdmin } from "../middleware/auth.mjs";
import * as rfq from "../services/rfq.mjs";

const notFound = (res) => res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });

// ---- Buyer ---------------------------------------------------------------
export const rfqRouter = Router();
rfqRouter.use(authenticate);

rfqRouter.get("/", wrap(async (req, res) => ok(res, { rfqs: await rfq.listMyRfqs(req.user.id, { status: req.query.status }) })));

rfqRouter.post("/", wrap(async (req, res) => {
  const { items, title, notes, requiredBy, ship, submit, autoMatch } = req.body ?? {};
  ok(res, await rfq.createRfq(req.user.id, { items, title, notes, requiredBy, ship, submit: submit !== false, autoMatch: autoMatch !== false }), 201);
}));

rfqRouter.get("/:id", wrap(async (req, res) => {
  const found = await rfq.getMyRfq(req.user.id, req.params.id);
  return found ? ok(res, found) : notFound(res);
}));

rfqRouter.post("/:id/cancel", wrap(async (req, res) => {
  const updated = await rfq.cancelMyRfq(req.user.id, req.params.id);
  return updated ? ok(res, updated) : notFound(res);
}));

// ---- Buyer responds to a quotation ---------------------------------------
export const quotationRouter = Router();
quotationRouter.use(authenticate);

quotationRouter.post("/:id/accept", wrap(async (req, res) => {
  const result = await rfq.acceptQuotation(req.user.id, req.params.id);
  return result ? ok(res, result, 201) : notFound(res);
}));

quotationRouter.post("/:id/respond", wrap(async (req, res) => {
  const { action, message } = req.body ?? {};
  const updated = await rfq.respondToQuotation(req.user.id, req.params.id, { action, message });
  return updated ? ok(res, updated) : notFound(res);
}));

// ---- Admin ---------------------------------------------------------------
export const adminRfqRouter = Router();
adminRfqRouter.use(authenticate, requireAdmin);

adminRfqRouter.get("/", wrap(async (req, res) => {
  const { status, q, take, skip } = req.query;
  ok(res, await rfq.adminListRfqs({ status, q, take, skip }));
}));

adminRfqRouter.get("/:id", wrap(async (req, res) => {
  const found = await rfq.adminGetRfq(req.params.id);
  return found ? ok(res, found) : notFound(res);
}));

adminRfqRouter.post("/:id/review", wrap(async (req, res) => {
  const updated = await rfq.adminMarkUnderReview(req.user.id, req.params.id);
  return updated ? ok(res, updated) : notFound(res);
}));

adminRfqRouter.post("/:id/quotations", wrap(async (req, res) => {
  ok(res, await rfq.adminCreateQuotation(req.user.id, req.params.id, req.body ?? {}), 201);
}));

// ---- Marketplace: seller leads, competing quotes, messaging --------------
// Mounted at /api/v1/sellers/rfqs (seller) and extended onto the buyer routers.
// supplierId ALWAYS comes from req.supplierProfile — never from the body — so
// a seller cannot act as one of their rivals.
import * as marketplace from "../services/marketplace.mjs";

export const sellerRfqRouter = Router();

sellerRfqRouter.get("/", wrap(async (req, res) => {
  ok(res, { leads: await marketplace.listSellerLeads(req.supplierProfile.id, { status: req.query.status }) });
}));

sellerRfqRouter.post("/:rfqId/view", wrap(async (req, res) => {
  const m = await marketplace.markLeadViewed(req.supplierProfile.id, req.params.rfqId);
  return m ? ok(res, m) : notFound(res);
}));

sellerRfqRouter.post("/:rfqId/decline", wrap(async (req, res) => {
  const m = await marketplace.declineLead(req.supplierProfile.id, req.params.rfqId);
  return m ? ok(res, m) : notFound(res);
}));

sellerRfqRouter.post("/:rfqId/quote", wrap(async (req, res) => {
  ok(res, await marketplace.sellerSubmitQuote(req.supplierProfile.id, req.user.id, req.params.rfqId, req.body ?? {}), 201);
}));

// ---- Messaging (buyer or invited seller) ---------------------------------
quotationRouter.get("/:id/history", wrap(async (req, res) => {
  ok(res, { versions: await marketplace.quoteHistory(req.params.id) });
}));

rfqRouter.get("/:id/messages", wrap(async (req, res) => {
  const msgs = await marketplace.listMessages(req.user, req.params.id, req.query.supplierId);
  return msgs ? ok(res, { messages: msgs }) : notFound(res);
}));

rfqRouter.post("/:id/messages", wrap(async (req, res) => {
  ok(res, await marketplace.postMessage(req.user, req.params.id, req.body ?? {}), 201);
}));

// Admin can re-run matching if the first fan-out found nobody.
adminRfqRouter.post("/:id/match", wrap(async (req, res) => {
  ok(res, await marketplace.matchRfqToSuppliers(req.params.id));
}));

// ---- Saved requirement profiles (buyer) ---------------------------------
import * as saved from "../services/saved-requirements.mjs";

rfqRouter.get("/saved/list", wrap(async (req, res) => {
  ok(res, { requirements: await saved.listMine(req.user.id) });
}));

rfqRouter.post("/saved", wrap(async (req, res) => {
  ok(res, await saved.save(req.user.id, req.body ?? {}), 201);
}));

rfqRouter.delete("/saved/:id", wrap(async (req, res) => {
  const removed = await saved.remove(req.user.id, req.params.id);
  return removed ? ok(res, { deleted: true }) : notFound(res);
}));
