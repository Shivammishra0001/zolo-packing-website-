// AdSens by Zolo — public consultation intake + admin lead management.
//
//   publicAdsensRouter  mounted at /api/v1/public/adsens  (NO auth)
//   adminAdsensRouter   mounted at /api/v1/admin/marketing (authenticate + requireAdmin)
//
// The public router is the only unauthenticated write path in this feature, so
// it is rate limited and never returns anybody else's lead data.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import { rateLimit } from "../middleware/rate-limit.mjs";
import * as adsens from "../services/adsens.mjs";
import * as showcase from "../services/adsens-showcase.mjs";

// ---- Public -------------------------------------------------------------

export const publicAdsensRouter = Router();

/** Services and packages the /adsens page renders. Safe, published data only. */
publicAdsensRouter.get("/catalog", wrap(async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  ok(res, await adsens.publicCatalog());
}));

/** Campaign previews + portfolio cards for the showcase sections. Published
 *  rows only — the service strips unverified results before they reach here. */
publicAdsensRouter.get("/showcase", wrap(async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  ok(res, await showcase.publicShowcase());
}));

/** One case study. An unpublished slug is a 404, like any record the caller
 *  is not entitled to — we never confirm that a draft exists. */
publicAdsensRouter.get("/case-studies/:slug", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  ok(res, { caseStudy: await showcase.publicCaseStudy(req.params.slug) });
}));

/** Spam brake. Keyed on IP **and** email, like the login limiter: a shared
 *  office or NAT address can hold several genuine businesses, and blocking a
 *  real second enquiry because a colleague wrote in first is worse than
 *  letting a determined spammer rotate addresses — the per-IP ceiling below
 *  still bounds that. */
const leadRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  keyFn: (req) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    return `adsens-lead:${req.ip || "unknown"}:${email}`;
  },
  message: "We've already received your enquiry. Please wait a little while, or call us directly.",
});

/** Blunt per-IP ceiling for scripted floods across many addresses. */
const leadIpRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  max: 40,
  keyFn: (req) => `adsens-ip:${req.ip || "unknown"}`,
  message: "Too many enquiries from this connection. Please try again later.",
});

publicAdsensRouter.post("/consultation", leadIpRateLimit, leadRateLimit, wrap(async (req, res) => {
  const { lead, duplicate } = await adsens.submitLead(req.body ?? {}, { ip: req.ip ?? null });

  // Fire notifications AFTER the lead is committed, and never let a provider
  // failure turn a saved lead into an error for the visitor (§10: never show
  // success unless it was actually saved — and the converse, never show a
  // failure for something that was).
  if (!duplicate) adsens.notifyNewLead(lead).catch(() => {});

  // Only the reference number goes back. The stored record is private.
  ok(res, {
    leadNumber: lead.leadNumber,
    duplicate,
    message: "Thank you for contacting AdSens by Zolo! Your enquiry has been received successfully. Our team will review your requirements and contact you shortly.",
  }, duplicate ? 200 : 201);
}));

// ---- Admin --------------------------------------------------------------

export const adminAdsensRouter = Router();

adminAdsensRouter.get("/leads", wrap(async (req, res) => {
  ok(res, await adsens.listLeads(req.query));
}));

adminAdsensRouter.get("/leads/:id", wrap(async (req, res) => {
  ok(res, { lead: await adsens.getLead(req.params.id) });
}));

/** Status, assignment, follow-up date and notes all land here. */
adminAdsensRouter.patch("/leads/:id", wrap(async (req, res) => {
  ok(res, { lead: await adsens.updateLead(req.user.id, req.params.id, req.body ?? {}) });
}));

/** Link a WON lead to an EXISTING customer account — never creates one. */
adminAdsensRouter.post("/leads/:id/convert", wrap(async (req, res) => {
  ok(res, { lead: await adsens.convertLead(req.user.id, req.params.id, req.body ?? {}) });
}));

// ---- Admin: showcase content -------------------------------------------
//
// Campaigns and case studies are the content behind the two showcase rails on
// /adsens. Nothing is hardcoded in the frontend, so these are the only way
// that content exists at all.

adminAdsensRouter.get("/campaigns", wrap(async (_req, res) => {
  ok(res, await showcase.listCampaigns());
}));

adminAdsensRouter.post("/campaigns", wrap(async (req, res) => {
  ok(res, { campaign: await showcase.createCampaign(req.user.id, req.body ?? {}) }, 201);
}));

adminAdsensRouter.patch("/campaigns/:id", wrap(async (req, res) => {
  ok(res, { campaign: await showcase.updateCampaign(req.user.id, req.params.id, req.body ?? {}) });
}));

adminAdsensRouter.delete("/campaigns/:id", wrap(async (req, res) => {
  ok(res, await showcase.deleteCampaign(req.user.id, req.params.id));
}));

adminAdsensRouter.get("/case-studies", wrap(async (_req, res) => {
  ok(res, await showcase.listCaseStudies());
}));

adminAdsensRouter.get("/case-studies/:id", wrap(async (req, res) => {
  ok(res, { caseStudy: await showcase.getCaseStudy(req.params.id) });
}));

adminAdsensRouter.post("/case-studies", wrap(async (req, res) => {
  ok(res, { caseStudy: await showcase.createCaseStudy(req.user.id, req.body ?? {}) }, 201);
}));

adminAdsensRouter.patch("/case-studies/:id", wrap(async (req, res) => {
  ok(res, { caseStudy: await showcase.updateCaseStudy(req.user.id, req.params.id, req.body ?? {}) });
}));

adminAdsensRouter.delete("/case-studies/:id", wrap(async (req, res) => {
  ok(res, await showcase.deleteCaseStudy(req.user.id, req.params.id));
}));
