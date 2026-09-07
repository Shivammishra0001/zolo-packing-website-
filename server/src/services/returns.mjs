// Returns, recycling & reward points.
//
// CUSTOMER-INITIATED ONLY: a request is created by the buyer against their own
// delivered order item. Admin reviews, approves/rejects, selects ONE
// resolution (refund / replacement / recycle) and processes it. Admin cannot
// create requests, and no caller can jump the state machine — every transition
// is validated server-side against TRANSITIONS.
//
// Money stays in paise. Points are integers, credited exactly once per request
// through the append-only PointsLedger (unique [type, referenceType,
// referenceId] makes double-credit a database error, not a code-review hope).
import { z } from "zod";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound, conflict, forbidden } from "../lib/http.mjs";
import { recordEvent, notify, notifyRoles } from "./events.mjs";
import { putPrivate, readPrivate, supportedPrivateMime } from "../lib/storage.mjs";

// ---- Policy ----------------------------------------------------------------

export const RETURN_WINDOW_DAYS = Number(process.env.RETURN_WINDOW_DAYS) || 30;
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Fallback reward rate when no RecycleRule covers the category: 0.5 pt/unit.
const DEFAULT_RATE_X100 = 50;

export const RETURN_REASONS = [
  "damaged", "wrong_product", "defective", "incorrect_quantity", "not_as_expected", "recycle", "other",
];
export const RETURN_CONDITIONS = ["unused", "opened", "damaged", "used", "packaging_damaged"];

// Order statuses from which an item may still be returned/recycled.
const ELIGIBLE_ORDER_STATUSES = ["DELIVERED", "RETURN_REQUESTED"];

// ---- State machine ---------------------------------------------------------

// from -> allowed next. Anything absent is refused with 409 INVALID_TRANSITION.
const TRANSITIONS = {
  SUBMITTED: ["UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  // APPROVED branches when the admin selects a resolution.
  APPROVED: ["REFUND_PROCESSING", "REPLACEMENT_PROCESSING", "PICKUP_SCHEDULED"],
  REJECTED: [],
  // Physical flow (recycle)
  PICKUP_SCHEDULED: ["RECEIVED"],
  RECEIVED: ["INSPECTED"],
  INSPECTED: ["RECYCLE_PROCESSING"],
  RECYCLE_PROCESSING: ["RECYCLED"],
  RECYCLED: ["POINTS_CREDITED"],
  POINTS_CREDITED: ["CLOSED"],
  // Refund branch
  REFUND_PROCESSING: ["REFUNDED"],
  REFUNDED: ["CLOSED"],
  // Replacement branch
  REPLACEMENT_PROCESSING: ["REPLACEMENT_SHIPPED"],
  REPLACEMENT_SHIPPED: ["REPLACEMENT_DELIVERED"],
  REPLACEMENT_DELIVERED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

function assertTransition(from, to) {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw conflict(`Cannot move a ${from.toLowerCase().replace(/_/g, " ")} request to ${to.toLowerCase().replace(/_/g, " ")}`, "INVALID_TRANSITION");
  }
}

/** Move a request, append history, audit and (optionally) notify — in one tx. */
async function transition(tx, request, toStatus, { actorId = null, note = null, data = {} } = {}) {
  assertTransition(request.status, toStatus);
  const updated = await tx.returnRequest.update({
    where: { id: request.id },
    data: { status: toStatus, ...data, ...(["CLOSED", "REJECTED", "CANCELLED"].includes(toStatus) ? { closedAt: new Date() } : {}) },
  });
  await tx.returnStatusHistory.create({
    data: { returnRequestId: request.id, fromStatus: request.status, toStatus, changedById: actorId, note },
  });
  await recordEvent(
    {
      eventType: `return.${toStatus.toLowerCase()}`,
      actorId,
      entityType: "ReturnRequest",
      entityId: request.id,
      metadata: { requestNumber: request.requestNumber, from: request.status, to: toStatus },
    },
    tx,
  );
  return updated;
}

// Customer-facing notification per milestone (Phase 14). In-app via the
// existing Notification table; a failure here must not break the transaction,
// so callers invoke it AFTER commit via notifyCustomer().
const CUSTOMER_NOTICE = {
  UNDER_REVIEW: (r) => ({ title: "Your request is under review", body: `${r.requestNumber} is being reviewed by our team.` }),
  APPROVED: (r) => ({ title: "Request approved", body: `${r.requestNumber} was approved.` }),
  REJECTED: (r) => ({ title: "Request rejected", body: `${r.requestNumber}: ${r.rejectionReason ?? "see details"}.` }),
  PICKUP_SCHEDULED: (r) => ({ title: "Pickup scheduled", body: `${r.requestNumber} — pickup ${r.pickupScheduledFor ? new Date(r.pickupScheduledFor).toLocaleDateString("en-IN") : "soon"}.` }),
  RECEIVED: (r) => ({ title: "Items received", body: `We received your items for ${r.requestNumber}.` }),
  INSPECTED: (r) => ({ title: "Inspection completed", body: `${r.requestNumber}: ${r.acceptedQuantity ?? 0} unit(s) accepted.` }),
  REFUND_PROCESSING: (r) => ({ title: "Refund initiated", body: `Your refund for ${r.requestNumber} is being processed.` }),
  REFUNDED: (r) => ({ title: "Refund completed", body: `Your refund for ${r.requestNumber} has been processed.` }),
  REPLACEMENT_PROCESSING: (r) => ({ title: "Replacement approved", body: `A replacement for ${r.requestNumber} is being prepared.` }),
  REPLACEMENT_SHIPPED: (r) => ({ title: "Replacement shipped", body: `${r.requestNumber}${r.replacementTracking ? ` — tracking ${r.replacementTracking}` : ""}.` }),
  REPLACEMENT_DELIVERED: (r) => ({ title: "Replacement delivered", body: `Your replacement for ${r.requestNumber} was delivered.` }),
  RECYCLED: (r) => ({ title: "Recycling completed", body: `${r.requestNumber} has been recycled. Points are on the way!` }),
  POINTS_CREDITED: (r) => ({ title: "Points credited", body: `${r.pointsAwarded ?? 0} ZP points credited for ${r.requestNumber}.` }),
};

async function notifyCustomer(request, status) {
  const make = CUSTOMER_NOTICE[status];
  if (!make) return;
  try {
    await notify({ userId: request.userId, type: `return.${status.toLowerCase()}`, ...make(request), entityType: "ReturnRequest", entityId: request.id });
  } catch (e) {
    console.error("[returns] customer notification failed:", e.message);
  }
}

// ---- Numbers ---------------------------------------------------------------

// RET-2026-000125 / REC-2026-000045 — sequential per prefix+year, allocated
// inside the creating transaction so concurrent submits can't collide.
async function nextRequestNumber(tx, type) {
  const prefix = type === "RECYCLE" ? "REC" : "RET";
  const year = new Date().getFullYear();
  const head = `${prefix}-${year}-`;
  const last = await tx.returnRequest.findFirst({
    where: { requestNumber: { startsWith: head } },
    orderBy: { requestNumber: "desc" },
    select: { requestNumber: true },
  });
  const n = last ? Number(last.requestNumber.slice(head.length)) : 0;
  return `${head}${String((Number.isFinite(n) ? n : 0) + 1).padStart(6, "0")}`;
}

// ---- Reward rules ----------------------------------------------------------

/** Resolve the reward rate for a product category. Backend-only — the
 *  frontend never computes points. */
async function rateFor(category, quantity) {
  const rule = category
    ? await prisma.recycleRule.findFirst({ where: { category, isActive: true } })
    : null;
  if (rule && quantity < rule.minQuantity) {
    return { rateX100: 0, maxPoints: null, reason: `Minimum ${rule.minQuantity} units for this category` };
  }
  return { rateX100: rule?.pointsPerUnitX100 ?? DEFAULT_RATE_X100, maxPoints: rule?.maxPoints ?? null, reason: null };
}

function computePoints(rateX100, quantity, maxPoints) {
  const raw = Math.floor((quantity * rateX100) / 100);
  return maxPoints != null ? Math.min(raw, maxPoints) : raw;
}

// ---- Eligibility -----------------------------------------------------------

/**
 * The order item + how many units are still returnable. Enforces ownership,
 * delivered status, the return window, and prior (non-rejected/cancelled)
 * request quantities. Throws the precise reason — the frontend button is
 * convenience, THIS is the gate.
 */
async function eligibleItem(userId, orderItemId, tx = prisma) {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: {
      order: { select: { id: true, userId: true, status: true, orderNumber: true, updatedAt: true, shipments: { select: { deliveredAt: true }, orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  });
  // Foreign items 404 — never confirm another customer's order composition.
  if (!item || item.order.userId !== userId) throw notFound("Order item not found");
  // OrderItem.productId is a bare reference (snapshot philosophy — no FK
  // relation), so the live product is fetched separately for seller/category.
  item.product = item.productId
    ? await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, sellerId: true, category: true } })
    : null;
  if (!ELIGIBLE_ORDER_STATUSES.includes(item.order.status)) {
    throw conflict("Only delivered orders are eligible for return or recycling", "NOT_DELIVERED");
  }

  const deliveredAt = item.order.shipments[0]?.deliveredAt ?? item.order.updatedAt;
  const windowEnds = new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * 86400_000);
  if (windowEnds < new Date()) {
    throw conflict(`The ${RETURN_WINDOW_DAYS}-day return window for this order has closed`, "WINDOW_CLOSED");
  }

  const prior = await tx.returnRequest.aggregate({
    where: { orderItemId, status: { notIn: ["REJECTED", "CANCELLED"] } },
    _sum: { quantity: true },
  });
  const remaining = item.quantity - (prior._sum.quantity ?? 0);
  return { item, remaining, deliveredAt };
}

// ---- Customer API ----------------------------------------------------------

const createSchema = z.object({
  orderItemId: z.string().min(1),
  type: z.enum(["RETURN", "RECYCLE"]),
  quantity: z.number().int().positive(),
  reason: z.enum(RETURN_REASONS),
  condition: z.enum(RETURN_CONDITIONS),
  description: z.string().trim().max(1000).optional().nullable(),
  // Pickup address comes from the caller's OWN address book; snapshot on write.
  pickupAddressId: z.string().min(1),
});

export async function createRequest(userId, body) {
  const input = createSchema.parse(body);

  const address = await prisma.address.findFirst({ where: { id: input.pickupAddressId, userId } });
  if (!address) throw notFound("Pickup address not found");

  const { created, orderId } = await prisma.$transaction(async (tx) => {
    const { item, remaining } = await eligibleItem(userId, input.orderItemId, tx);
    if (input.quantity > remaining) {
      throw badRequest(
        remaining <= 0
          ? "This item has already been fully returned or recycled"
          : `Only ${remaining} unit(s) of this item can still be returned`,
        "QUANTITY_EXCEEDED",
      );
    }

    const requestNumber = await nextRequestNumber(tx, input.type);
    const created = await tx.returnRequest.create({
      data: {
        requestNumber,
        userId,
        orderId: item.order.id,
        orderItemId: item.id,
        sellerId: item.product?.sellerId ?? null,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason,
        condition: input.condition,
        description: input.description ?? null,
        pickupName: address.name,
        pickupPhone: address.phone,
        pickupLine1: address.line1,
        pickupLine2: address.line2,
        pickupCity: address.city,
        pickupState: address.state,
        pickupPostalCode: address.postalCode,
        pickupCountry: address.country,
      },
    });
    await tx.returnStatusHistory.create({
      data: { returnRequestId: created.id, fromStatus: null, toStatus: "SUBMITTED", changedById: userId, note: "Request submitted" },
    });
    await recordEvent(
      {
        eventType: "return.submitted",
        actorId: userId,
        entityType: "ReturnRequest",
        entityId: created.id,
        metadata: { requestNumber, type: input.type, orderNumber: item.order.orderNumber, quantity: input.quantity },
      },
      tx,
    );
    await notifyRoles(
      ["admin", "operations_admin"],
      {
        type: "return.new",
        title: input.type === "RECYCLE" ? "New recycling request" : "New return request",
        body: `${requestNumber} — ${item.productName} × ${input.quantity} (${item.order.orderNumber}).`,
        entityType: "ReturnRequest",
        entityId: created.id,
      },
      tx,
    );

    // Mark the order as having an open return, when the transition is legal.
    if (item.order.status === "DELIVERED") {
      await tx.order.update({ where: { id: item.order.id }, data: { status: "RETURN_REQUESTED" } });
      await tx.orderStatusHistory.create({
        data: { orderId: item.order.id, status: "RETURN_REQUESTED", actorId: userId, note: `Customer request ${requestNumber}` },
      });
    }
    return { created, orderId: item.order.id };
  });

  void orderId;
  return getMine(userId, created.id);
}

/** Estimated recycle points — an ESTIMATE only; final points come from the
 *  post-inspection accepted quantity. */
export async function estimatePoints(userId, { orderItemId, quantity }) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw badRequest("Quantity must be a positive whole number");
  const { item, remaining } = await eligibleItem(userId, orderItemId);
  const { rateX100, maxPoints, reason } = await rateFor(item.product?.category ?? null, qty);
  return {
    quantity: qty,
    remaining,
    estimatedPoints: computePoints(rateX100, qty, maxPoints),
    note: reason ?? "Final points are calculated on the accepted quantity after inspection.",
  };
}

const shapeFile = (f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt });

function shapeRequest(r, { forAdmin = false } = {}) {
  return {
    id: r.id,
    requestNumber: r.requestNumber,
    type: r.type,
    status: r.status,
    resolution: r.resolution,
    quantity: r.quantity,
    reason: r.reason,
    condition: r.condition,
    description: r.description,
    order: r.order ? { id: r.order.id, orderNumber: r.order.orderNumber, placedAt: r.order.placedAt } : undefined,
    item: r.orderItem
      ? { id: r.orderItem.id, productName: r.orderItem.productName, sku: r.orderItem.sku, purchasedQuantity: r.orderItem.quantity, unitPriceMinor: r.orderItem.unitPriceMinor, lineTotalMinor: r.orderItem.lineTotalMinor }
      : undefined,
    pickup: {
      name: r.pickupName, phone: r.pickupPhone, line1: r.pickupLine1, line2: r.pickupLine2,
      city: r.pickupCity, state: r.pickupState, postalCode: r.pickupPostalCode, country: r.pickupCountry,
    },
    rejectionReason: r.rejectionReason,
    replacement: r.resolution === "REPLACEMENT"
      ? { quantity: r.replacementQuantity, courier: r.replacementCourier, tracking: r.replacementTracking, shippedAt: r.replacementShippedAt, deliveredAt: r.replacementDeliveredAt }
      : undefined,
    recycle: r.type === "RECYCLE" || r.resolution === "RECYCLE"
      ? { pickupScheduledFor: r.pickupScheduledFor, receivedQuantity: r.receivedQuantity, acceptedQuantity: r.acceptedQuantity, rejectedQuantity: r.rejectedQuantity, inspectionNotes: forAdmin ? r.inspectionNotes : undefined }
      : undefined,
    pointsAwarded: r.pointsAwarded,
    refund: r.refund ? { refundNumber: r.refund.refundNumber, amountMinor: r.refund.amountMinor, status: r.refund.status, reference: forAdmin ? r.refund.reference : undefined, processedAt: r.refund.processedAt } : null,
    files: (r.files ?? []).map(shapeFile),
    timeline: (r.history ?? []).map((h) => ({ id: h.id, status: h.toStatus, note: h.note, at: h.createdAt })),
    ...(forAdmin
      ? {
          adminNotes: r.adminNotes,
          sellerId: r.sellerId,
          customer: r.user ? { id: r.user.id, name: [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") || r.user.email, email: r.user.email, phone: r.user.phone } : undefined,
        }
      : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    closedAt: r.closedAt,
  };
}

const DETAIL_INCLUDE = {
  order: { select: { id: true, orderNumber: true, placedAt: true } },
  orderItem: true,
  files: { orderBy: { createdAt: "asc" } },
  history: { orderBy: { createdAt: "asc" } },
  refund: true,
};

export async function listMine(userId, { type } = {}) {
  const rows = await prisma.returnRequest.findMany({
    where: { userId, ...(type ? { type } : {}) },
    orderBy: { createdAt: "desc" },
    include: DETAIL_INCLUDE,
  });
  return rows.map((r) => shapeRequest(r));
}

export async function getMine(userId, id) {
  const r = await prisma.returnRequest.findFirst({ where: { id, userId }, include: DETAIL_INCLUDE });
  if (!r) throw notFound("Request not found");
  return shapeRequest(r);
}

/** Customer may cancel only while the request is not yet being processed. */
export async function cancelMine(userId, id) {
  const r = await prisma.returnRequest.findFirst({ where: { id, userId } });
  if (!r) throw notFound("Request not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(r.status)) {
    throw conflict("This request is already being processed and can no longer be cancelled", "NOT_CANCELLABLE");
  }
  await prisma.$transaction(async (tx) => {
    await transition(tx, r, "CANCELLED", { actorId: userId, note: "Cancelled by customer" });
  });
  return getMine(userId, id);
}

// ---- Customer files (photos / documents) ----------------------------------

function magicMatches(mime, buf) {
  const startsWith = (...bytes) => bytes.every((b, i) => buf[i] === b);
  switch (mime) {
    case "application/pdf": return startsWith(0x25, 0x50, 0x44, 0x46);
    case "image/jpeg": return startsWith(0xff, 0xd8, 0xff);
    case "image/png": return startsWith(0x89, 0x50, 0x4e, 0x47);
    case "image/webp": return startsWith(0x52, 0x49, 0x46, 0x46) && buf.length > 11 && buf.toString("ascii", 8, 12) === "WEBP";
    default: return false;
  }
}

const uploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  dataBase64: z.string().min(1),
});

export async function attachFile(userId, id, body) {
  const input = uploadSchema.parse(body);
  const r = await prisma.returnRequest.findFirst({ where: { id, userId }, select: { id: true, status: true, requestNumber: true } });
  if (!r) throw notFound("Request not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(r.status)) {
    throw conflict("Evidence can only be added before the request is processed", "NOT_EDITABLE");
  }
  if ((await prisma.returnFile.count({ where: { returnRequestId: id } })) >= MAX_FILES) {
    throw badRequest(`At most ${MAX_FILES} files per request`, "TOO_MANY_FILES");
  }
  if (!supportedPrivateMime(input.mime)) throw badRequest(`Unsupported file type ${input.mime}`, "BAD_MIME");

  let buffer;
  try { buffer = Buffer.from(input.dataBase64, "base64"); } catch { throw badRequest("Invalid file data", "BAD_DATA"); }
  if (buffer.length === 0) throw badRequest("File is empty", "EMPTY_FILE");
  if (buffer.length > MAX_FILE_BYTES) throw badRequest("File is larger than 10 MB", "FILE_TOO_LARGE");
  if (!magicMatches(input.mime, buffer)) throw badRequest("File content does not match its declared type", "BAD_CONTENT");

  const storageKey = putPrivate({ name: input.fileName, mime: input.mime, buffer });
  const file = await prisma.returnFile.create({
    data: { returnRequestId: id, fileName: input.fileName, storageKey, mimeType: input.mime, size: buffer.length, uploadedById: userId },
  });
  return shapeFile(file);
}

/** Stream evidence bytes for the owner or an admin — never a public URL. */
export async function readFile(reader, requestId, fileId) {
  const file = await prisma.returnFile.findFirst({ where: { id: fileId, returnRequestId: requestId }, include: { returnRequest: { select: { userId: true } } } });
  if (!file) throw notFound("File not found");
  if (reader.kind === "buyer" && file.returnRequest.userId !== reader.userId) throw notFound("File not found");
  if (reader.kind !== "buyer" && reader.kind !== "admin") throw forbidden();
  const buffer = readPrivate(file.storageKey);
  if (!buffer) throw notFound("File is missing from storage");
  return { buffer, fileName: file.fileName, mimeType: file.mimeType };
}

// ---- Admin API -------------------------------------------------------------

export async function adminList({ type, status, resolution, q, take = 50, skip = 0 } = {}) {
  const where = {
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(resolution ? { resolution } : {}),
    ...(q
      ? { OR: [
          { requestNumber: { contains: q, mode: "insensitive" } },
          { order: { orderNumber: { contains: q, mode: "insensitive" } } },
          { user: { email: { contains: q, mode: "insensitive" } } },
          { orderItem: { productName: { contains: q, mode: "insensitive" } } },
        ] }
      : {}),
  };
  const [rows, total, byStatus] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(take) || 50, 200),
      skip: Number(skip) || 0,
      include: {
        order: { select: { id: true, orderNumber: true, placedAt: true } },
        orderItem: { select: { productName: true, sku: true, quantity: true } },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }),
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.groupBy({ by: ["status"], _count: true }),
  ]);
  return {
    requests: rows.map((r) => ({
      id: r.id,
      requestNumber: r.requestNumber,
      type: r.type,
      status: r.status,
      resolution: r.resolution,
      quantity: r.quantity,
      productName: r.orderItem?.productName ?? "—",
      orderNumber: r.order?.orderNumber ?? "—",
      customer: [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") || r.user.email,
      createdAt: r.createdAt,
    })),
    total,
    counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
  };
}

export async function adminGet(idOrNumber) {
  const r = await prisma.returnRequest.findFirst({
    where: { OR: [{ id: idOrNumber }, { requestNumber: idOrNumber }] },
    include: { ...DETAIL_INCLUDE, user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } } },
  });
  if (!r) return null;
  const previousRequests = await prisma.returnRequest.count({ where: { userId: r.userId, id: { not: r.id } } });
  return { ...shapeRequest(r, { forAdmin: true }), previousRequests };
}

/** Load for an admin action; throws 404 when absent. */
async function forAdmin(tx, id) {
  const r = await tx.returnRequest.findFirst({ where: { OR: [{ id }, { requestNumber: id }] } });
  if (!r) throw notFound("Request not found");
  return r;
}

async function adminTransition(id, adminId, toStatus, { note = null, data = {} } = {}) {
  const after = await prisma.$transaction(async (tx) => {
    const r = await forAdmin(tx, id);
    return transition(tx, r, toStatus, { actorId: adminId, note, data });
  });
  await notifyCustomer(after, toStatus);
  return adminGet(after.id);
}

export const adminReview = async (adminId, id) => {
  // Idempotent: opening an already-reviewed request is not an error.
  const r = await prisma.returnRequest.findFirst({ where: { OR: [{ id }, { requestNumber: id }] } });
  if (!r) throw notFound("Request not found");
  if (r.status !== "SUBMITTED") return adminGet(r.id);
  return adminTransition(r.id, adminId, "UNDER_REVIEW");
};

export const adminApprove = (adminId, id, { notes } = {}) =>
  adminTransition(id, adminId, "APPROVED", { note: notes ?? null, data: { adminNotes: notes ?? null, reviewedById: adminId } });

export async function adminReject(adminId, id, { reason } = {}) {
  const text = String(reason ?? "").trim();
  if (!text) throw badRequest("A rejection reason is required", "REASON_REQUIRED");
  return adminTransition(id, adminId, "REJECTED", { note: text, data: { rejectionReason: text, reviewedById: adminId } });
}

/**
 * Admin selects ONE resolution for an APPROVED request. The status branches
 * here; the UI then shows only that branch's workflow.
 */
export async function adminSetResolution(adminId, id, { resolution, replacementQuantity, notes } = {}) {
  if (!["REFUND", "REPLACEMENT", "RECYCLE"].includes(resolution)) throw badRequest("Unknown resolution", "BAD_RESOLUTION");
  const first = { REFUND: "REFUND_PROCESSING", REPLACEMENT: "REPLACEMENT_PROCESSING", RECYCLE: "PICKUP_SCHEDULED" }[resolution];

  const after = await prisma.$transaction(async (tx) => {
    const r = await forAdmin(tx, id);
    if (r.status !== "APPROVED") throw conflict("Select a resolution after approving the request", "NOT_APPROVED");
    const data = { resolution, adminNotes: notes ?? r.adminNotes };
    if (resolution === "REPLACEMENT") {
      const qty = Number(replacementQuantity ?? r.quantity);
      if (!Number.isInteger(qty) || qty <= 0 || qty > r.quantity) throw badRequest("Replacement quantity must be between 1 and the requested quantity");
      data.replacementQuantity = qty;
    }
    if (resolution === "RECYCLE") {
      // Pickup date can be set/adjusted via the pickup endpoint; default +2 days.
      data.pickupScheduledFor = new Date(Date.now() + 2 * 86400_000);
    }
    return transition(tx, r, first, { actorId: adminId, note: `Resolution: ${resolution}`, data });
  });
  await notifyCustomer(after, after.status);
  return adminGet(after.id);
}

/**
 * Complete a refund. Requires the REAL settlement reference (UTR/txn id) —
 * with no payment gateway, the reference is the proof; a click alone never
 * marks anything refunded. Bounded by the order's captured payment.
 */
export async function adminCompleteRefund(adminId, id, { amountMinor, reference, notes } = {}) {
  const amount = Number(amountMinor);
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Refund amount must be a positive integer (paise)");
  const ref = String(reference ?? "").trim();
  if (!ref) throw badRequest("A payment reference (UTR / transaction id) is required to complete a refund", "REFERENCE_REQUIRED");

  const after = await prisma.$transaction(async (tx) => {
    const r = await forAdmin(tx, id);
    if (r.status !== "REFUND_PROCESSING") throw conflict("Refund can only be completed from refund-processing", "INVALID_TRANSITION");

    const item = await tx.orderItem.findUnique({ where: { id: r.orderItemId }, select: { lineTotalMinor: true, quantity: true } });
    const maxForQuantity = Math.round((item.lineTotalMinor * r.quantity) / item.quantity);
    if (amount > maxForQuantity) {
      throw badRequest(`Refund exceeds the value of the returned quantity (max ₹${(maxForQuantity / 100).toFixed(2)})`, "AMOUNT_TOO_LARGE");
    }

    // Against the order's captured payment, bounded by what remains refundable.
    const payment = await tx.payment.findFirst({
      where: { orderId: r.orderId, status: { in: ["PAID", "SUCCESS", "PARTIALLY_REFUNDED"] } },
      include: { refunds: true },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) throw conflict("No captured payment exists on this order to refund against", "NO_PAYMENT");
    const alreadyRefunded = payment.refunds.filter((x) => x.status !== "rejected").reduce((s, x) => s + x.amountMinor, 0);
    if (alreadyRefunded + amount > payment.amountMinor) throw badRequest("Refund exceeds the remaining refundable amount");

    const seq = await tx.refund.count();
    await tx.refund.create({
      data: {
        refundNumber: `REF-${String(seq + 1).padStart(6, "0")}`,
        paymentId: payment.id,
        returnRequestId: r.id,
        amountMinor: amount,
        reason: r.reason,
        status: "processed",
        reference: ref,
        processedById: adminId,
        processedAt: new Date(),
      },
    });
    const fullyRefunded = alreadyRefunded + amount >= payment.amountMinor;
    await tx.payment.update({ where: { id: payment.id }, data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" } });

    return transition(tx, r, "REFUNDED", { actorId: adminId, note: notes ?? `Refund ₹${(amount / 100).toFixed(2)} · ref ${ref}` });
  });
  await notifyCustomer(after, "REFUNDED");
  return adminGet(after.id);
}

export async function adminShipReplacement(adminId, id, { courier, trackingNumber } = {}) {
  return adminTransition(id, adminId, "REPLACEMENT_SHIPPED", {
    note: [courier, trackingNumber].filter(Boolean).join(" · ") || null,
    data: { replacementCourier: courier ?? null, replacementTracking: trackingNumber ?? null, replacementShippedAt: new Date() },
  });
}

export const adminDeliverReplacement = (adminId, id) =>
  adminTransition(id, adminId, "REPLACEMENT_DELIVERED", { data: { replacementDeliveredAt: new Date() } });

export async function adminSchedulePickup(adminId, id, { date } = {}) {
  const when = date ? new Date(date) : null;
  if (!when || Number.isNaN(when.getTime())) throw badRequest("A valid pickup date is required");
  // Rescheduling an already-scheduled pickup updates the date without a
  // transition; scheduling from APPROVED is done via setResolution(RECYCLE).
  const r = await prisma.returnRequest.findFirst({ where: { OR: [{ id }, { requestNumber: id }] } });
  if (!r) throw notFound("Request not found");
  if (r.status !== "PICKUP_SCHEDULED") throw conflict("Pickup can only be (re)scheduled while in pickup-scheduled", "INVALID_TRANSITION");
  const updated = await prisma.returnRequest.update({ where: { id: r.id }, data: { pickupScheduledFor: when } });
  await notifyCustomer(updated, "PICKUP_SCHEDULED");
  return adminGet(r.id);
}

export const adminMarkReceived = (adminId, id) => adminTransition(id, adminId, "RECEIVED");

export async function adminInspect(adminId, id, { receivedQuantity, acceptedQuantity, rejectedQuantity, notes } = {}) {
  const rec = Number(receivedQuantity), acc = Number(acceptedQuantity), rej = Number(rejectedQuantity ?? rec - acc);
  if (![rec, acc, rej].every((n) => Number.isInteger(n) && n >= 0)) throw badRequest("Quantities must be non-negative whole numbers");
  if (acc + rej !== rec) throw badRequest("Accepted + rejected must equal the received quantity");

  const after = await prisma.$transaction(async (tx) => {
    const r = await forAdmin(tx, id);
    if (rec > r.quantity) throw badRequest("Received quantity cannot exceed the requested quantity");
    return transition(tx, r, "INSPECTED", {
      actorId: adminId,
      note: `Received ${rec}, accepted ${acc}, rejected ${rej}`,
      data: { receivedQuantity: rec, acceptedQuantity: acc, rejectedQuantity: rej, inspectionNotes: notes ?? null, inspectedById: adminId, inspectedAt: new Date() },
    });
  });
  await notifyCustomer(after, "INSPECTED");
  return adminGet(after.id);
}

export const adminStartRecycleProcessing = (adminId, id) => adminTransition(id, adminId, "RECYCLE_PROCESSING");
export const adminCompleteRecycle = (adminId, id) => adminTransition(id, adminId, "RECYCLED");

/**
 * Credit recycling points — ONLY after the recycle completed, ONLY on the
 * accepted quantity, exactly once (DB-unique ledger reference), through the
 * append-only PointsLedger. Never `points += n` on a user row.
 */
export async function adminCreditPoints(adminId, id) {
  const after = await prisma.$transaction(async (tx) => {
    const r = await forAdmin(tx, id);
    if (r.status !== "RECYCLED") throw conflict("Points are credited only after recycling is completed", "INVALID_TRANSITION");
    const accepted = r.acceptedQuantity ?? 0;
    if (accepted <= 0) throw badRequest("No accepted quantity to reward", "NOTHING_ACCEPTED");

    const item = await tx.orderItem.findUnique({ where: { id: r.orderItemId }, select: { productId: true } });
    const product = item?.productId
      ? await tx.product.findUnique({ where: { id: item.productId }, select: { category: true } })
      : null;
    const { rateX100, maxPoints } = await rateFor(product?.category ?? null, accepted);
    const points = computePoints(rateX100, accepted, maxPoints);

    const last = await tx.pointsLedger.findFirst({ where: { userId: r.userId }, orderBy: { createdAt: "desc" }, select: { balanceAfter: true } });
    await tx.pointsLedger.create({
      data: {
        userId: r.userId,
        type: "RECYCLE_REWARD",
        points,
        referenceType: "ReturnRequest",
        referenceId: r.id, // unique with type — double-credit is a DB error
        balanceAfter: (last?.balanceAfter ?? 0) + points,
        note: `${r.requestNumber}: ${accepted} unit(s) × ${(rateX100 / 100).toFixed(2)} pt`,
      },
    });
    return transition(tx, r, "POINTS_CREDITED", {
      actorId: adminId,
      note: `${points} points credited on ${accepted} accepted unit(s)`,
      data: { pointsAwarded: points, pointsRateX100: rateX100 },
    });
  });
  await notifyCustomer(after, "POINTS_CREDITED");
  return adminGet(after.id);
}

export const adminClose = (adminId, id) => adminTransition(id, adminId, "CLOSED");

/** Customer's points balance + ledger (append-only history). */
export async function pointsForUser(userId) {
  const rows = await prisma.pointsLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return { balance: rows[0]?.balanceAfter ?? 0, ledger: rows };
}
