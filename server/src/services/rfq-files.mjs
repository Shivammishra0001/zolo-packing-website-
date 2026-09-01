// Requirement-sheet attachments for RFQs (spec sheets, artwork, dimension
// drawings — xlsx/xls/csv/pdf/doc/docx/images).
//
// Files live in the PRIVATE uploads tree and are streamed only through routes
// that authorize first. Three parties may read a file:
//   - the buyer who owns the RFQ,
//   - an admin,
//   - a seller whose SupplierProfile was matched (RfqMatch) to the RFQ.
// Nobody else — a guessed file id 404s without confirming existence.
//
// Validation does not trust the client's extension or declared MIME: the magic
// bytes must agree with the declared type before anything touches disk.
import { z } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { putPrivate, readPrivate, remove, supportedPrivateMime } from "../lib/storage.mjs";
import { badRequest, notFound, conflict } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES_PER_RFQ = 5;

// Statuses in which the buyer may still add/remove attachments. Once quoting
// has produced an agreement, the requirement record must stop changing.
const MUTABLE_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "QUOTED"];

const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  dataBase64: z.string().min(1),
});

// Magic-byte signatures per declared MIME. csv has no signature, so it is
// checked for being plausible text instead (no NUL bytes in the first 4 KB).
function magicMatches(mime, buf) {
  const startsWith = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (mime) {
    case "application/pdf":
      return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "image/png":
      return startsWith(0x89, 0x50, 0x4e, 0x47);
    case "image/webp":
      return startsWith(0x52, 0x49, 0x46, 0x46) && buf.length > 11 && buf.toString("ascii", 8, 12) === "WEBP";
    // OOXML containers (xlsx/docx) are zip archives.
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(0x50, 0x4b, 0x03, 0x04);
    // Legacy Office (xls/doc) is an OLE compound file.
    case "application/vnd.ms-excel":
    case "application/msword":
      return startsWith(0xd0, 0xcf, 0x11, 0xe0);
    case "text/csv":
      return !buf.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

const shapeFile = (f) => ({
  id: f.id,
  fileName: f.fileName,
  mimeType: f.mimeType,
  size: f.size,
  createdAt: f.createdAt,
});

/** The RFQ, but only if this buyer owns it. */
async function ownedRfq(userId, rfqId) {
  const rfq = await prisma.rfq.findFirst({ where: { id: rfqId, userId }, select: { id: true, status: true, rfqNumber: true } });
  if (!rfq) throw notFound("RFQ not found");
  return rfq;
}

/** Buyer attaches a requirement sheet to their own RFQ. */
export async function attach(userId, rfqId, body) {
  const input = uploadSchema.parse(body);
  const rfq = await ownedRfq(userId, rfqId);
  if (!MUTABLE_STATUSES.includes(rfq.status)) {
    throw conflict(`Cannot attach files to a ${rfq.status.toLowerCase()} request`, "RFQ_SETTLED");
  }
  if (!supportedPrivateMime(input.mime)) throw badRequest(`Unsupported file type ${input.mime}`, "BAD_MIME");

  const count = await prisma.rfqFile.count({ where: { rfqId } });
  if (count >= MAX_FILES_PER_RFQ) throw badRequest(`At most ${MAX_FILES_PER_RFQ} files per request`, "TOO_MANY_FILES");

  let buffer;
  try {
    buffer = Buffer.from(input.dataBase64, "base64");
  } catch {
    throw badRequest("Invalid file data", "BAD_DATA");
  }
  if (buffer.length === 0) throw badRequest("File is empty", "EMPTY_FILE");
  if (buffer.length > MAX_BYTES) throw badRequest("File is larger than 10 MB", "FILE_TOO_LARGE");
  // The declared type must match the actual bytes — a renamed .exe stays out.
  if (!magicMatches(input.mime, buffer)) throw badRequest("File content does not match its declared type", "BAD_CONTENT");

  const storageKey = putPrivate({ name: input.fileName, mime: input.mime, buffer });
  const file = await prisma.rfqFile.create({
    data: { rfqId, fileName: input.fileName, storageKey, mimeType: input.mime, size: buffer.length, uploadedById: userId },
  });
  await recordEvent({
    eventType: "rfq.file.attached",
    actorId: userId,
    entityType: "Rfq",
    entityId: rfqId,
    metadata: { rfqNumber: rfq.rfqNumber, fileName: input.fileName, size: buffer.length },
  });
  return shapeFile(file);
}

/** Buyer lists their own RFQ's files. */
export async function listMine(userId, rfqId) {
  await ownedRfq(userId, rfqId);
  const files = await prisma.rfqFile.findMany({ where: { rfqId }, orderBy: { createdAt: "asc" } });
  return files.map(shapeFile);
}

/** Buyer removes a file from an RFQ that is still open. */
export async function removeMine(userId, rfqId, fileId) {
  const rfq = await ownedRfq(userId, rfqId);
  if (!MUTABLE_STATUSES.includes(rfq.status)) {
    throw conflict(`Cannot change files on a ${rfq.status.toLowerCase()} request`, "RFQ_SETTLED");
  }
  const file = await prisma.rfqFile.findFirst({ where: { id: fileId, rfqId } });
  if (!file) throw notFound("File not found");
  await prisma.rfqFile.delete({ where: { id: file.id } });
  remove(file.storageKey);
  return { deleted: true };
}

/**
 * Stream a file's bytes for an authorized reader.
 *
 * `reader` is one of:
 *   { kind: "buyer",  userId }        — must own the RFQ
 *   { kind: "admin" }                 — route-level requireAdmin is the gate
 *   { kind: "seller", supplierId }    — must hold an RfqMatch on the RFQ
 *
 * Returns bytes, not a URL: a URL would be a bearer capability that outlives
 * the permission check (same policy as supplier KYC documents).
 */
export async function readFile(reader, rfqId, fileId) {
  const file = await prisma.rfqFile.findFirst({ where: { id: fileId, rfqId } });
  if (!file) throw notFound("File not found");

  if (reader.kind === "buyer") {
    await ownedRfq(reader.userId, rfqId); // throws notFound for a foreign RFQ
  } else if (reader.kind === "seller") {
    const match = await prisma.rfqMatch.findUnique({
      where: { rfqId_supplierId: { rfqId, supplierId: reader.supplierId } },
    });
    if (!match) throw notFound("File not found"); // never confirm a foreign RFQ exists
  } else if (reader.kind !== "admin") {
    throw notFound("File not found");
  }

  const buffer = readPrivate(file.storageKey);
  if (!buffer) throw notFound("File is missing from storage");
  return { buffer, fileName: file.fileName, mimeType: file.mimeType };
}
