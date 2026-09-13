// Payment requests (custom payment links).
//   /api/v1/admin/payment-requests/*  admin create / review (mounted with requireAdmin)
//   /api/v1/me/payment-requests       the customer's own (mounted with requireBuyer)
//   /api/v1/public/pay/:token         token-only public page + submission (rate-limited)
import { Router } from "express";
import { createHash } from "node:crypto";
import { ok, wrap } from "../lib/http.mjs";
import { rateLimit } from "../middleware/rate-limit.mjs";
import * as pr from "../services/payment-requests.mjs";

const notFound = (res) => res.status(404).json({ success: false, error: "Payment link not found", code: "NOT_FOUND" });

// ---- Admin --------------------------------------------------------------
export const adminPaymentRequestsRouter = Router();

adminPaymentRequestsRouter.get("/", wrap(async (req, res) => {
  ok(res, await pr.listPaymentRequests({ status: req.query.status || null, userId: req.query.userId || null, orderId: req.query.orderId || null, take: req.query.take, skip: req.query.skip }));
}));

adminPaymentRequestsRouter.post("/", wrap(async (req, res) => ok(res, await pr.createPaymentRequest(req.user, req.body ?? {}), 201)));

adminPaymentRequestsRouter.get("/:id", wrap(async (req, res) => {
  const found = await pr.getPaymentRequest(req.params.id);
  return found ? ok(res, found) : res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
}));

adminPaymentRequestsRouter.post("/:id/approve", wrap(async (req, res) => ok(res, await pr.approvePaymentRequest(req.user, req.params.id, req.body ?? {}))));
adminPaymentRequestsRouter.post("/:id/reject", wrap(async (req, res) => ok(res, await pr.rejectPaymentRequest(req.user, req.params.id, req.body ?? {}))));
adminPaymentRequestsRouter.post("/:id/cancel", wrap(async (req, res) => ok(res, await pr.cancelPaymentRequest(req.user, req.params.id))));
adminPaymentRequestsRouter.post("/:id/resend", wrap(async (req, res) => ok(res, await pr.resendPaymentRequest(req.user, req.params.id))));

adminPaymentRequestsRouter.get("/:id/proof", wrap(async (req, res) => {
  const { buffer, fileName, mimeType } = await pr.readProof(req.params.id);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}));

// ---- Buyer --------------------------------------------------------------
export const buyerPaymentRequestsRouter = Router();
buyerPaymentRequestsRouter.get("/", wrap(async (req, res) => ok(res, await pr.listMine(req.user.id, { orderId: req.query.orderId || null }))));

// ---- Public (token) -----------------------------------------------------
// Keyed on the token hash so a brute-force sweep is throttled per link (and
// per IP), matching the refresh-token limiter precedent.
const tokenKey = (req) => `${req.ip}:${createHash("sha256").update(String(req.params.token ?? "")).digest("hex").slice(0, 16)}`;
const readLimit = rateLimit({ windowMs: 60_000, max: 60, keyFn: tokenKey, message: "Too many requests — please wait a minute." });
const submitLimit = rateLimit({ windowMs: 15 * 60_000, max: 10, keyFn: tokenKey, message: "Too many submissions — please wait before trying again." });

export const publicPayRouter = Router();

publicPayRouter.get("/:token", readLimit, wrap(async (req, res) => {
  const found = await pr.getByToken(req.params.token);
  return found ? ok(res, found) : notFound(res);
}));

publicPayRouter.post("/:token/submit", submitLimit, wrap(async (req, res) => {
  ok(res, await pr.submitByToken(req.params.token, req.body ?? {}), 201);
}));
