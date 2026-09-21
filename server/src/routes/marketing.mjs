// Marketing: coupons + campaigns.
//
//   /admin/coupons/*     admin only (mounted behind authenticate + requireAdmin)
//   /admin/campaigns/*   admin only
//   /campaigns/active    PUBLIC — the storefront reads live campaigns from here
//
// Customers never reach a write route, and the public route only ever returns
// campaigns the server itself judged live (see listActiveCampaigns).
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import * as coupons from "../services/coupons.mjs";
import * as campaigns from "../services/campaigns.mjs";

export const adminCouponsRouter = Router();

adminCouponsRouter.get("/", wrap(async (req, res) => {
  ok(res, await coupons.listCoupons({ status: req.query.status, search: req.query.search, limit: req.query.limit }));
}));
adminCouponsRouter.post("/", wrap(async (req, res) => ok(res, await coupons.createCoupon(req.user.id, req.body ?? {}), 201)));
adminCouponsRouter.get("/:id", wrap(async (req, res) => ok(res, await coupons.getCoupon(req.params.id))));
adminCouponsRouter.patch("/:id", wrap(async (req, res) => ok(res, await coupons.updateCoupon(req.user.id, req.params.id, req.body ?? {}))));
// DELETE archives (soft delete): redemption history and old orders keep their coupon.
adminCouponsRouter.delete("/:id", wrap(async (req, res) => ok(res, await coupons.archiveCoupon(req.user.id, req.params.id))));

export const adminCampaignsRouter = Router();

adminCampaignsRouter.get("/", wrap(async (req, res) => {
  ok(res, await campaigns.listCampaigns({ status: req.query.status, search: req.query.search, limit: req.query.limit }));
}));
adminCampaignsRouter.post("/", wrap(async (req, res) => ok(res, await campaigns.createCampaign(req.user.id, req.body ?? {}), 201)));
adminCampaignsRouter.get("/:id", wrap(async (req, res) => ok(res, await campaigns.getCampaign(req.params.id))));
adminCampaignsRouter.patch("/:id", wrap(async (req, res) => ok(res, await campaigns.updateCampaign(req.user.id, req.params.id, req.body ?? {}))));
adminCampaignsRouter.delete("/:id", wrap(async (req, res) => ok(res, await campaigns.archiveCampaign(req.user.id, req.params.id))));

export const publicCampaignsRouter = Router();

// GET /campaigns/active?placement=homepage_popup
publicCampaignsRouter.get("/active", wrap(async (req, res) => {
  const placement = typeof req.query.placement === "string" ? req.query.placement : undefined;
  // Never cached by the browser/CDN: pausing or archiving a campaign has to take
  // it off the storefront on the very next page load. The query is one indexed
  // read; the storefront itself only re-polls once a minute.
  res.setHeader("Cache-Control", "no-store");
  ok(res, { campaigns: await campaigns.listActiveCampaigns({ placement }), serverTime: new Date().toISOString() });
}));
