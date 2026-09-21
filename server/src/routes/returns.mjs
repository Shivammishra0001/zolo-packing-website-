// PRODUCT RETURN routes. (Recycling + Eco Credits: routes/recycling.mjs.)
//   /api/v1/returns/*        customer-owned (authenticated; owner-scoped)
//   /api/v1/admin/returns/*  admin review + processing (requireAdmin at mount)
//
// There is deliberately NO admin creation endpoint: a return/recycle request
// exists only because a customer submitted it.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import * as returns from "../services/returns.mjs";

function sendFile(res, { buffer, fileName, mimeType }) {
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

// ---- Customer --------------------------------------------------------------
export const returnsRouter = Router();

returnsRouter.get("/", wrap(async (req, res) => ok(res, { requests: await returns.listMine(req.user.id, { type: req.query.type }) })));

returnsRouter.post("/", wrap(async (req, res) => ok(res, await returns.createRequest(req.user.id, req.body ?? {}), 201)));

// Remaining returnable quantity for an order item (drives the dialog's max).
returnsRouter.get("/remaining", wrap(async (req, res) =>
  ok(res, await returns.remainingFor(req.user.id, { orderItemId: req.query.orderItemId, quantity: req.query.quantity }))));

returnsRouter.get("/:id", wrap(async (req, res) => ok(res, await returns.getMine(req.user.id, req.params.id))));

returnsRouter.post("/:id/cancel", wrap(async (req, res) => ok(res, await returns.cancelMine(req.user.id, req.params.id))));

returnsRouter.post("/:id/files", wrap(async (req, res) => ok(res, await returns.attachFile(req.user.id, req.params.id, req.body ?? {}), 201)));

returnsRouter.get("/:id/files/:fileId/download", wrap(async (req, res) =>
  sendFile(res, await returns.readFile({ kind: "buyer", userId: req.user.id }, req.params.id, req.params.fileId))));

// ---- Admin -----------------------------------------------------------------
export const adminReturnsRouter = Router();

adminReturnsRouter.get("/", wrap(async (req, res) => {
  const { type, status, resolution, q, take, skip } = req.query;
  ok(res, await returns.adminList({ type, status, resolution, q, take, skip }));
}));

adminReturnsRouter.get("/:id", wrap(async (req, res) => {
  const found = await returns.adminGet(req.params.id);
  return found ? ok(res, found) : res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
}));

adminReturnsRouter.get("/:id/files/:fileId/download", wrap(async (req, res) => {
  const detail = await returns.adminGet(req.params.id);
  if (!detail) return res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
  sendFile(res, await returns.readFile({ kind: "admin" }, detail.id, req.params.fileId));
}));

adminReturnsRouter.post("/:id/review", wrap(async (req, res) => ok(res, await returns.adminReview(req.user.id, req.params.id))));
adminReturnsRouter.post("/:id/approve", wrap(async (req, res) => ok(res, await returns.adminApprove(req.user.id, req.params.id, req.body ?? {}))));
adminReturnsRouter.post("/:id/reject", wrap(async (req, res) => ok(res, await returns.adminReject(req.user.id, req.params.id, req.body ?? {}))));
adminReturnsRouter.post("/:id/resolution", wrap(async (req, res) => ok(res, await returns.adminSetResolution(req.user.id, req.params.id, req.body ?? {}))));
adminReturnsRouter.post("/:id/refund", wrap(async (req, res) => ok(res, await returns.adminCompleteRefund(req.user.id, req.params.id, req.body ?? {}))));
adminReturnsRouter.post("/:id/replacement/ship", wrap(async (req, res) => ok(res, await returns.adminShipReplacement(req.user.id, req.params.id, req.body ?? {}))));
adminReturnsRouter.post("/:id/replacement/deliver", wrap(async (req, res) => ok(res, await returns.adminDeliverReplacement(req.user.id, req.params.id))));
// Physical flow of a return: goods come back and are inspected.
adminReturnsRouter.post("/:id/pickup", wrap(async (req, res) => ok(res, await returns.adminSchedulePickup(req.user.id, req.params.id, req.body ?? {}))));
adminReturnsRouter.post("/:id/received", wrap(async (req, res) => ok(res, await returns.adminMarkReceived(req.user.id, req.params.id))));
adminReturnsRouter.post("/:id/inspection", wrap(async (req, res) => ok(res, await returns.adminInspect(req.user.id, req.params.id, req.body ?? {}))));
// Legacy order-item recycle rows only: let them be finished and closed.
adminReturnsRouter.post("/:id/recycle/start", wrap(async (req, res) => ok(res, await returns.adminStartRecycleProcessing(req.user.id, req.params.id))));
adminReturnsRouter.post("/:id/recycle/complete", wrap(async (req, res) => ok(res, await returns.adminCompleteRecycle(req.user.id, req.params.id))));
adminReturnsRouter.post("/:id/close", wrap(async (req, res) => ok(res, await returns.adminClose(req.user.id, req.params.id))));
