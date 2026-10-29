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
    // Matches the single registration form: supplier name, company name and
    // a contact number. businessType and contactEmail stay on the model (the
    // admin can set them) but are not gates — the form does not ask for them,
    // so requiring them would make submission impossible.
    business: has(profile.displayName) && has(profile.contactName) && has(profile.contactPhone),
    legal: has(profile.gstNumber) && has(profile.panNumber),
    locations: (profile.locations?.length ?? 0) >= 1,
    capabilities: (profile.capabilities?.length ?? 0) >= 1,
    capacity: Boolean(profile.capacity),
    documents: (profile.documents?.length ?? 0) >= 1,
    bank: (profile.bankAccounts?.length ?? 0) >= 1,
  };
  // Onboarding is ONE short form: contact, address, categories, bank.
  //
  // `legal` (GST + PAN) is no longer required to submit. Many small packaging
  // suppliers are not GST-registered, and blocking registration on a number
  // they do not have lost real suppliers at the first screen. The fields
  // remain on the model and in the admin view, so they can still be recorded
  // later for anyone who has them.
  const required = ["business", "locations", "capabilities", "bank"];
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

/**
 * Create the whole supplier profile from ONE form, then submit it for review.
 *
 * Replaces an eleven-step wizard. The steps were a real cost: a supplier had
 * to complete business, legal, locations, capabilities, capacity,
 * certifications, documents, bank, quality and logistics before anything
 * reached an admin, and most never finished.
 *
 * Everything lands in a SINGLE transaction. A half-written supplier — contact
 * saved, address missing, no bank — is exactly the state the wizard produced
 * and is useless to review, so either the whole application exists or none of
 * it does.
 *
 * The caller is an authenticated seller; `profile` is their existing DRAFT.
 */
export async function submitSingleForm(profile, input = {}, actorId) {
  assertEditable(profile);

  const text = (v) => String(v ?? "").trim();
  const contactName = text(input.contactName);
  const companyName = text(input.companyName);
  const contactPhone = text(input.contactPhone);
  const addressLine = text(input.addressLine);

  // Validated here rather than trusted from the client: this endpoint writes
  // the record the admin approves, so it is the last place to check.
  const missing = [];
  if (!contactName) missing.push("supplier name");
  if (!companyName) missing.push("company name");
  if (contactPhone.replace(/\D/g, "").length < 10) missing.push("a 10-digit contact number");
  if (!addressLine) missing.push("address");
  if (!Array.isArray(input.categories) || input.categories.length === 0) missing.push("at least one product category");
  if (missing.length) throw badRequest(`Please provide ${missing.join(", ")}`, "INCOMPLETE");

  const bank = input.bank ?? {};
  const accountNumber = text(bank.accountNumber);
  // Bank details are optional — a supplier can be approved and start quoting
  // before payment details exist. When ANY field is given they must all be,
  // because a half-filled bank record cannot be paid to.
  const wantsBank = Boolean(accountNumber || text(bank.ifsc) || text(bank.bankName));
  if (wantsBank) {
    const bankMissing = [];
    if (!text(bank.accountHolderName)) bankMissing.push("account holder name");
    if (!text(bank.bankName)) bankMissing.push("bank name");
    if (accountNumber.length < 6) bankMissing.push("a valid account number");
    if (!text(bank.ifsc)) bankMissing.push("IFSC code");
    if (bankMissing.length) throw badRequest(`Bank details need ${bankMissing.join(", ")}`, "BANK_INCOMPLETE");
  }

  return prisma.$transaction(async (tx) => {
    await tx.supplierProfile.update({
      where: { id: profile.id },
      data: {
        contactName,
        displayName: companyName,
        legalName: companyName,
        contactPhone,
        website: text(input.website) || null,
      },
    });

    // Replace rather than append, so re-submitting after a change request does
    // not leave the previous address and categories behind.
    await tx.supplierLocation.deleteMany({ where: { supplierId: profile.id } });
    await tx.supplierLocation.create({
      data: {
        supplierId: profile.id,
        // The form asks for one address; HEAD_OFFICE is the neutral default.
        // A supplier can add factory/warehouse addresses later.
        locationType: "HEAD_OFFICE",
        addressLine1: addressLine,
        city: text(input.city) || "—",
        state: text(input.state) || "—",
        postalCode: text(input.postalCode) || "—",
        country: text(input.country) || "India",
        isPrimary: true,
      },
    });

    await tx.supplierCapability.deleteMany({ where: { supplierId: profile.id } });
    for (const raw of input.categories) {
      const category = text(raw);
      if (category) await tx.supplierCapability.create({ data: { supplierId: profile.id, category } });
    }

    if (wantsBank) {
      await tx.supplierBankAccount.deleteMany({ where: { supplierId: profile.id } });
      await tx.supplierBankAccount.create({
        data: {
          supplierId: profile.id,
          accountHolderName: text(bank.accountHolderName),
          bankName: text(bank.bankName),
          accountNumberEnc: encryptField(accountNumber),
          accountLast4: accountNumber.slice(-4),
          ifsc: text(bank.ifsc).toUpperCase(),
          isPrimary: true,
        },
      });
    }

    const updated = await tx.supplierProfile.update({
      where: { id: profile.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), onboardingStep: 1 },
    });
    await tx.supplierStatusHistory.create({
      data: {
        supplierId: profile.id,
        fromStatus: profile.status,
        toStatus: "SUBMITTED",
        actorId,
        reason: profile.status === "CHANGES_REQUESTED" ? "Resubmitted after changes" : "Initial submission",
      },
    });
    await tx.supplierChangeRequest.updateMany({
      where: { supplierId: profile.id, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    });

    await recordEvent({
      eventType: profile.status === "CHANGES_REQUESTED" ? "seller.onboarding.resubmitted" : "seller.onboarding.submitted",
      actorId,
      organizationId: profile.organizationId,
      entityType: "SupplierProfile",
      entityId: profile.id,
      metadata: { categories: input.categories.length, hasBank: wantsBank },
    }, tx);
    await notify({
      userId: actorId,
      type: "onboarding.submitted",
      title: "Application submitted",
      body: "Your supplier application is under review.",
      entityType: "SupplierProfile",
      entityId: profile.id,
    }, tx);
    await notifyRoles(["admin", "verification_admin"], {
      type: "seller.submitted",
      title: "New supplier application",
      body: `${companyName} submitted their application for review.`,
      entityType: "SupplierProfile",
      entityId: profile.id,
    }, tx);

    return updated;
  });
}
