// Field-sales routes.
//   /api/v1/sales/*        the rep's own mobile portal (requireSalesperson)
//   /api/v1/admin/sales/*  admin management + performance (requireAdmin)
//
// Every rep-facing query is scoped to req.user inside the service, so a rep
// can only ever read or write their own captured orders. Customers are shared
// on purpose — see the note in services/sales.mjs.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import * as sales from "../services/sales.mjs";

const notFound = (res) => res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });

export const salesRouter = Router();

salesRouter.get("/me", wrap(async (req, res) => ok(res, await sales.requireProfile(req.user))));

// ---- Customers (shared, with attribution) --------------------------------
salesRouter.get("/customers/search", wrap(async (req, res) => {
  ok(res, { customers: await sales.searchCustomers(req.query.q, { take: req.query.take }) });
}));

salesRouter.post("/customers", wrap(async (req, res) => {
  ok(res, await sales.createCustomer(req.user, req.body ?? {}), 201);
}));

// The card the rep sees after picking a customer: history, outstanding, and
// the previous line items that make a repeat order a two-tap job.
salesRouter.get("/customers/:id/snapshot", wrap(async (req, res) => {
  const snap = await sales.customerSnapshot(req.params.id);
  return snap ? ok(res, snap) : notFound(res);
}));

// ---- Orders --------------------------------------------------------------
salesRouter.post("/orders", wrap(async (req, res) => {
  ok(res, await sales.createOrder(req.user, req.body ?? {}), 201);
}));

salesRouter.get("/orders", wrap(async (req, res) => {
  const { from, to, paymentStatus, take } = req.query;
  ok(res, { orders: await sales.listMyOrders(req.user, { from, to, paymentStatus, take }) });
}));

salesRouter.get("/orders/:id", wrap(async (req, res) => {
  const order = await sales.getMyOrder(req.user, req.params.id);
  return order ? ok(res, order) : notFound(res);
}));

// ---- Samples -------------------------------------------------------------
salesRouter.post("/orders/:id/samples", wrap(async (req, res) => {
  const sample = await sales.addSample(req.user, req.params.id, req.body ?? {});
  return sample ? ok(res, sample, 201) : notFound(res);
}));

salesRouter.delete("/orders/:id/samples/:sampleId", wrap(async (req, res) => {
  const removed = await sales.removeSample(req.user, req.params.id, req.params.sampleId);
  return removed ? ok(res, { deleted: true }) : notFound(res);
}));

// ---- The rep's own dashboard --------------------------------------------
salesRouter.get("/kpis", wrap(async (req, res) => {
  ok(res, await sales.salespersonKpis(req.user.id, { from: req.query.from, to: req.query.to }));
}));

// ---- Admin ---------------------------------------------------------------
export const adminSalesRouter = Router();

adminSalesRouter.get("/salespeople", wrap(async (req, res) => {
  ok(res, { salespeople: await sales.adminListSalespeople({ status: req.query.status }) });
}));

// Reps can never self-register: the role writes to customers and payments.
adminSalesRouter.post("/salespeople", wrap(async (req, res) => {
  ok(res, await sales.adminCreateSalesperson(req.user, req.body ?? {}), 201);
}));

adminSalesRouter.patch("/salespeople/:id/status", wrap(async (req, res) => {
  const updated = await sales.adminSetStatus(req.user, req.params.id, req.body?.status);
  return updated ? ok(res, updated) : notFound(res);
}));

// One directory across customers, sales staff and sellers — the admin screen
// asks "who?" before "which module?".
adminSalesRouter.get("/users", wrap(async (req, res) => {
  ok(res, await sales.adminListUsers({ type: req.query.type, q: req.query.q, take: req.query.take }));
}));

/**
 * One representative in full. Separate from /performance, which is the
 * leaderboard: this is the drill-down behind a row.
 */
adminSalesRouter.get("/salespeople/:id/detail", wrap(async (req, res) => {
  const detail = await sales.adminSalespersonDetail(req.params.id, { from: req.query.from, to: req.query.to });
  if (!detail) return notFound(res);
  ok(res, detail);
}));

adminSalesRouter.get("/performance", wrap(async (req, res) => {
  ok(res, { rows: await sales.adminSalesPerformance({ from: req.query.from, to: req.query.to }) });
}));
