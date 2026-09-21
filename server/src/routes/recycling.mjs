// Recycling + Eco Credits routes.
//
//   /recycling/program            PUBLIC — accepted materials, live rates, reward conversion
//   /recycling/requests/*         customer-owned (authenticated; owner-scoped)
//   /eco-credits/*                customer wallet, redemption, own reward coupons
//   /admin/recycling/*            rules + request verification   (requireAdmin at mount)
//   /admin/eco-credits/*          ledger, adjustments, settings   (requireAdmin at mount)
//
// A customer can only ever create/cancel/read THEIR requests and redeem THEIR
// credits; every quantity that matters and every credit amount is decided by
// the server from admin-owned rules and settings.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import * as recycling from "../services/recycling.mjs";
import * as eco from "../services/eco-credits.mjs";

function sendFile(res, { buffer, fileName, mimeType }) {
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

// ---- Public ----------------------------------------------------------------
export const publicRecyclingRouter = Router();
publicRecyclingRouter.get("/program", wrap(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  ok(res, await recycling.program());
}));

// ---- Customer --------------------------------------------------------------
export const recyclingRouter = Router();
recyclingRouter.get("/requests", wrap(async (req, res) => ok(res, await recycling.listMine(req.user.id))));
recyclingRouter.post("/requests", wrap(async (req, res) => ok(res, await recycling.createRequest(req.user.id, req.body ?? {}), 201)));
recyclingRouter.get("/requests/:id", wrap(async (req, res) => ok(res, await recycling.getMine(req.user.id, req.params.id))));
recyclingRouter.post("/requests/:id/cancel", wrap(async (req, res) => ok(res, await recycling.cancelMine(req.user.id, req.params.id))));
recyclingRouter.post("/requests/:id/files", wrap(async (req, res) => ok(res, await recycling.attachFile(req.user.id, req.params.id, req.body ?? {}), 201)));
recyclingRouter.get("/requests/:id/files/:fileId/download", wrap(async (req, res) =>
  sendFile(res, await recycling.readFile({ kind: "buyer", userId: req.user.id }, req.params.id, req.params.fileId))));

export const ecoCreditsRouter = Router();
ecoCreditsRouter.get("/", wrap(async (req, res) => ok(res, await eco.wallet(req.user.id))));
ecoCreditsRouter.get("/coupons", wrap(async (req, res) => ok(res, await eco.myRewardCoupons(req.user.id))));
// The body carries only HOW MANY rewards; the cost, the value, the expiry and
// the owner all come from the settings row and the session.
ecoCreditsRouter.post("/redeem", wrap(async (req, res) => ok(res, await eco.redeem(req.user.id, { units: req.body?.units }), 201)));

// ---- Admin -----------------------------------------------------------------
export const adminRecyclingRouter = Router();
adminRecyclingRouter.get("/overview", wrap(async (_req, res) => ok(res, await recycling.overview())));

adminRecyclingRouter.get("/rules", wrap(async (req, res) => ok(res, await recycling.listRules({ includeArchived: req.query.includeArchived === "1" }))));
adminRecyclingRouter.post("/rules", wrap(async (req, res) => ok(res, await recycling.createRule(req.user.id, req.body ?? {}), 201)));
adminRecyclingRouter.patch("/rules/:id", wrap(async (req, res) => ok(res, await recycling.updateRule(req.user.id, req.params.id, req.body ?? {}))));
adminRecyclingRouter.post("/rules/:id/activate", wrap(async (req, res) => ok(res, await recycling.updateRule(req.user.id, req.params.id, { isActive: true }))));
adminRecyclingRouter.post("/rules/:id/deactivate", wrap(async (req, res) => ok(res, await recycling.updateRule(req.user.id, req.params.id, { isActive: false }))));
adminRecyclingRouter.delete("/rules/:id", wrap(async (req, res) => ok(res, await recycling.archiveRule(req.user.id, req.params.id))));

adminRecyclingRouter.get("/requests", wrap(async (req, res) => {
  const { status, material, q, take, skip } = req.query;
  ok(res, await recycling.adminList({ status, material, q, take, skip }));
}));
adminRecyclingRouter.get("/requests/:id", wrap(async (req, res) => ok(res, await recycling.adminGet(req.params.id))));
adminRecyclingRouter.get("/requests/:id/files/:fileId/download", wrap(async (req, res) => {
  const detail = await recycling.adminGet(req.params.id);
  sendFile(res, await recycling.readFile({ kind: "admin" }, detail.id, req.params.fileId));
}));
adminRecyclingRouter.post("/requests/:id/pickup", wrap(async (req, res) => ok(res, await recycling.adminSchedulePickup(req.user.id, req.params.id, req.body ?? {}))));
adminRecyclingRouter.post("/requests/:id/received", wrap(async (req, res) => ok(res, await recycling.adminMarkReceived(req.user.id, req.params.id))));
adminRecyclingRouter.post("/requests/:id/verify", wrap(async (req, res) => ok(res, await recycling.adminVerify(req.user.id, req.params.id, req.body ?? {}))));
adminRecyclingRouter.post("/requests/:id/approve", wrap(async (req, res) => ok(res, await recycling.adminApprove(req.user.id, req.params.id, req.body ?? {}))));
adminRecyclingRouter.post("/requests/:id/reject", wrap(async (req, res) => ok(res, await recycling.adminReject(req.user.id, req.params.id, req.body ?? {}))));

export const adminEcoCreditsRouter = Router();
adminEcoCreditsRouter.get("/overview", wrap(async (_req, res) => ok(res, await eco.dashboard())));
adminEcoCreditsRouter.get("/transactions", wrap(async (req, res) => {
  const { userId, customer, type, from, to, material, requestNumber, take, skip } = req.query;
  ok(res, await eco.listTransactions({ userId, customer, type, from, to, material, requestNumber, take, skip }));
}));
adminEcoCreditsRouter.get("/customers", wrap(async (req, res) => ok(res, await eco.searchCustomers(req.query.q))));
adminEcoCreditsRouter.get("/customers/:userId", wrap(async (req, res) => ok(res, await eco.customerLedger(req.params.userId))));
adminEcoCreditsRouter.post("/adjustments", wrap(async (req, res) => ok(res, await eco.manualAdjustment(req.user.id, req.body ?? {}), 201)));
adminEcoCreditsRouter.post("/coupons/:id/revoke", wrap(async (req, res) => ok(res, await eco.revokeRewardCoupon(req.user.id, req.params.id, req.body ?? {}))));
adminEcoCreditsRouter.post("/expire", wrap(async (req, res) => ok(res, await eco.runExpiry(req.user.id))));
adminEcoCreditsRouter.get("/settings", wrap(async (_req, res) => ok(res, await eco.getSettings())));
adminEcoCreditsRouter.put("/settings", wrap(async (req, res) => ok(res, await eco.updateSettings(req.user.id, req.body ?? {}))));
