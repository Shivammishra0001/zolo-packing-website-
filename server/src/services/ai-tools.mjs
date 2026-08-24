// Zolo AI tool abstractions — READ-ONLY, authorization-scoped functions the AI
// layer may call. These NEVER mutate sellers, bank data, verification status, or
// legal fields. High-impact actions require human approval and are intentionally
// absent here. Every tool takes an explicit `supplierId` the caller has already
// authorized; the tools do not resolve identity themselves.
import { prisma } from "../lib/prisma.mjs";
import { computeCompleteness } from "./onboarding.mjs";
import { expiringForSupplier } from "./documents.mjs";
import { scoreSupplier } from "./matching.mjs";

async function loadForCompleteness(supplierId) {
  return prisma.supplierProfile.findUnique({
    where: { id: supplierId },
    include: { locations: true, capabilities: true, capacity: true, documents: true, bankAccounts: true },
  });
}

export async function getSellerOnboardingStatus(supplierId) {
  const p = await loadForCompleteness(supplierId);
  if (!p) return null;
  const c = computeCompleteness(p);
  return { status: p.status, verificationStatus: p.verificationStatus, onboardingStep: p.onboardingStep, canSubmit: c.canSubmit, missing: c.missing };
}

export async function getMissingSellerInformation(supplierId) {
  const p = await loadForCompleteness(supplierId);
  if (!p) return null;
  return computeCompleteness(p).missing;
}

export async function summarizeSellerProfile(supplierId) {
  const p = await prisma.supplierProfile.findUnique({
    where: { id: supplierId },
    include: { capabilities: true, locations: true, capacity: true, certifications: true },
  });
  if (!p) return null;
  return {
    displayName: p.displayName,
    businessType: p.businessType,
    status: p.status,
    capabilities: p.capabilities.map((c) => c.category),
    locations: p.locations.map((l) => `${l.city}, ${l.state} (${l.locationType})`),
    monthlyCapacity: p.capacity?.monthlyCapacity ?? null,
    certifications: p.certifications.map((c) => c.name),
  };
}

/** Suggest catalog categories the seller could add, based on existing Product taxonomy. */
export async function suggestSellerCategories(supplierId) {
  const [existing, catalogCats] = await Promise.all([
    prisma.supplierCapability.findMany({ where: { supplierId }, select: { category: true } }),
    prisma.product.findMany({ where: { status: "active" }, select: { category: true }, distinct: ["category"] }),
  ]);
  const have = new Set(existing.map((c) => c.category.toLowerCase()));
  return catalogCats.map((c) => c.category).filter((cat) => !have.has(cat.toLowerCase()));
}

export async function detectMissingDocuments(supplierId) {
  const docs = await prisma.supplierDocument.findMany({ where: { supplierId }, select: { type: true } });
  const have = new Set(docs.map((d) => d.type));
  const recommended = ["GST_CERTIFICATE", "PAN", "COMPANY_REGISTRATION", "ADDRESS_PROOF", "BANK_PROOF"];
  return recommended.filter((t) => !have.has(t));
}

export const detectExpiringDocuments = (supplierId, days = 30) => expiringForSupplier(supplierId, days);

export async function summarizeSellerCapabilities(supplierId) {
  const caps = await prisma.supplierCapability.findMany({ where: { supplierId } });
  return caps.map((c) => ({ category: c.category, subCategory: c.subCategory, materials: c.materials, leadTimeDays: c.leadTimeDays, moq: c.minimumOrderQuantity }));
}

/** Compiles a read-only review packet for a human admin (AI assists, never decides). */
export async function prepareSellerReviewSummary(supplierId) {
  const [status, missingDocs, expiring, score, summary] = await Promise.all([
    getSellerOnboardingStatus(supplierId),
    detectMissingDocuments(supplierId),
    detectExpiringDocuments(supplierId),
    scoreSupplier(supplierId),
    summarizeSellerProfile(supplierId),
  ]);
  return {
    summary, status, missingDocuments: missingDocs, expiring, score,
    note: "AI-prepared summary. Approval/rejection require a human admin decision.",
  };
}
