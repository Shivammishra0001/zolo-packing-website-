// Seller onboarding service. The SupplierProfile is the aggregate root; child
// collections (locations, capabilities, …) hang off it. Every mutation is scoped
// to the caller's own supplier profile (passed in from the resolved membership).
import { prisma } from "../lib/prisma.mjs";
import { encryptField } from "../lib/crypto.mjs";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.mjs";
import { recordEvent, notify, notifyRoles } from "./events.mjs";

// ---- Serialisation: never leak sensitive/opaque fields to the client --------
const serializeBank = (b) => ({
  id: b.id, accountHolderName: b.accountHolderName, bankName: b.bankName,
  accountLast4: b.accountLast4, ifsc: b.ifsc, branch: b.branch,
  paymentTerms: b.paymentTerms, currency: b.currency, isPrimary: b.isPrimary,
});

const serializeDocument = (d) => ({
  id: d.id, type: d.type, fileName: d.fileName, mimeType: d.mimeType, size: d.size,
  verificationStatus: d.verificationStatus, rejectionReason: d.rejectionReason,
  expiresAt: d.expiresAt, createdAt: d.createdAt,
  // storageKey is intentionally omitted — download goes through an authorized route.
});

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? Number(val) : val)));

/** Full onboarding aggregate for the seller's own profile. */
export async function getOnboarding(supplierId) {
  const profile = await prisma.supplierProfile.findUnique({
    where: { id: supplierId },
    include: {
      locations: { orderBy: { createdAt: "asc" } },
      capabilities: { orderBy: { createdAt: "asc" } },
      certifications: { orderBy: { createdAt: "asc" } },
      documents: { orderBy: { createdAt: "desc" } },
      machinery: { orderBy: { createdAt: "asc" } },
      materials: { orderBy: { createdAt: "asc" } },
      bankAccounts: { orderBy: { createdAt: "asc" } },
      capacity: true,
      quality: true,
      logistics: true,
      changeRequests: { where: { resolved: false }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!profile) throw notFound("Supplier profile not found");
  return {
    ...jsonSafe({ ...profile, bankAccounts: undefined, documents: undefined }),
    bankAccounts: profile.bankAccounts.map(serializeBank),
    documents: profile.documents.map(serializeDocument),
    completeness: computeCompleteness(profile),
  };
}

// Only DRAFT / CHANGES_REQUESTED profiles are editable by the seller.
function assertEditable(profile) {
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(profile.status)) {
    throw forbidden(`Profile in status ${profile.status} cannot be edited`);
  }
}

export async function patchProfile(profile, data, actorId) {
  assertEditable(profile);
  // Guard uniqueness on GST/PAN with a friendly error (DB also enforces it).
  for (const [field, code] of [["gstNumber", "GST_TAKEN"], ["panNumber", "PAN_TAKEN"]]) {
    if (data[field]) {
      const clash = await prisma.supplierProfile.findFirst({
        where: { [field]: data[field], NOT: { id: profile.id } }, select: { id: true },
      });
      if (clash) throw conflict(`This ${field === "gstNumber" ? "GST number" : "PAN"} is already registered`, code);
    }
  }
  const clean = {};
  for (const [k, v] of Object.entries(data)) clean[k] = v === "" ? null : v;
  const updated = await prisma.supplierProfile.update({ where: { id: profile.id }, data: clean });
  await recordEvent({ eventType: "seller.onboarding.saved", actorId, organizationId: profile.organizationId, entityType: "SupplierProfile", entityId: profile.id, metadata: { fields: Object.keys(clean) } });
  return getOnboarding(profile.id);
}

// ---- Child-collection helpers (generic add / remove) ------------------------
async function addChild(profile, model, data, event, actorId) {
  assertEditable(profile);
  const created = await prisma[model].create({ data: { supplierId: profile.id, ...data } });
  await recordEvent({ eventType: event, actorId, organizationId: profile.organizationId, entityType: model, entityId: created.id, metadata: {} });
  return created;
}

async function removeChild(profile, model, id, actorId, event) {
  assertEditable(profile);
  const row = await prisma[model].findUnique({ where: { id } });
  if (!row || row.supplierId !== profile.id) throw notFound("Item not found");
  await prisma[model].delete({ where: { id } });
  await recordEvent({ eventType: event, actorId, organizationId: profile.organizationId, entityType: model, entityId: id, metadata: {} });
}

export const addLocation = (p, d, a) => addChild(p, "supplierLocation", d, "seller.location.added", a);
export const removeLocation = (p, id, a) => removeChild(p, "supplierLocation", id, a, "seller.location.removed");

export const addCapability = (p, d, a) => addChild(p, "supplierCapability", d, "seller.capability.updated", a);
export const removeCapability = (p, id, a) => removeChild(p, "supplierCapability", id, a, "seller.capability.updated");

export const addMachine = (p, d, a) => addChild(p, "supplierMachine", d, "seller.capacity.updated", a);
export const removeMachine = (p, id, a) => removeChild(p, "supplierMachine", id, a, "seller.capacity.updated");

export const addMaterial = (p, d, a) => addChild(p, "supplierMaterial", d, "seller.capacity.updated", a);
export const removeMaterial = (p, id, a) => removeChild(p, "supplierMaterial", id, a, "seller.capacity.updated");

export async function addCertification(profile, data, actorId) {
  assertEditable(profile);
  const payload = { ...data };
  ["issueDate", "expiryDate"].forEach((k) => { payload[k] = data[k] ? new Date(data[k]) : null; });
  if (payload.documentId === "") payload.documentId = null;
  return addChild(profile, "supplierCertification", payload, "seller.certification.added", actorId);
}
export const removeCertification = (p, id, a) => removeChild(p, "supplierCertification", id, a, "seller.certification.removed");

// upsert-style single-row sections
async function upsertSection(profile, model, data, event, actorId) {
  assertEditable(profile);
  const saved = await prisma[model].upsert({
    where: { supplierId: profile.id },
    create: { supplierId: profile.id, ...data },
    update: data,
  });
  await recordEvent({ eventType: event, actorId, organizationId: profile.organizationId, entityType: model, entityId: saved.id, metadata: {} });
  return saved;
}
export const saveCapacity = (p, d, a) => upsertSection(p, "supplierCapacity", d, "seller.capacity.updated", a);
export const saveQuality = (p, d, a) => upsertSection(p, "supplierQuality", d, "seller.quality.updated", a);
export const saveLogistics = (p, d, a) => upsertSection(p, "supplierLogistics", d, "seller.logistics.updated", a);

export async function addBankAccount(profile, data, actorId) {
  assertEditable(profile);
  const { accountNumber, ...rest } = data;
  const created = await prisma.supplierBankAccount.create({
    data: {
      supplierId: profile.id,
      accountNumberEnc: encryptField(accountNumber),
      accountLast4: accountNumber.slice(-4),
      ...rest,
    },
  });
  // metadata is scrubbed of sensitive keys by the events service, but we pass none anyway.
  await recordEvent({ eventType: "seller.bank_details.updated", actorId, organizationId: profile.organizationId, entityType: "SupplierBankAccount", entityId: created.id, metadata: { bankName: rest.bankName } });
  return serializeBank(created);
}
export const removeBankAccount = (p, id, a) => removeChild(p, "supplierBankAccount", id, a, "seller.bank_details.updated");

// ---- Completeness + submission ---------------------------------------------
// Required-to-submit rules live server-side (the final authority). Each section
// reports complete/incomplete so the review page and submit gate agree.
export function computeCompleteness(profile) {
  const has = (v) => v !== null && v !== undefined && v !== "";
  const sections = {
    business: has(profile.legalName) && has(profile.displayName) && has(profile.businessType) && has(profile.contactName) && has(profile.contactEmail) && has(profile.contactPhone),
    legal: has(profile.gstNumber) && has(profile.panNumber),
    locations: (profile.locations?.length ?? 0) >= 1,
    capabilities: (profile.capabilities?.length ?? 0) >= 1,
    capacity: Boolean(profile.capacity),
    documents: (profile.documents?.length ?? 0) >= 1,
    bank: (profile.bankAccounts?.length ?? 0) >= 1,
  };
  const required = ["business", "legal", "locations", "capabilities", "bank"];
  const missing = required.filter((s) => !sections[s]);
  return { sections, required, missing, canSubmit: missing.length === 0 };
}

export async function submit(profile, actorId) {
  if (profile.status === "SUBMITTED" || profile.status === "UNDER_REVIEW") {
    throw conflict("This profile has already been submitted", "ALREADY_SUBMITTED");
  }
  assertEditable(profile);

  // Reload with children for the completeness check.
  const full = await prisma.supplierProfile.findUnique({
    where: { id: profile.id },
    include: { locations: true, capabilities: true, capacity: true, documents: true, bankAccounts: true },
  });
  const completeness = computeCompleteness(full);
  if (!completeness.canSubmit) {
    throw badRequest(`Cannot submit — incomplete sections: ${completeness.missing.join(", ")}`, "INCOMPLETE");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.supplierProfile.update({
      where: { id: profile.id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    await tx.supplierStatusHistory.create({
      data: { supplierId: profile.id, fromStatus: profile.status, toStatus: "SUBMITTED", actorId, reason: profile.status === "CHANGES_REQUESTED" ? "Resubmitted after changes" : "Initial submission" },
    });
    // Resolve any open change requests on resubmission.
    await tx.supplierChangeRequest.updateMany({ where: { supplierId: profile.id, resolved: false }, data: { resolved: true, resolvedAt: new Date() } });

    const eventType = profile.status === "CHANGES_REQUESTED" ? "seller.onboarding.resubmitted" : "seller.onboarding.submitted";
    await recordEvent({ eventType, actorId, organizationId: profile.organizationId, entityType: "SupplierProfile", entityId: profile.id, metadata: {} }, tx);
    await notify({ userId: actorId, type: "onboarding.submitted", title: "Application submitted", body: "Your seller application is under review.", entityType: "SupplierProfile", entityId: profile.id }, tx);
    await notifyRoles(["admin", "verification_admin"], { type: "seller.submitted", title: "New seller application", body: `${updated.displayName || "A supplier"} submitted their application for review.`, entityType: "SupplierProfile", entityId: profile.id }, tx);
    return updated;
  });
}
