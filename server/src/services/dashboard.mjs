// Seller dashboard aggregation. Returns REAL counts from the database. Modules
// not yet built (RFQs, quotes, orders, production, QC, inventory, payments)
// report 0 with `available:false` so the UI shows honest empty states rather
// than fabricated metrics.
import { prisma } from "../lib/prisma.mjs";
import { computeCompleteness } from "./onboarding.mjs";
import { expiringForSupplier } from "./documents.mjs";

const pending = (label) => ({ count: 0, available: false, note: `${label} module not yet available` });

export async function sellerDashboard(supplierId) {
  const profile = await prisma.supplierProfile.findUnique({
    where: { id: supplierId },
    include: { locations: true, capabilities: true, capacity: true, documents: true, bankAccounts: true },
  });
  if (!profile) return null;

  const completeness = computeCompleteness(profile);
  const filledSections = Object.values(completeness.sections).filter(Boolean).length;
  const totalSections = Object.keys(completeness.sections).length;
  const expiring = await expiringForSupplier(supplierId, 30);

  return {
    status: profile.status,
    verificationStatus: profile.verificationStatus,
    profileCompletion: Math.round((filledSections / totalSections) * 100),
    completeness,
    documentsExpiring: expiring.documents.length + expiring.certifications.length,
    expiring,
    counts: {
      documents: profile.documents.length,
      capabilities: profile.capabilities.length,
      locations: profile.locations.length,
      // Future modules — honest empty states:
      pendingRfqs: pending("RFQ"),
      quotes: pending("Quotes"),
      orders: pending("Orders"),
      production: pending("Production"),
      qc: pending("QC"),
      inventory: pending("Inventory"),
      payments: pending("Payments"),
    },
    actionRequired: buildActions(profile, completeness, expiring),
  };
}

function buildActions(profile, completeness, expiring) {
  const actions = [];
  if (profile.status === "DRAFT" && !completeness.canSubmit) {
    actions.push({ kind: "complete_profile", message: `Complete ${completeness.missing.length} section(s) to submit`, sections: completeness.missing });
  }
  if (profile.status === "DRAFT" && completeness.canSubmit) {
    actions.push({ kind: "submit", message: "Your profile is ready — submit for review" });
  }
  if (profile.status === "SUBMITTED") {
    actions.push({ kind: "under_review", message: "Application submitted — waiting for our team to review it. No action needed from you right now." });
  }
  if (profile.status === "UNDER_REVIEW") {
    actions.push({ kind: "under_review", message: "Your application is being reviewed by our team." });
  }
  if (profile.status === "APPROVED") {
    actions.push({ kind: "approved", message: "Your seller account is approved and active. 🎉" });
  }
  if (profile.status === "REJECTED") {
    actions.push({ kind: "rejected", message: "Your application was not approved. Please contact support for next steps." });
  }
  if (profile.status === "CHANGES_REQUESTED") {
    actions.push({ kind: "address_changes", message: "Admin requested changes — review and resubmit" });
  }
  if (expiring.documents.length + expiring.certifications.length > 0) {
    actions.push({ kind: "renew_documents", message: "Some documents/certifications are expiring soon" });
  }
  return actions;
}
