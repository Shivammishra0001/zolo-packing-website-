// Admin seller-review service. Every state transition is transactional and
// writes: profile update + status history + audit event + seller notification.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { recordEvent, notify } from "./events.mjs";

const listSelect = {
  id: true, displayName: true, legalName: true, businessType: true,
  status: true, verificationStatus: true, submittedAt: true, createdAt: true,
  organization: { select: { id: true, name: true } },
  _count: { select: { documents: true, capabilities: true, locations: true } },
};

export async function listSellers({ status, verificationStatus, businessType, search, take = 50, skip = 0 }) {
  const where = {};
  if (status) where.status = status;
  if (verificationStatus) where.verificationStatus = verificationStatus;
  if (businessType) where.businessType = businessType;
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: "insensitive" } },
      { legalName: { contains: search, mode: "insensitive" } },
      { gstNumber: { contains: search.toUpperCase() } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.supplierProfile.findMany({ where, select: listSelect, orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }], take: Math.min(take, 100), skip }),
    prisma.supplierProfile.count({ where }),
  ]);
  return { items, total, take, skip };
}

const serializeBank = (b) => ({ id: b.id, accountHolderName: b.accountHolderName, bankName: b.bankName, accountLast4: b.accountLast4, ifsc: b.ifsc, branch: b.branch, currency: b.currency, isPrimary: b.isPrimary });
const publicDoc = (d) => ({ id: d.id, type: d.type, fileName: d.fileName, mimeType: d.mimeType, size: d.size, verificationStatus: d.verificationStatus, rejectionReason: d.rejectionReason, expiresAt: d.expiresAt, createdAt: d.createdAt });
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? Number(val) : val)));

export async function getSeller(id) {
  const p = await prisma.supplierProfile.findUnique({
    where: { id },
    include: {
      organization: { include: { members: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, role: true } } } } } },
      locations: true, capabilities: true, certifications: true, machinery: true, materials: true,
      capacity: true, quality: true, logistics: true,
      documents: { orderBy: { createdAt: "desc" } },
      bankAccounts: true,
      statusHistory: { orderBy: { createdAt: "desc" } },
      changeRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!p) throw notFound("Seller not found");
  return { ...jsonSafe({ ...p, documents: undefined, bankAccounts: undefined }), documents: p.documents.map(publicDoc), bankAccounts: p.bankAccounts.map(serializeBank) };
}

async function ownerUserId(tx, profile) {
  const owner = await tx.organizationMember.findFirst({ where: { organizationId: profile.organizationId, memberRole: "owner" } });
  return owner?.userId || null;
}

// Generic transactional transition.
async function transition(id, { allowedFrom, toStatus, event, reason, notifType, notifTitle, notifBody, extraData = {}, verificationStatus, roleFor }, admin) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.supplierProfile.findUnique({ where: { id } });
    if (!profile) throw notFound("Seller not found");
    if (allowedFrom && !allowedFrom.includes(profile.status)) {
      throw conflict(`Cannot ${event} a seller in status ${profile.status}`, "BAD_TRANSITION");
    }
    const data = { status: toStatus, ...extraData };
    if (verificationStatus) data.verificationStatus = verificationStatus;
    const updated = await tx.supplierProfile.update({ where: { id }, data });
    await tx.supplierStatusHistory.create({ data: { supplierId: id, fromStatus: profile.status, toStatus, actorId: admin.id, reason: reason || null } });
    await recordEvent({ eventType: event, actorId: admin.id, organizationId: profile.organizationId, entityType: "SupplierProfile", entityId: id, metadata: reason ? { reason } : {} }, tx);

    const uid = await ownerUserId(tx, profile);
    if (uid && notifType) await notify({ userId: uid, type: notifType, title: notifTitle, body: notifBody, entityType: "SupplierProfile", entityId: id }, tx);
    return updated;
  });
}

export const startReview = (id, admin) =>
  transition(id, { allowedFrom: ["SUBMITTED"], toStatus: "UNDER_REVIEW", event: "seller.onboarding.review_started", verificationStatus: "PENDING" }, admin);

export const approve = (id, admin) =>
  transition(id, {
    allowedFrom: ["SUBMITTED", "UNDER_REVIEW"], toStatus: "APPROVED", event: "seller.approved",
    verificationStatus: "VERIFIED", extraData: { approvedAt: new Date(), rejectedAt: null, rejectionReason: null },
    notifType: "seller.approved", notifTitle: "Application approved 🎉", notifBody: "Your seller account is now active. Your dashboard is unlocked.",
  }, admin);

export const reject = (id, reason, admin) =>
  transition(id, {
    allowedFrom: ["SUBMITTED", "UNDER_REVIEW"], toStatus: "REJECTED", event: "seller.rejected", reason,
    verificationStatus: "REJECTED", extraData: { rejectedAt: new Date(), rejectionReason: reason },
    notifType: "seller.rejected", notifTitle: "Application not approved", notifBody: reason,
  }, admin);

export const suspend = (id, reason, admin) =>
  transition(id, {
    allowedFrom: ["APPROVED"], toStatus: "SUSPENDED", event: "seller.suspended", reason,
    notifType: "seller.suspended", notifTitle: "Account suspended", notifBody: reason,
  }, admin);

export const reactivate = (id, admin) =>
  transition(id, {
    allowedFrom: ["SUSPENDED"], toStatus: "APPROVED", event: "seller.reactivated",
    notifType: "seller.reactivated", notifTitle: "Account reactivated", notifBody: "Your seller account is active again.",
  }, admin);

// Change request: sets CHANGES_REQUESTED and records section-specific issues.
export async function requestChanges(id, issues, admin) {
  if (!Array.isArray(issues) || issues.length === 0) throw badRequest("At least one issue is required");
  return prisma.$transaction(async (tx) => {
    const profile = await tx.supplierProfile.findUnique({ where: { id } });
    if (!profile) throw notFound("Seller not found");
    if (!["SUBMITTED", "UNDER_REVIEW"].includes(profile.status)) throw conflict(`Cannot request changes for status ${profile.status}`, "BAD_TRANSITION");

    const updated = await tx.supplierProfile.update({ where: { id }, data: { status: "CHANGES_REQUESTED" } });
    await tx.supplierChangeRequest.create({ data: { supplierId: id, raisedById: admin.id, issues } });
    await tx.supplierStatusHistory.create({ data: { supplierId: id, fromStatus: profile.status, toStatus: "CHANGES_REQUESTED", actorId: admin.id, reason: `${issues.length} change(s) requested` } });
    await recordEvent({ eventType: "seller.onboarding.changes_requested", actorId: admin.id, organizationId: profile.organizationId, entityType: "SupplierProfile", entityId: id, metadata: { sections: issues.map((i) => i.section) } }, tx);

    const uid = await ownerUserId(tx, profile);
    if (uid) await notify({ userId: uid, type: "seller.changes_requested", title: "Changes requested", body: `Please address ${issues.length} item(s) and resubmit.`, entityType: "SupplierProfile", entityId: id }, tx);
    return updated;
  });
}
