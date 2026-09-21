// Recycling — a workflow of its own, NOT a product return.
//
//   customer submits material + an ESTIMATE
//   admin: schedule pickup -> received -> verify (actual quantity + rule)
//          -> the SERVER calculates the credits -> approve & award | reject
//
// The customer never supplies a credit value, and neither does the admin: the
// only inputs are the verified quantity and which RecyclingRule applies. The
// award is  floor(verifiedQuantity x rule.creditsPerUnit)  and is frozen onto
// the request (rule id, material, unit, rate, quantity, credits) at approval, so
// editing a rule later never restates what a customer already earned.
//
// Integer maths throughout: quantities x1000, rates x100.
import { z, ZodError } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.mjs";
import { putPrivate, readPrivate } from "../lib/storage.mjs";
import { recordEvent, notify, notifyRoles } from "./events.mjs";
import { getSettingsRow, postTransaction, publicReward } from "./eco-credits.mjs";

export const RECYCLING_UNITS = ["kg", "g", "piece", "litre"];
export const RECYCLING_CONDITIONS = ["clean", "mixed", "contaminated", "damaged"];
const OPEN_STATUSES = ["PENDING", "PICKUP_SCHEDULED", "RECEIVED", "UNDER_VERIFICATION"];
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const issue = (path, message) => new ZodError([{ code: "custom", path: [path], message }]);
const displayName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : null);

// ---- number helpers --------------------------------------------------------

/** Up to 3 decimals, as an exact integer x1000 (8.5 -> 8500). */
const toMilli = (n) => Math.round(n * 1000);
const fromMilli = (m) => (m == null ? null : m / 1000);
const fromX100 = (v) => (v == null ? null : v / 100);
const trimNum = (n) => Number(n.toFixed(3)).toString();

const quantity = (label) =>
  z.number({ invalid_type_error: `${label} must be a number` }).positive(`${label} must be greater than 0`).max(1_000_000)
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, `${label} can have at most 3 decimals`);

/**
 * THE calculation. One place, server-side, integer maths, rounded DOWN to a
 * whole Eco Credit:  7.85 kg x 10 = 78.5 -> 78.
 */
export function calculateCredits(verifiedQuantityMilli, creditsPerUnitX100) {
  return Math.floor((verifiedQuantityMilli * creditsPerUnitX100) / 100_000);
}

/** Validate a (request, rule, quantity) triple and produce the visible working. */
function calculation(request, rule, verifiedQuantityMilli) {
  if (!rule || rule.archivedAt) throw conflict("That recycling rule no longer exists", "RULE_NOT_FOUND");
  if (!rule.isActive) throw conflict(`The ${rule.material} rule is inactive — activate it or choose another rule`, "RULE_INACTIVE");
  if (rule.material.toLowerCase() !== request.material.toLowerCase()) {
    throw badRequest(`This request is for ${request.material}; the selected rule is for ${rule.material}`, "RULE_MATERIAL_MISMATCH");
  }
  if (rule.unit !== request.unit) {
    throw badRequest(`This request is measured in ${request.unit}; the selected rule is per ${rule.unit}`, "RULE_UNIT_MISMATCH");
  }
  if (rule.minQuantityMilli != null && verifiedQuantityMilli < rule.minQuantityMilli) {
    throw badRequest(`Verified quantity is below the rule minimum of ${trimNum(rule.minQuantityMilli / 1000)} ${rule.unit}`, "BELOW_MINIMUM");
  }
  if (rule.maxQuantityMilli != null && verifiedQuantityMilli > rule.maxQuantityMilli) {
    throw badRequest(`Verified quantity is above the rule maximum of ${trimNum(rule.maxQuantityMilli / 1000)} ${rule.unit}`, "ABOVE_MAXIMUM");
  }
  const credits = calculateCredits(verifiedQuantityMilli, rule.creditsPerUnitX100);
  const qty = trimNum(verifiedQuantityMilli / 1000);
  const rate = trimNum(rule.creditsPerUnitX100 / 100);
  return {
    ruleId: rule.id,
    material: rule.material,
    unit: rule.unit,
    verifiedQuantity: verifiedQuantityMilli / 1000,
    creditsPerUnit: rule.creditsPerUnitX100 / 100,
    credits,
    formula: `${qty} ${rule.unit} × ${rate} credits/${rule.unit} = ${credits} Eco Credits`,
    rounding: "Rounded down to a whole Eco Credit",
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const cleanMaterial = (s) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const ruleFields = {
  material: z.string().transform(cleanMaterial).pipe(z.string().min(2, "Enter the material").max(60)),
  unit: z.enum(RECYCLING_UNITS),
  creditsPerUnit: z.number().positive("Credits per unit must be greater than 0").max(1_000_000)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use at most 2 decimals"),
  minQuantity: quantity("Minimum quantity").nullable().optional(),
  maxQuantity: quantity("Maximum quantity").nullable().optional(),
  isActive: z.boolean().optional(),
};
const ruleCreate = z.object(ruleFields).strict();
const ruleUpdate = z.object(ruleFields).partial().strict();

const shapeRule = (r) => ({
  id: r.id, material: r.material, unit: r.unit, creditsPerUnit: fromX100(r.creditsPerUnitX100),
  minQuantity: fromMilli(r.minQuantityMilli), maxQuantity: fromMilli(r.maxQuantityMilli),
  isActive: r.isActive, archived: Boolean(r.archivedAt), timesUsed: r._count?.requests ?? undefined,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
});

async function assertUniqueRule(material, unit, exceptId = null) {
  const clash = await prisma.recyclingRule.findFirst({
    where: { archivedAt: null, unit, material: { equals: material, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw conflict(`A rule for ${clash.material} per ${unit} already exists — edit that one`, "RULE_EXISTS");
}

export async function listRules({ includeArchived = false } = {}) {
  const rows = await prisma.recyclingRule.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ isActive: "desc" }, { material: "asc" }, { unit: "asc" }],
    include: { _count: { select: { requests: true } } },
  });
  return { rules: rows.map(shapeRule) };
}

export async function createRule(adminId, body) {
  const v = ruleCreate.parse(body);
  if (v.minQuantity != null && v.maxQuantity != null && v.maxQuantity < v.minQuantity) throw issue("maxQuantity", "Maximum cannot be below the minimum");
  await assertUniqueRule(v.material, v.unit);
  const rule = await prisma.recyclingRule.create({
    data: {
      material: v.material, unit: v.unit, creditsPerUnitX100: Math.round(v.creditsPerUnit * 100),
      minQuantityMilli: v.minQuantity != null ? toMilli(v.minQuantity) : null,
      maxQuantityMilli: v.maxQuantity != null ? toMilli(v.maxQuantity) : null,
      isActive: v.isActive !== false, createdById: adminId,
    },
  });
  await recordEvent({ eventType: "recycling_rule.created", actorId: adminId, entityType: "RecyclingRule", entityId: rule.id, metadata: { material: rule.material, unit: rule.unit, creditsPerUnit: v.creditsPerUnit } });
  return shapeRule(rule);
}

export async function updateRule(adminId, id, body) {
  const v = ruleUpdate.parse(body);
  const existing = await prisma.recyclingRule.findFirst({ where: { id, archivedAt: null } });
  if (!existing) throw notFound("Recycling rule not found");
  const min = v.minQuantity !== undefined ? v.minQuantity : fromMilli(existing.minQuantityMilli);
  const max = v.maxQuantity !== undefined ? v.maxQuantity : fromMilli(existing.maxQuantityMilli);
  if (min != null && max != null && max < min) throw issue("maxQuantity", "Maximum cannot be below the minimum");
  if (v.material !== undefined || v.unit !== undefined) await assertUniqueRule(v.material ?? existing.material, v.unit ?? existing.unit, id);

  const data = {};
  if (v.material !== undefined) data.material = v.material;
  if (v.unit !== undefined) data.unit = v.unit;
  if (v.creditsPerUnit !== undefined) data.creditsPerUnitX100 = Math.round(v.creditsPerUnit * 100);
  if (v.minQuantity !== undefined) data.minQuantityMilli = v.minQuantity != null ? toMilli(v.minQuantity) : null;
  if (v.maxQuantity !== undefined) data.maxQuantityMilli = v.maxQuantity != null ? toMilli(v.maxQuantity) : null;
  if (v.isActive !== undefined) data.isActive = v.isActive;
  const rule = await prisma.recyclingRule.update({ where: { id }, data, include: { _count: { select: { requests: true } } } });

  const toggled = v.isActive !== undefined && v.isActive !== existing.isActive;
  const changed = Object.keys(v).filter((k) => k !== "isActive");
  if (toggled) {
    await recordEvent({ eventType: rule.isActive ? "recycling_rule.enabled" : "recycling_rule.disabled", actorId: adminId, entityType: "RecyclingRule", entityId: id, metadata: { material: rule.material, unit: rule.unit } });
  }
  if (changed.length) {
    await recordEvent({
      eventType: "recycling_rule.changed", actorId: adminId, entityType: "RecyclingRule", entityId: id,
      metadata: {
        material: rule.material, unit: rule.unit, fields: changed,
        creditsPerUnitBefore: fromX100(existing.creditsPerUnitX100), creditsPerUnitAfter: fromX100(rule.creditsPerUnitX100),
      },
    });
  }
  return shapeRule(rule);
}

/** Rules are archived, never deleted: approved requests still point at them. */
export async function archiveRule(adminId, id) {
  const existing = await prisma.recyclingRule.findFirst({ where: { id, archivedAt: null } });
  if (!existing) throw notFound("Recycling rule not found");
  await prisma.recyclingRule.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
  await recordEvent({ eventType: "recycling_rule.archived", actorId: adminId, entityType: "RecyclingRule", entityId: id, metadata: { material: existing.material, unit: existing.unit } });
  return { id, archived: true };
}

/**
 * PUBLIC. What can be recycled right now and what it earns — read live from
 * the active rules + reward settings, so the storefront never prints a number
 * the admin did not configure.
 */
export async function program() {
  const [rules, settings] = await Promise.all([
    prisma.recyclingRule.findMany({ where: { isActive: true, archivedAt: null }, orderBy: [{ material: "asc" }, { unit: "asc" }] }),
    getSettingsRow(),
  ]);
  return {
    materials: rules.map((r) => ({
      ruleId: r.id, material: r.material, unit: r.unit, creditsPerUnit: fromX100(r.creditsPerUnitX100),
      minQuantity: fromMilli(r.minQuantityMilli), maxQuantity: fromMilli(r.maxQuantityMilli),
    })),
    reward: publicReward(settings),
  };
}

// ---------------------------------------------------------------------------
// Requests — shaping
// ---------------------------------------------------------------------------

const requestInclude = {
  files: { orderBy: { createdAt: "asc" } },
  history: { orderBy: { createdAt: "asc" } },
  rule: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
};

function shapeRequest(r, { forAdmin = false } = {}) {
  const approved = r.status === "APPROVED";
  // Live working for a request still being verified; the frozen snapshot once approved.
  let working = null;
  if (approved && r.ruleCreditsPerUnitX100 != null) {
    const qty = trimNum(r.verifiedQuantityMilli / 1000);
    working = {
      ruleId: r.ruleId, material: r.ruleMaterial, unit: r.ruleUnit, verifiedQuantity: fromMilli(r.verifiedQuantityMilli),
      creditsPerUnit: fromX100(r.ruleCreditsPerUnitX100), credits: r.creditsAwarded,
      formula: `${qty} ${r.ruleUnit} × ${trimNum(r.ruleCreditsPerUnitX100 / 100)} credits/${r.ruleUnit} = ${r.creditsAwarded} Eco Credits`,
      rounding: "Rounded down to a whole Eco Credit", snapshot: true,
    };
  } else if (forAdmin && r.status === "UNDER_VERIFICATION" && r.rule && r.verifiedQuantityMilli != null) {
    try { working = { ...calculation(r, r.rule, r.verifiedQuantityMilli), snapshot: false }; }
    catch (e) { working = { error: e.message, code: e.code ?? null, snapshot: false }; }
  }
  const out = {
    id: r.id, requestNumber: r.requestNumber, status: r.status, material: r.material, unit: r.unit,
    estimatedQuantity: fromMilli(r.estimatedQuantityMilli), description: r.description,
    pickup: {
      name: r.pickupName, phone: r.pickupPhone, line1: r.pickupLine1, line2: r.pickupLine2, city: r.pickupCity,
      state: r.pickupState, postalCode: r.pickupPostalCode, country: r.pickupCountry, scheduledFor: r.pickupScheduledFor,
    },
    receivedAt: r.receivedAt,
    verifiedQuantity: approved || forAdmin ? fromMilli(r.verifiedQuantityMilli) : null,
    creditsAwarded: r.creditsAwarded,
    calculation: working,
    rejectionReason: r.rejectionReason,
    files: (r.files ?? []).map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt })),
    timeline: (r.history ?? []).map((h) => ({ status: h.toStatus, at: h.createdAt, note: forAdmin ? h.note : null })),
    createdAt: r.createdAt, approvedAt: r.approvedAt, closedAt: r.closedAt,
  };
  if (forAdmin) {
    out.customer = r.user ? { id: r.user.id, name: displayName(r.user), email: r.user.email, phone: r.user.phone ?? null } : null;
    out.condition = r.condition;
    out.adminNotes = r.adminNotes;
    out.ruleId = r.ruleId;
    out.verifiedAt = r.verifiedAt;
  }
  return out;
}

const NOTICE = {
  PICKUP_SCHEDULED: (r) => ({ title: "Recycling pickup scheduled", body: `${r.requestNumber} — pickup ${r.pickupScheduledFor ? new Date(r.pickupScheduledFor).toLocaleDateString("en-IN") : "soon"}.` }),
  RECEIVED: (r) => ({ title: "We received your recycling", body: `${r.requestNumber} is waiting for verification.` }),
  UNDER_VERIFICATION: (r) => ({ title: "Recycling under verification", body: `${r.requestNumber} is being weighed and checked.` }),
  APPROVED: (r) => ({ title: "Eco Credits awarded", body: `${r.creditsAwarded} Eco Credits for ${r.requestNumber}.` }),
  REJECTED: (r) => ({ title: "Recycling request rejected", body: `${r.requestNumber}: ${r.rejectionReason ?? "see details"}.` }),
};
async function notifyCustomer(r) {
  const make = NOTICE[r.status];
  if (!make) return;
  try { await notify({ userId: r.userId, type: `recycling.${r.status.toLowerCase()}`, ...make(r), entityType: "RecyclingRequest", entityId: r.id }); }
  catch (e) { console.error("[recycling] customer notification failed:", e.message); }
}

async function move(tx, r, toStatus, { actorId = null, note = null, data = {} } = {}) {
  const updated = await tx.recyclingRequest.update({
    where: { id: r.id },
    data: { status: toStatus, ...data, ...(["APPROVED", "REJECTED", "CANCELLED"].includes(toStatus) ? { closedAt: new Date() } : {}) },
  });
  await tx.recyclingStatusHistory.create({ data: { recyclingRequestId: r.id, fromStatus: r.status, toStatus, changedById: actorId, note } });
  return updated;
}

// ---------------------------------------------------------------------------
// Requests — customer
// ---------------------------------------------------------------------------

const createSchema = z.object({
  material: z.string().trim().min(1).max(60),
  unit: z.enum(RECYCLING_UNITS),
  estimatedQuantity: quantity("Estimated quantity"),
  description: z.string().trim().max(1000).nullable().optional(),
  pickupAddressId: z.string().min(1, "Choose a pickup address"),
}).strict(); // .strict(): a customer-sent `credits` / `verifiedQuantity` is a 400, not ignored

async function nextRequestNumber(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('recycling-request-number'))`;
  const head = `RCY-${new Date().getFullYear()}-`;
  const last = await tx.recyclingRequest.findFirst({ where: { requestNumber: { startsWith: head } }, orderBy: { requestNumber: "desc" }, select: { requestNumber: true } });
  const n = last ? Number(last.requestNumber.slice(head.length)) : 0;
  return `${head}${String((Number.isFinite(n) ? n : 0) + 1).padStart(6, "0")}`;
}

export async function createRequest(userId, body) {
  const v = createSchema.parse(body);
  const address = await prisma.address.findFirst({ where: { id: v.pickupAddressId, userId } });
  if (!address) throw issue("pickupAddressId", "Choose one of your saved addresses");
  // Only materials the admin currently accepts. No active rule = not recyclable.
  const rule = await prisma.recyclingRule.findFirst({ where: { isActive: true, archivedAt: null, unit: v.unit, material: { equals: v.material, mode: "insensitive" } } });
  if (!rule) throw badRequest(`${v.material} (${v.unit}) is not accepted for recycling right now`, "MATERIAL_NOT_ELIGIBLE");

  const created = await prisma.$transaction(async (tx) => {
    const requestNumber = await nextRequestNumber(tx);
    const row = await tx.recyclingRequest.create({
      data: {
        requestNumber, userId, material: rule.material, unit: rule.unit,
        estimatedQuantityMilli: toMilli(v.estimatedQuantity), description: v.description || null,
        pickupName: address.name, pickupPhone: address.phone, pickupLine1: address.line1, pickupLine2: address.line2,
        pickupCity: address.city, pickupState: address.state, pickupPostalCode: address.postalCode, pickupCountry: address.country,
      },
    });
    await tx.recyclingStatusHistory.create({ data: { recyclingRequestId: row.id, fromStatus: null, toStatus: "PENDING", changedById: userId, note: "Request submitted" } });
    await recordEvent({ eventType: "recycling.submitted", actorId: userId, entityType: "RecyclingRequest", entityId: row.id, metadata: { requestNumber, material: row.material, unit: row.unit, estimatedQuantity: v.estimatedQuantity } }, tx);
    await notifyRoles(["admin", "operations_admin"], {
      type: "recycling.new", title: "New recycling request",
      body: `${requestNumber} — ${row.material}, about ${trimNum(v.estimatedQuantity)} ${row.unit}.`, entityType: "RecyclingRequest", entityId: row.id,
    }, tx);
    return row;
  });
  return getMine(userId, created.id);
}

export async function listMine(userId) {
  const rows = await prisma.recyclingRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, include: requestInclude });
  return { requests: rows.map((r) => shapeRequest(r)) };
}

export async function getMine(userId, id) {
  const r = await prisma.recyclingRequest.findFirst({ where: { id, userId }, include: requestInclude });
  if (!r) throw notFound("Recycling request not found");
  return shapeRequest(r);
}

export async function cancelMine(userId, id) {
  const after = await prisma.$transaction(async (tx) => {
    const r = await tx.recyclingRequest.findFirst({ where: { id, userId } });
    if (!r) throw notFound("Recycling request not found");
    if (!["PENDING", "PICKUP_SCHEDULED"].includes(r.status)) throw conflict("This request can no longer be cancelled", "INVALID_TRANSITION");
    const updated = await move(tx, r, "CANCELLED", { actorId: userId, note: "Cancelled by customer" });
    await recordEvent({ eventType: "recycling.cancelled", actorId: userId, entityType: "RecyclingRequest", entityId: r.id, metadata: { requestNumber: r.requestNumber } }, tx);
    return updated;
  });
  return getMine(userId, after.id);
}

function imageMagic(mime, buf) {
  const starts = (...b) => b.every((x, i) => buf[i] === x);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (mime === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && buf.length > 11 && buf.toString("ascii", 8, 12) === "WEBP";
  return false;
}
const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z.string().min(1),
});

export async function attachFile(userId, id, body) {
  const input = uploadSchema.parse(body);
  const r = await prisma.recyclingRequest.findFirst({ where: { id, userId }, select: { id: true, status: true } });
  if (!r) throw notFound("Recycling request not found");
  if (!["PENDING", "PICKUP_SCHEDULED"].includes(r.status)) throw conflict("Photos can only be added before the material is received", "NOT_EDITABLE");
  if ((await prisma.recyclingFile.count({ where: { recyclingRequestId: id } })) >= MAX_FILES) throw badRequest(`At most ${MAX_FILES} photos per request`, "TOO_MANY_FILES");
  const buffer = Buffer.from(input.dataBase64, "base64");
  if (buffer.length === 0) throw badRequest("File is empty", "EMPTY_FILE");
  if (buffer.length > MAX_FILE_BYTES) throw badRequest("Photo is larger than 10 MB", "FILE_TOO_LARGE");
  if (!imageMagic(input.mime, buffer)) throw badRequest("File content does not match its declared type", "BAD_CONTENT");
  const storageKey = putPrivate({ name: input.fileName, mime: input.mime, buffer });
  const f = await prisma.recyclingFile.create({ data: { recyclingRequestId: id, fileName: input.fileName, storageKey, mimeType: input.mime, size: buffer.length, uploadedById: userId } });
  return { id: f.id, fileName: f.fileName, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt };
}

/** Photos are private: streamed to the owner or an admin, never a public URL. */
export async function readFile(reader, requestId, fileId) {
  const file = await prisma.recyclingFile.findFirst({ where: { id: fileId, recyclingRequestId: requestId }, include: { recyclingRequest: { select: { userId: true } } } });
  if (!file) throw notFound("File not found");
  if (reader.kind === "buyer" && file.recyclingRequest.userId !== reader.userId) throw notFound("File not found");
  if (reader.kind !== "buyer" && reader.kind !== "admin") throw forbidden();
  const buffer = readPrivate(file.storageKey);
  if (!buffer) throw notFound("File is missing from storage");
  return { buffer, fileName: file.fileName, mimeType: file.mimeType };
}

// ---------------------------------------------------------------------------
// Requests — admin
// ---------------------------------------------------------------------------

export async function adminList({ status, material, q, take = 50, skip = 0 } = {}) {
  const where = {};
  if (status === "open") where.status = { in: OPEN_STATUSES };
  else if (status && status !== "all") where.status = status;
  if (material) where.material = { equals: String(material), mode: "insensitive" };
  const term = String(q ?? "").trim();
  if (term) {
    where.OR = [
      { requestNumber: { contains: term, mode: "insensitive" } },
      { material: { contains: term, mode: "insensitive" } },
      { user: { email: { contains: term, mode: "insensitive" } } },
      { user: { firstName: { contains: term, mode: "insensitive" } } },
      { user: { lastName: { contains: term, mode: "insensitive" } } },
    ];
  }
  const [rows, total, grouped] = await Promise.all([
    prisma.recyclingRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(take) || 50, 1), 200), skip: Math.max(Number(skip) || 0, 0), include: requestInclude }),
    prisma.recyclingRequest.count({ where }),
    prisma.recyclingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = { total: 0, PENDING: 0, PICKUP_SCHEDULED: 0, RECEIVED: 0, UNDER_VERIFICATION: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
  for (const g of grouped) { counts[g.status] = g._count._all; counts.total += g._count._all; }
  return { requests: rows.map((r) => shapeRequest(r, { forAdmin: true })), total, counts };
}

const findAdmin = (tx, idOrNumber) =>
  tx.recyclingRequest.findFirst({ where: { OR: [{ id: idOrNumber }, { requestNumber: idOrNumber }] }, include: requestInclude });

export async function adminGet(idOrNumber) {
  const r = await findAdmin(prisma, idOrNumber);
  if (!r) throw notFound("Recycling request not found");
  // The rules the admin may choose from: active, same material, same unit.
  const rules = await prisma.recyclingRule.findMany({ where: { archivedAt: null, unit: r.unit, material: { equals: r.material, mode: "insensitive" } }, orderBy: { isActive: "desc" } });
  return { ...shapeRequest(r, { forAdmin: true }), applicableRules: rules.map(shapeRule) };
}

async function adminMove(adminId, id, allowedFrom, toStatus, { note, data, event } = {}) {
  const after = await prisma.$transaction(async (tx) => {
    const r = await findAdmin(tx, id);
    if (!r) throw notFound("Recycling request not found");
    if (!allowedFrom.includes(r.status)) throw conflict(`A ${r.status.toLowerCase().replace(/_/g, " ")} request cannot be moved to ${toStatus.toLowerCase().replace(/_/g, " ")}`, "INVALID_TRANSITION");
    const updated = await move(tx, r, toStatus, { actorId: adminId, note, data });
    await recordEvent({ eventType: event ?? `recycling.${toStatus.toLowerCase()}`, actorId: adminId, entityType: "RecyclingRequest", entityId: r.id, metadata: { requestNumber: r.requestNumber, from: r.status, to: toStatus } }, tx);
    return updated;
  });
  await notifyCustomer(after);
  return adminGet(after.id);
}

export async function adminSchedulePickup(adminId, id, { date } = {}) {
  const when = date ? new Date(date) : null;
  if (!when || Number.isNaN(when.getTime())) throw issue("date", "Choose a valid pickup date");
  return adminMove(adminId, id, ["PENDING", "PICKUP_SCHEDULED"], "PICKUP_SCHEDULED", { note: `Pickup on ${when.toISOString().slice(0, 10)}`, data: { pickupScheduledFor: when } });
}

export const adminMarkReceived = (adminId, id) =>
  adminMove(adminId, id, ["PENDING", "PICKUP_SCHEDULED"], "RECEIVED", { note: "Material received", data: { receivedAt: new Date() } });

const verifySchema = z.object({
  verifiedQuantity: quantity("Verified quantity"),
  ruleId: z.string().min(1, "Choose the recycling rule"),
  condition: z.enum(RECYCLING_CONDITIONS).nullable().optional(),
  adminNotes: z.string().trim().max(1000).nullable().optional(),
}).strict(); // an admin-typed `credits` is refused too — the number is calculated

/**
 * Record the verified quantity + rule and return the server's calculation.
 * Nothing is awarded here. Can be repeated until the request is approved.
 */
export async function adminVerify(adminId, id, body) {
  const v = verifySchema.parse(body);
  const after = await prisma.$transaction(async (tx) => {
    const r = await findAdmin(tx, id);
    if (!r) throw notFound("Recycling request not found");
    if (!["RECEIVED", "UNDER_VERIFICATION"].includes(r.status)) throw conflict("Mark the material as received before verifying it", "INVALID_TRANSITION");
    const rule = await tx.recyclingRule.findUnique({ where: { id: v.ruleId } });
    const calc = calculation(r, rule, toMilli(v.verifiedQuantity));
    const data = {
      verifiedQuantityMilli: toMilli(v.verifiedQuantity), ruleId: rule.id, calculatedCredits: calc.credits,
      condition: v.condition ?? null, adminNotes: v.adminNotes || null, verifiedById: adminId, verifiedAt: new Date(),
    };
    if (r.status === "UNDER_VERIFICATION") return tx.recyclingRequest.update({ where: { id: r.id }, data });
    const updated = await move(tx, r, "UNDER_VERIFICATION", { actorId: adminId, note: calc.formula, data });
    await recordEvent({ eventType: "recycling.under_verification", actorId: adminId, entityType: "RecyclingRequest", entityId: r.id, metadata: { requestNumber: r.requestNumber } }, tx);
    return updated;
  });
  if (after.status === "UNDER_VERIFICATION") await notifyCustomer(after).catch(() => {});
  return adminGet(after.id);
}

/**
 * Approve & award. The credits are RECALCULATED here from the stored verified
 * quantity and the rule as it is NOW; a number in the request body is only a
 * staleness check (the rule changed since the admin saw the figure -> 409), it
 * is never the amount awarded.
 */
export async function adminApprove(adminId, id, body = {}) {
  const after = await prisma.$transaction(async (tx) => {
    const r = await findAdmin(tx, id);
    if (!r) throw notFound("Recycling request not found");
    if (r.status !== "UNDER_VERIFICATION") throw conflict("Verify the quantity and rule before approving", "NOT_VERIFIED");
    if (!r.ruleId || r.verifiedQuantityMilli == null) throw conflict("Verify the quantity and rule before approving", "NOT_VERIFIED");
    const rule = await tx.recyclingRule.findUnique({ where: { id: r.ruleId } });
    const calc = calculation(r, rule, r.verifiedQuantityMilli);
    if (calc.credits <= 0) throw badRequest("This quantity earns 0 Eco Credits — reject the request or correct the verification", "ZERO_CREDITS");
    if (body.expectedCredits !== undefined && Number(body.expectedCredits) !== calc.credits) {
      throw conflict(`The rule changed — this request now earns ${calc.credits} Eco Credits. Review and approve again.`, "CALCULATION_CHANGED");
    }

    const updated = await move(tx, r, "APPROVED", {
      actorId: adminId, note: calc.formula,
      data: {
        ruleMaterial: rule.material, ruleUnit: rule.unit, ruleCreditsPerUnitX100: rule.creditsPerUnitX100,
        calculatedCredits: calc.credits, creditsAwarded: calc.credits, approvedById: adminId, approvedAt: new Date(),
      },
    });
    // unique (type, source, referenceId) => a request can be rewarded only once.
    await postTransaction(tx, {
      userId: r.userId, type: "RECYCLING_REWARD", amount: calc.credits, source: "RecyclingRequest", referenceId: r.id,
      description: `Recycled ${rule.material.toLowerCase()} — ${trimNum(r.verifiedQuantityMilli / 1000)} ${rule.unit}`, createdById: adminId,
    });
    const meta = { requestNumber: r.requestNumber, material: rule.material, unit: rule.unit, verifiedQuantity: r.verifiedQuantityMilli / 1000, creditsPerUnit: rule.creditsPerUnitX100 / 100, credits: calc.credits, ruleId: rule.id };
    await recordEvent({ eventType: "recycling.approved", actorId: adminId, entityType: "RecyclingRequest", entityId: r.id, metadata: meta }, tx);
    await recordEvent({ eventType: "eco_credits.awarded", actorId: adminId, entityType: "User", entityId: r.userId, metadata: meta }, tx);
    return updated;
  });
  await notifyCustomer(after);
  return adminGet(after.id);
}

export async function adminReject(adminId, id, { reason } = {}) {
  const why = String(reason ?? "").trim();
  if (why.length < 3) throw issue("reason", "Tell the customer why the request was rejected");
  return adminMove(adminId, id, OPEN_STATUSES, "REJECTED", { note: why, data: { rejectionReason: why, rejectedById: adminId }, event: "recycling.rejected" });
}

/** Returns & Recycling overview: both workflows side by side, never merged. */
export async function overview() {
  const [returnsByStatus, recyclingByStatus, rules, recentRecycling] = await Promise.all([
    prisma.returnRequest.groupBy({ by: ["status"], where: { type: "RETURN" }, _count: { _all: true } }),
    prisma.recyclingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.recyclingRule.groupBy({ by: ["isActive"], where: { archivedAt: null }, _count: { _all: true } }),
    prisma.recyclingRequest.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: requestInclude }),
  ]);
  const tally = (rows) => Object.fromEntries(rows.map((g) => [g.status, g._count._all]));
  const ret = tally(returnsByStatus); const rec = tally(recyclingByStatus);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const closedReturn = ["REFUNDED", "REPLACEMENT_DELIVERED", "CLOSED", "REJECTED", "CANCELLED", "POINTS_CREDITED"];
  return {
    productReturns: {
      total: total(ret), byStatus: ret,
      open: Object.entries(ret).filter(([s]) => !closedReturn.includes(s)).reduce((a, [, n]) => a + n, 0),
      refunded: ret.REFUNDED ?? 0, rejected: ret.REJECTED ?? 0,
    },
    recycling: {
      total: total(rec), byStatus: rec,
      open: OPEN_STATUSES.reduce((a, s) => a + (rec[s] ?? 0), 0), approved: rec.APPROVED ?? 0, rejected: rec.REJECTED ?? 0,
    },
    rules: { active: rules.find((r) => r.isActive)?._count._all ?? 0, inactive: rules.find((r) => !r.isActive)?._count._all ?? 0 },
    recentRecycling: recentRecycling.map((r) => shapeRequest(r, { forAdmin: true })),
  };
}
