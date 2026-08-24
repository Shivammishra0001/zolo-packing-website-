// Document service: validated upload via the storage abstraction, ownership-
// scoped listing/removal, and admin verification. Storage keys are never
// exposed to the client — downloads go through authorized URL endpoints.
import { z } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { putPrivate, readPrivate, remove, supportedMime } from "../lib/storage.mjs";
import { badRequest, forbidden, notFound } from "../lib/http.mjs";
import { recordEvent, notify } from "./events.mjs";

const DOC_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const uploadSchema = z.object({
  type: z.enum([
    "GST_CERTIFICATE", "PAN", "COMPANY_REGISTRATION", "FACTORY_LICENSE", "ADDRESS_PROOF",
    "BANK_PROOF", "CANCELLED_CHEQUE", "CERTIFICATION", "QUALITY_CERTIFICATE",
    "FACTORY_PHOTO", "MACHINERY_DOCUMENT", "OTHER",
  ]),
  fileName: z.string().min(1).max(200),
  mime: z.string().min(1),
  dataBase64: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

const publicDoc = (d) => ({
  id: d.id, type: d.type, fileName: d.fileName, mimeType: d.mimeType, size: d.size,
  verificationStatus: d.verificationStatus, rejectionReason: d.rejectionReason,
  expiresAt: d.expiresAt, verifiedAt: d.verifiedAt, createdAt: d.createdAt,
});

export async function listForSupplier(supplierId) {
  const docs = await prisma.supplierDocument.findMany({ where: { supplierId }, orderBy: { createdAt: "desc" } });
  return docs.map(publicDoc);
}

export async function upload(profile, body, actorId) {
  const input = uploadSchema.parse(body);
  if (!supportedMime(input.mime)) throw badRequest(`Unsupported file type ${input.mime}`, "BAD_MIME");

  let buffer;
  try {
    buffer = Buffer.from(input.dataBase64, "base64");
  } catch {
    throw badRequest("Invalid file data", "BAD_DATA");
  }
  if (buffer.length === 0) throw badRequest("File is empty", "EMPTY_FILE");
  if (buffer.length > DOC_MAX_BYTES) throw badRequest("File is larger than 10 MB", "FILE_TOO_LARGE");

  // KYC documents go to the PRIVATE tree — never statically served.
  const storageKey = putPrivate({ name: input.fileName, mime: input.mime, buffer });
  const doc = await prisma.supplierDocument.create({
    data: {
      supplierId: profile.id,
      type: input.type,
      fileName: input.fileName,
      storageKey,
      mimeType: input.mime,
      size: buffer.length,
      uploadedById: actorId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
  });
  await recordEvent({ eventType: "seller.document.uploaded", actorId, organizationId: profile.organizationId, entityType: "SupplierDocument", entityId: doc.id, metadata: { type: input.type } });
  return publicDoc(doc);
}

async function ownedDoc(profile, id) {
  const doc = await prisma.supplierDocument.findUnique({ where: { id } });
  if (!doc || doc.supplierId !== profile.id) throw notFound("Document not found");
  return doc;
}

export async function removeOwn(profile, id, actorId) {
  const doc = await ownedDoc(profile, id);
  await prisma.supplierDocument.delete({ where: { id } });
  remove(doc.storageKey);
  await recordEvent({ eventType: "seller.document.removed", actorId, organizationId: profile.organizationId, entityType: "SupplierDocument", entityId: id, metadata: { type: doc.type } });
}

/**
 * Stream one of the seller's OWN documents.
 *
 * Returns bytes, not a URL: a URL would be a bearer capability that outlives
 * the permission check, which is exactly how these files were previously
 * exposed. `ownedDoc` throws if the document belongs to another supplier.
 */
export async function readOwnFile(profile, id) {
  const doc = await ownedDoc(profile, id);
  const buffer = readPrivate(doc.storageKey);
  if (!buffer) throw notFound("Document file is missing");
  return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
}

// ---- Admin verification ----
export async function verify(documentId, { status, reason }, admin) {
  if (!["VERIFIED", "REJECTED"].includes(status)) throw badRequest("status must be VERIFIED or REJECTED");
  const doc = await prisma.supplierDocument.findUnique({ where: { id: documentId }, include: { supplier: { include: { organization: { include: { members: true } } } } } });
  if (!doc) throw notFound("Document not found");

  const updated = await prisma.supplierDocument.update({
    where: { id: documentId },
    data: { verificationStatus: status, verifiedById: admin.id, verifiedAt: new Date(), rejectionReason: status === "REJECTED" ? reason || "Not acceptable" : null },
  });
  await recordEvent({ eventType: status === "VERIFIED" ? "seller.document.verified" : "seller.document.rejected", actorId: admin.id, organizationId: doc.supplier.organizationId, entityType: "SupplierDocument", entityId: documentId, metadata: { type: doc.type, status } });

  const owner = doc.supplier.organization.members.find((m) => m.memberRole === "owner");
  if (owner) {
    await notify({
      userId: owner.userId,
      type: status === "VERIFIED" ? "document.verified" : "document.rejected",
      title: status === "VERIFIED" ? "Document verified" : "Document needs attention",
      body: `${doc.type.replaceAll("_", " ")} was ${status === "VERIFIED" ? "verified" : "rejected"}.`,
      entityType: "SupplierDocument", entityId: documentId,
    });
  }
  return publicDoc(updated);
}

// Admin-authorized read of ANY document. Route-level requireAdmin is the gate.
export async function readAdminFile(documentId) {
  const doc = await prisma.supplierDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Document not found");
  const buffer = readPrivate(doc.storageKey);
  if (!buffer) throw notFound("Document file is missing");
  return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
}

/** Flag documents/certifications expiring within `days`. Read-only, for dashboards/AI. */
export async function expiringForSupplier(supplierId, days = 30) {
  const threshold = new Date(Date.now() + days * 86400_000);
  const [docs, certs] = await Promise.all([
    prisma.supplierDocument.findMany({ where: { supplierId, expiresAt: { not: null, lte: threshold } }, orderBy: { expiresAt: "asc" } }),
    prisma.supplierCertification.findMany({ where: { supplierId, expiryDate: { not: null, lte: threshold } }, orderBy: { expiryDate: "asc" } }),
  ]);
  return {
    documents: docs.map((d) => ({ id: d.id, type: d.type, fileName: d.fileName, expiresAt: d.expiresAt })),
    certifications: certs.map((c) => ({ id: c.id, name: c.name, expiryDate: c.expiryDate })),
  };
}
