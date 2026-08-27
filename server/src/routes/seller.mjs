// Seller (supplier) routes — all scoped to the caller's OWN organization.
// Mounted at /api/v1/sellers. Auth + supplier-org resolution are applied by the
// mount in index.mjs so req.supplierProfile is always the caller's own.
import { Router } from "express";
import { ok, wrap, forbidden, notFound } from "../lib/http.mjs";
import {
  onboardingPatchSchema, locationSchema, capabilitySchema, capacitySchema,
  machineSchema, materialSchema, certificationSchema, bankSchema, qualitySchema, logisticsSchema,
} from "../lib/validation.mjs";
import * as onboarding from "../services/onboarding.mjs";
import * as documents from "../services/documents.mjs";
import { sellerDashboard } from "../services/dashboard.mjs";
import * as ai from "../services/ai-tools.mjs";

export const sellerRouter = Router();

// Every seller route needs an existing supplier profile owned by the caller.
function profileOf(req) {
  if (!req.supplierProfile) throw notFound("No supplier profile for this account");
  return req.supplierProfile;
}

// Only owner/admin members may WRITE; staff is read-only for onboarding.
function assertWriter(req) {
  if (req.user.role === "seller_staff") throw forbidden("Staff cannot modify onboarding");
}

// Helper for write endpoints: assert writer, run handler, send result.
const write = (status, handler) =>
  wrap(async (req, res) => {
    assertWriter(req);
    ok(res, await handler(req), status);
  });

const removed = () => ({ removed: true });

sellerRouter.get("/me/onboarding", wrap(async (req, res) => {
  ok(res, await onboarding.getOnboarding(profileOf(req).id));
}));

sellerRouter.patch("/me/onboarding", write(200, (req) =>
  onboarding.patchProfile(profileOf(req), onboardingPatchSchema.parse(req.body), req.user.id)));

sellerRouter.post("/me/onboarding/submit", write(200, (req) =>
  onboarding.submit(profileOf(req), req.user.id)));

// ---- Child collections ----
sellerRouter.post("/me/locations", write(201, (req) => onboarding.addLocation(profileOf(req), locationSchema.parse(req.body), req.user.id)));
sellerRouter.delete("/me/locations/:id", write(200, (req) => onboarding.removeLocation(profileOf(req), req.params.id, req.user.id).then(removed)));

sellerRouter.post("/me/capabilities", write(201, (req) => onboarding.addCapability(profileOf(req), capabilitySchema.parse(req.body), req.user.id)));
sellerRouter.delete("/me/capabilities/:id", write(200, (req) => onboarding.removeCapability(profileOf(req), req.params.id, req.user.id).then(removed)));

sellerRouter.post("/me/machinery", write(201, (req) => onboarding.addMachine(profileOf(req), machineSchema.parse(req.body), req.user.id)));
sellerRouter.delete("/me/machinery/:id", write(200, (req) => onboarding.removeMachine(profileOf(req), req.params.id, req.user.id).then(removed)));

sellerRouter.post("/me/materials", write(201, (req) => onboarding.addMaterial(profileOf(req), materialSchema.parse(req.body), req.user.id)));
sellerRouter.delete("/me/materials/:id", write(200, (req) => onboarding.removeMaterial(profileOf(req), req.params.id, req.user.id).then(removed)));

sellerRouter.post("/me/certifications", write(201, (req) => onboarding.addCertification(profileOf(req), certificationSchema.parse(req.body), req.user.id)));
sellerRouter.delete("/me/certifications/:id", write(200, (req) => onboarding.removeCertification(profileOf(req), req.params.id, req.user.id).then(removed)));

sellerRouter.put("/me/capacity", write(200, (req) => onboarding.saveCapacity(profileOf(req), capacitySchema.parse(req.body), req.user.id)));
sellerRouter.put("/me/quality", write(200, (req) => onboarding.saveQuality(profileOf(req), qualitySchema.parse(req.body), req.user.id)));
sellerRouter.put("/me/logistics", write(200, (req) => onboarding.saveLogistics(profileOf(req), logisticsSchema.parse(req.body), req.user.id)));

sellerRouter.post("/me/bank-accounts", write(201, (req) => onboarding.addBankAccount(profileOf(req), bankSchema.parse(req.body), req.user.id)));
sellerRouter.delete("/me/bank-accounts/:id", write(200, (req) => onboarding.removeBankAccount(profileOf(req), req.params.id, req.user.id).then(removed)));

// ---- Documents ----
sellerRouter.get("/me/documents", wrap(async (req, res) => {
  ok(res, await documents.listForSupplier(profileOf(req).id));
}));

sellerRouter.post("/me/documents", write(201, (req) => documents.upload(profileOf(req), req.body, req.user.id)));

sellerRouter.delete("/me/documents/:id", write(200, (req) =>
  documents.removeOwn(profileOf(req), req.params.id, req.user.id).then(removed)));

// Authorized URL for the owner only.
// Stream the seller's own document. Bytes, not a URL — a URL would remain
// usable after the permission check that produced it.
sellerRouter.get("/me/documents/:id/file", wrap(async (req, res) => {
  const { buffer, fileName, mimeType } = await documents.readOwnFile(profileOf(req), req.params.id);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
  // Private data must never be cached by a shared proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}));

// ---- Dashboard + AI assistants (read-only, scoped to own profile) ----
sellerRouter.get("/me/dashboard", wrap(async (req, res) => {
  ok(res, await sellerDashboard(profileOf(req).id));
}));

sellerRouter.get("/me/ai/review-summary", wrap(async (req, res) => {
  ok(res, await ai.prepareSellerReviewSummary(profileOf(req).id));
}));

sellerRouter.get("/me/ai/suggested-categories", wrap(async (req, res) => {
  ok(res, { categories: await ai.suggestSellerCategories(profileOf(req).id) });
}));

sellerRouter.get("/me/ai/missing-documents", wrap(async (req, res) => {
  ok(res, { missing: await ai.detectMissingDocuments(profileOf(req).id) });
}));

// Settlement ledger, scoped to the caller's own supplier profile.
sellerRouter.get("/me/payouts", wrap(async (req, res) => {
  const { listPayouts } = await import("../services/payouts.mjs");
  ok(res, await listPayouts({ supplierId: profileOf(req).id, status: req.query.status }));
}));
