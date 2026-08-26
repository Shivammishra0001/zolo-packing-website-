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
  const { items, title, notes, requiredBy, ship, submit } = req.body ?? {};
  ok(res, await rfq.createRfq(req.user.id, { items, title, notes, requiredBy, ship, submit: submit !== false }), 201);
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
