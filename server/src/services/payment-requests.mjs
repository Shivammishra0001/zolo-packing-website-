// Custom payment requests ("send a payment link").
//
//   Admin creates request → PaymentRequest row + 256-bit token (hash indexed,
//   plaintext stored encrypted so the admin can re-share) → customer notified
//   with /pay/<token> → customer pays via an enabled offline method (UPI/QR,
//   bank transfer…) and submits the reference/proof → SUBMITTED → admin
//   verifies → PAID: a Payment row is recorded, the linked order's payment
//   position is re-derived from ALL its payments, customer + admin notified.
//
// The amount is server-owned; the customer never sends one. A submission is
// never auto-marked PAID — proof is evidence for the admin's review.
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound, conflict, forbidden } from "../lib/http.mjs";
import { newRefreshToken, hashToken, encryptField, decryptField } from "../lib/crypto.mjs";
import { newPaymentNumber } from "../lib/commerce.mjs";
import { putPrivate, readPrivate, remove as removeStored, supportedPrivateMime } from "../lib/storage.mjs";
import { recordEvent, notify } from "./events.mjs";
import { getNotificationSettings, publicPaymentMethods, listPaymentMethods } from "./settings.mjs";
import { dispatch, dispatchToAdmins } from "./notification-service.mjs";

const newRequestNumber = () => `PR-${randomBytes(4).toString("hex").toUpperCase()}`;
const ONLINE_METHODS = ["upi", "bank_transfer", "neft", "cheque"];
const OPEN = ["PENDING", "SENT"];
const PROOF_MAX_BYTES = 10 * 1024 * 1024;

const createSchema = z.object({
  userId: z.string().min(1),
  amountMinor: z.number().int().min(100).max(1_000_000_000),
  currency: z.string().trim().length(3).default("INR"),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  orderId: z.string().min(1).optional().nullable(),
  quotationId: z.string().min(1).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  allowedMethods: z.array(z.enum(["upi", "bank_transfer", "neft", "cheque"])).optional(),
  send: z.boolean().default(true),
});

const submitSchema = z.object({
  method: z.enum(["upi", "bank_transfer", "neft", "cheque"]),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  proof: z.object({ name: z.string().max(200), mime: z.string().max(100), dataBase64: z.string().min(1) }).optional().nullable(),
});

const payUrlFor = (s, token) => `${s.publicBaseUrl}/pay/${token}`;

function tokenOf(pr) {
  try { return decryptField(pr.tokenEnc); } catch { return null; }
}

function shape(pr, { includeLink = false, baseUrl = "" } = {}) {
  const token = includeLink ? tokenOf(pr) : null;
  return {
    id: pr.id,
    requestNumber: pr.requestNumber,
    status: pr.status,
    title: pr.title,
    description: pr.description,
    amountMinor: pr.amountMinor,
    currency: pr.currency,
    allowedMethods: pr.allowedMethods,
    expiresAt: pr.expiresAt,
    sentAt: pr.sentAt,
    submittedAt: pr.submittedAt,
    paidAt: pr.paidAt,
    reviewedAt: pr.reviewedAt,
    reviewNote: pr.reviewNote,
    proof: pr.submittedAt ? { method: pr.proofMethod, reference: pr.proofReference, note: pr.proofNote, fileName: pr.proofFileName, hasFile: Boolean(pr.proofFileKey) } : null,
    order: pr.order ? { id: pr.order.id, orderNumber: pr.order.orderNumber, grandTotalMinor: pr.order.grandTotalMinor, paymentStatus: pr.order.paymentStatus } : null,
    quotation: pr.quotation ? { id: pr.quotation.id, quotationNumber: pr.quotation.quotationNumber } : null,
    customer: pr.user ? { id: pr.user.id, name: [pr.user.firstName, pr.user.lastName].filter(Boolean).join(" ") || pr.user.email, email: pr.user.email, phone: pr.user.phone } : null,
    payment: pr.payment ? { id: pr.payment.id, paymentNumber: pr.payment.paymentNumber, status: pr.payment.status, reference: pr.payment.reference } : null,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    ...(includeLink && token ? { payUrl: payUrlFor({ publicBaseUrl: baseUrl }, token) } : {}),
  };
}

const include = {
  user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
  order: { select: { id: true, orderNumber: true, grandTotalMinor: true, paymentStatus: true } },
  quotation: { select: { id: true, quotationNumber: true } },
  payment: { select: { id: true, paymentNumber: true, status: true, reference: true } },
};

/** Lazily expire an open request whose deadline passed (audited once). */
async function expireIfDue(pr) {
  if (!pr || !OPEN.includes(pr.status) || !pr.expiresAt || pr.expiresAt > new Date()) return pr;
  const updated = await prisma.paymentRequest.update({ where: { id: pr.id }, data: { status: "EXPIRED" }, include });
  await recordEvent({ eventType: "payment_request.expired", entityType: "PaymentRequest", entityId: pr.id, metadata: { requestNumber: pr.requestNumber } });
  return updated;
}

async function sendLink(pr, { resend = false } = {}) {
  const s = await getNotificationSettings();
  const token = tokenOf(pr);
  if (!token) return;
  const url = payUrlFor(s, token);
  const amount = `₹${(pr.amountMinor / 100).toLocaleString("en-IN")}`;
  const ref = pr.order ? ` for order ${pr.order.orderNumber}` : pr.quotation ? ` for quotation ${pr.quotation.quotationNumber}` : "";
  await dispatch({
    event: "PAYMENT_REQUEST",
    userId: pr.userId,
    title: resend ? `Reminder: payment of ${amount} requested` : `Payment of ${amount} requested${ref}`,
    body: `${pr.title}${pr.description ? `\n${pr.description}` : ""}\n\nAmount: ${amount}${pr.expiresAt ? `\nPay by: ${new Date(pr.expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}` : ""}\n\nUse the secure link below to pay and share your payment reference.`,
    link: url,
    entityType: "PaymentRequest",
    entityId: pr.id,
  });
}

/** Admin creates (and by default sends) a payment request. */
export async function createPaymentRequest(adminUser, input) {
  const p = createSchema.parse(input ?? {});
  const customer = await prisma.user.findUnique({ where: { id: p.userId }, select: { id: true, role: true, isActive: true } });
  if (!customer || customer.role !== "buyer") throw badRequest("Choose a customer account", "CUSTOMER_INVALID");
  if (!customer.isActive) throw badRequest("That customer account is inactive", "CUSTOMER_INACTIVE");

  if (p.orderId) {
    const o = await prisma.order.findFirst({ where: { id: p.orderId, userId: p.userId }, select: { id: true } });
    if (!o) throw badRequest("That order does not belong to this customer", "ORDER_INVALID");
  }
  if (p.quotationId) {
    const q = await prisma.quotation.findFirst({ where: { id: p.quotationId, userId: p.userId }, select: { id: true } });
    if (!q) throw badRequest("That quotation does not belong to this customer", "QUOTATION_INVALID");
  }
  const expiresAt = p.expiresAt ? new Date(p.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) throw badRequest("Expiry must be in the future", "EXPIRY_PAST");

  // Only enabled online methods may be offered; default to all of them.
  const enabled = (await listPaymentMethods()).filter((m) => m.enabled && ONLINE_METHODS.includes(m.key)).map((m) => m.key);
  const allowedMethods = (p.allowedMethods?.length ? p.allowedMethods.filter((m) => enabled.includes(m)) : enabled);
  if (allowedMethods.length === 0) throw badRequest("No online payment method is enabled in Settings → Payments", "NO_PAYMENT_METHOD");

  const token = newRefreshToken();
  const created = await prisma.paymentRequest.create({
    data: {
      requestNumber: newRequestNumber(),
      userId: p.userId,
      orderId: p.orderId ?? null,
      quotationId: p.quotationId ?? null,
      title: p.title,
      description: p.description ?? null,
      amountMinor: p.amountMinor,
      currency: p.currency.toUpperCase(),
      status: p.send ? "SENT" : "PENDING",
      sentAt: p.send ? new Date() : null,
      allowedMethods,
      tokenHash: hashToken(token),
      tokenEnc: encryptField(token),
      expiresAt,
      createdById: adminUser.id,
    },
    include,
  });
  await recordEvent({
    eventType: "payment_request.created", actorId: adminUser.id, entityType: "PaymentRequest", entityId: created.id,
    metadata: { requestNumber: created.requestNumber, amountMinor: created.amountMinor, orderNumber: created.order?.orderNumber ?? null, customerId: p.userId },
  });
  if (p.send) {
    await sendLink(created);
    await recordEvent({ eventType: "payment_request.sent", actorId: adminUser.id, entityType: "PaymentRequest", entityId: created.id, metadata: { requestNumber: created.requestNumber } });
  }
  const s = await getNotificationSettings();
  return shape(created, { includeLink: true, baseUrl: s.publicBaseUrl });
}

/**
 * Create a request for an order paid by an online method at checkout (UPI /
 * bank transfer). Runs inside the placement transaction (DB only); the caller
 * sends the notification post-commit via notifyOrderPaymentRequest().
 */
export async function createForOrder(tx, { order, userId, method }) {
  const token = newRefreshToken();
  const created = await tx.paymentRequest.create({
    data: {
      requestNumber: newRequestNumber(),
      userId,
      orderId: order.id,
      title: `Payment for order ${order.orderNumber}`,
      description: `Total payable for your order ${order.orderNumber}.`,
      amountMinor: order.grandTotalMinor,
      currency: order.currency ?? "INR",
      status: "SENT",
      sentAt: new Date(),
      allowedMethods: [method],
      tokenHash: hashToken(token),
      tokenEnc: encryptField(token),
      createdById: userId,
    },
  });
  return created;
}

export async function notifyOrderPaymentRequest(paymentRequestId) {
  const pr = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId }, include });
  if (pr) await sendLink(pr);
}

export async function listPaymentRequests({ status = null, userId = null, orderId = null, take = 50, skip = 0 } = {}) {
  const where = { ...(status ? { status } : {}), ...(userId ? { userId } : {}), ...(orderId ? { orderId } : {}) };
  const [rows, total] = await Promise.all([
    prisma.paymentRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(take) || 50, 1), 200), skip: Math.max(Number(skip) || 0, 0) }),
    prisma.paymentRequest.count({ where }),
  ]);
  const s = await getNotificationSettings();
  const shaped = [];
  for (const r of rows) shaped.push(shape(await expireIfDue(r), { includeLink: true, baseUrl: s.publicBaseUrl }));
  return { requests: shaped, total };
}

export async function getPaymentRequest(id) {
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include });
  if (!pr) return null;
  const s = await getNotificationSettings();
  return shape(await expireIfDue(pr), { includeLink: true, baseUrl: s.publicBaseUrl });
}

/** The customer's own requests (with pay links — they are the intended recipient). */
export async function listMine(userId, { orderId = null } = {}) {
  const rows = await prisma.paymentRequest.findMany({ where: { userId, ...(orderId ? { orderId } : {}) }, include, orderBy: { createdAt: "desc" }, take: 100 });
  const s = await getNotificationSettings();
  const out = [];
  for (const r of rows) out.push(shape(await expireIfDue(r), { includeLink: true, baseUrl: s.publicBaseUrl }));
  return { requests: out };
}

// ---- Public (token) ---------------------------------------------------------

async function findByToken(token) {
  const t = String(token ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(t)) return null;
  const pr = await prisma.paymentRequest.findUnique({ where: { tokenHash: hashToken(t) }, include });
  return pr ? expireIfDue(pr) : null;
}

/** What the customer sees on /pay/:token. Amount + methods come from the server. */
export async function getByToken(token) {
  const pr = await findByToken(token);
  if (!pr) return null;
  const methods = (await publicPaymentMethods()).filter((m) => pr.allowedMethods.includes(m.key));
  const base = shape(pr);
  return {
    ...base,
    customer: pr.user ? { firstName: pr.user.firstName, email: pr.user.email } : null,
    methods,
    canSubmit: OPEN.includes(pr.status) && methods.length > 0,
  };
}

/** Customer submits their payment reference / proof. Never auto-marks PAID. */
export async function submitByToken(token, input) {
  const p = submitSchema.parse(input ?? {});
  const pr = await findByToken(token);
  if (!pr) throw notFound("Payment link not found");
  if (pr.status === "SUBMITTED") throw conflict("Your payment details were already submitted and are being reviewed", "ALREADY_SUBMITTED");
  if (pr.status === "PAID") throw conflict("This payment has already been received", "ALREADY_PAID");
  if (!OPEN.includes(pr.status)) throw conflict(`This payment request is ${pr.status.toLowerCase()}`, "REQUEST_CLOSED");
  if (!pr.allowedMethods.includes(p.method)) throw badRequest("That payment method is not offered for this request", "METHOD_NOT_ALLOWED");
  const enabled = (await publicPaymentMethods()).some((m) => m.key === p.method);
  if (!enabled) throw badRequest("That payment method is currently unavailable", "PAYMENT_METHOD_DISABLED");
  if (!p.reference && !p.proof) throw badRequest("Enter the transaction reference (UTR/UPI ref) or attach a payment screenshot", "PROOF_REQUIRED");

  let file = null;
  if (p.proof) {
    if (!supportedPrivateMime(p.proof.mime) || !/^(image\/|application\/pdf)/.test(p.proof.mime)) throw badRequest("Proof must be a JPG, PNG, WebP or PDF", "BAD_PROOF_TYPE");
    const buffer = Buffer.from(String(p.proof.dataBase64), "base64");
    if (buffer.length === 0) throw badRequest("Proof file is empty", "EMPTY_PROOF");
    if (buffer.length > PROOF_MAX_BYTES) throw badRequest("Proof must be 10 MB or smaller", "PROOF_TOO_LARGE");
    if (p.proof.mime.startsWith("image/")) {
      const { hasImageMagic } = await import("./catalog.mjs");
      if (!hasImageMagic(buffer, p.proof.mime)) throw badRequest("Proof file is not a valid image", "CORRUPT_PROOF");
    }
    file = { key: putPrivate({ name: p.proof.name, mime: p.proof.mime, buffer }), name: p.proof.name, mime: p.proof.mime };
  }

  const updated = await prisma.paymentRequest.update({
    where: { id: pr.id },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      proofMethod: p.method,
      proofReference: p.reference || null,
      proofNote: p.note || null,
      proofFileKey: file?.key ?? null,
      proofFileName: file?.name ?? null,
      proofMime: file?.mime ?? null,
    },
    include,
  });
  await recordEvent({ eventType: "payment_request.submitted", actorId: pr.userId, entityType: "PaymentRequest", entityId: pr.id, metadata: { requestNumber: pr.requestNumber, method: p.method, hasProof: Boolean(file), reference: p.reference ? "provided" : "none" } });

  const amount = `₹${(pr.amountMinor / 100).toLocaleString("en-IN")}`;
  const s = await getNotificationSettings();
  await dispatchToAdmins({
    type: "payment_request.submitted",
    title: `Payment submitted for review — ${pr.requestNumber}`,
    body: `${updated.user?.email ?? "A customer"} submitted ${amount} via ${p.method.replace(/_/g, " ")}${p.reference ? ` (ref ${p.reference})` : ""}${pr.order ? ` for order ${pr.order.orderNumber}` : ""}. Please verify and approve.`,
    link: `${s.publicBaseUrl}/admin/finance`,
    entityType: "PaymentRequest",
    entityId: pr.id,
  });
  await notify({ userId: pr.userId, type: "payment_request.submitted", title: "Payment details received", body: `We received your ${amount} payment reference for ${pr.requestNumber}. We'll confirm once it's verified.`, entityType: "PaymentRequest", entityId: pr.id });

  return getByToken(token);
}

// ---- Admin review -----------------------------------------------------------

const PAID_STATUSES = new Set(["PAID", "SUCCESS"]);

/** Re-derive an order's paidMinor / paymentStatus / invoice from ALL its payments. */
export async function recomputeOrderPayment(tx, orderId) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, grandTotalMinor: true } });
  if (!order) return null;
  const rows = await tx.payment.findMany({ where: { orderId } });
  const paidMinor = rows.filter((p) => PAID_STATUSES.has(p.status)).reduce((s, p) => s + p.amountMinor, 0);
  const refundedMinor = rows.filter((p) => p.status === "REFUNDED").reduce((s, p) => s + p.amountMinor, 0);
  let paymentStatus = "PENDING";
  if (refundedMinor > 0 && refundedMinor >= order.grandTotalMinor) paymentStatus = "REFUNDED";
  else if (refundedMinor > 0) paymentStatus = "PARTIALLY_REFUNDED";
  else if (paidMinor >= order.grandTotalMinor && order.grandTotalMinor > 0) paymentStatus = "PAID";
  else if (paidMinor > 0) paymentStatus = "PARTIAL";
  else if (rows.some((p) => p.status === "FAILED")) paymentStatus = "FAILED";
  await tx.order.update({ where: { id: orderId }, data: { paymentStatus, paidMinor } });
  if ((await tx.invoice.count({ where: { orderId } })) > 0) {
    await tx.invoice.updateMany({ where: { orderId }, data: { status: paymentStatus === "PAID" ? "paid" : "issued" } });
  }
  return { paymentStatus, paidMinor };
}

/** Admin verified the payment: record it and mark the request PAID. Idempotent. */
export async function approvePaymentRequest(adminUser, id, { reference = null, note = null } = {}) {
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include });
  if (!pr) throw notFound("Payment request not found");
  if (pr.status === "PAID") return getPaymentRequest(id);
  if (!["SUBMITTED", "SENT", "PENDING"].includes(pr.status)) throw conflict(`Cannot approve a ${pr.status.toLowerCase()} request`, "REQUEST_CLOSED");

  const finalRef = String(reference ?? pr.proofReference ?? "").trim() || null;
  const method = pr.proofMethod ?? pr.allowedMethods[0] ?? "bank_transfer";

  const updated = await prisma.$transaction(async (tx) => {
    let paymentId = null;
    if (pr.orderId) {
      // Reuse the order's pending payment when it matches the amount (the
      // placement row); otherwise record an additional payment (advance/partial).
      const pending = await tx.payment.findFirst({ where: { orderId: pr.orderId, status: "PENDING", amountMinor: pr.amountMinor }, orderBy: { createdAt: "asc" } });
      const now = new Date();
      if (pending) {
        const upd = await tx.payment.update({ where: { id: pending.id }, data: { status: "PAID", reference: finalRef, method, paidAt: now } });
        paymentId = upd.id;
      } else {
        const created = await tx.payment.create({ data: { paymentNumber: newPaymentNumber(), orderId: pr.orderId, method, amountMinor: pr.amountMinor, status: "PAID", reference: finalRef, paidAt: now } });
        paymentId = created.id;
      }
      await recomputeOrderPayment(tx, pr.orderId);
      await recordEvent({ eventType: "payment.updated", actorId: adminUser.id, entityType: "Payment", entityId: paymentId, metadata: { orderNumber: pr.order?.orderNumber, from: "PENDING", to: "PAID", amountMinor: pr.amountMinor, via: "payment_request", requestNumber: pr.requestNumber } }, tx);
    }
    const row = await tx.paymentRequest.update({
      where: { id: pr.id },
      data: { status: "PAID", paidAt: new Date(), reviewedById: adminUser.id, reviewedAt: new Date(), reviewNote: note || null, proofReference: finalRef ?? pr.proofReference, paymentId },
      include,
    });
    await recordEvent({ eventType: "payment_request.paid", actorId: adminUser.id, entityType: "PaymentRequest", entityId: pr.id, metadata: { requestNumber: pr.requestNumber, amountMinor: pr.amountMinor, orderNumber: pr.order?.orderNumber ?? null, reference: finalRef ? "provided" : "none" } }, tx);
    return row;
  });

  const amount = `₹${(pr.amountMinor / 100).toLocaleString("en-IN")}`;
  await dispatch({
    event: "PAYMENT_RECEIVED",
    userId: pr.userId,
    title: `Payment of ${amount} received — thank you`,
    body: `We've verified your payment of ${amount} for ${pr.title}${pr.order ? ` (order ${pr.order.orderNumber})` : ""}.${finalRef ? ` Reference: ${finalRef}.` : ""}`,
    entityType: "PaymentRequest",
    entityId: pr.id,
  });
  const s = await getNotificationSettings();
  return shape(updated, { includeLink: true, baseUrl: s.publicBaseUrl });
}

export async function rejectPaymentRequest(adminUser, id, { note = null } = {}) {
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include });
  if (!pr) throw notFound("Payment request not found");
  if (pr.status !== "SUBMITTED") throw conflict("Only a submitted payment can be rejected", "NOT_SUBMITTED");
  const updated = await prisma.paymentRequest.update({
    where: { id },
    // Back to SENT so the customer can resubmit with correct details.
    data: { status: "SENT", reviewedById: adminUser.id, reviewedAt: new Date(), reviewNote: note || null, submittedAt: null },
    include,
  });
  await recordEvent({ eventType: "payment_request.rejected", actorId: adminUser.id, entityType: "PaymentRequest", entityId: id, metadata: { requestNumber: pr.requestNumber, note: note || null } });
  const amount = `₹${(pr.amountMinor / 100).toLocaleString("en-IN")}`;
  const s = await getNotificationSettings();
  const token = tokenOf(pr);
  await dispatch({
    event: "PAYMENT_FAILED",
    userId: pr.userId,
    title: `We couldn't verify your payment of ${amount}`,
    body: `Your submitted payment details for ${pr.requestNumber} could not be verified.${note ? ` Reason: ${note}.` : ""} Please check and resubmit using the link below.`,
    link: token ? payUrlFor(s, token) : null,
    entityType: "PaymentRequest",
    entityId: id,
  });
  return shape(updated, { includeLink: true, baseUrl: s.publicBaseUrl });
}

export async function cancelPaymentRequest(adminUser, id) {
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include });
  if (!pr) throw notFound("Payment request not found");
  if (pr.status === "PAID") throw conflict("A paid request cannot be cancelled", "ALREADY_PAID");
  const updated = await prisma.paymentRequest.update({ where: { id }, data: { status: "CANCELLED", reviewedById: adminUser.id, reviewedAt: new Date() }, include });
  await recordEvent({ eventType: "payment_request.cancelled", actorId: adminUser.id, entityType: "PaymentRequest", entityId: id, metadata: { requestNumber: pr.requestNumber } });
  const s = await getNotificationSettings();
  return shape(updated, { includeLink: true, baseUrl: s.publicBaseUrl });
}

export async function resendPaymentRequest(adminUser, id) {
  const pr = await expireIfDue(await prisma.paymentRequest.findUnique({ where: { id }, include }));
  if (!pr) throw notFound("Payment request not found");
  if (!OPEN.includes(pr.status)) throw conflict(`Cannot resend a ${pr.status.toLowerCase()} request`, "REQUEST_CLOSED");
  const updated = await prisma.paymentRequest.update({ where: { id }, data: { status: "SENT", sentAt: new Date() }, include });
  await sendLink(updated, { resend: true });
  await recordEvent({ eventType: "payment_request.sent", actorId: adminUser.id, entityType: "PaymentRequest", entityId: id, metadata: { requestNumber: pr.requestNumber, resend: true } });
  const s = await getNotificationSettings();
  return shape(updated, { includeLink: true, baseUrl: s.publicBaseUrl });
}

/** Admin-only proof download (bytes, never a URL). */
export async function readProof(id) {
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, select: { proofFileKey: true, proofFileName: true, proofMime: true } });
  if (!pr || !pr.proofFileKey) throw notFound("No proof file on this request");
  const buffer = readPrivate(pr.proofFileKey);
  if (!buffer) throw notFound("Proof file is missing from storage");
  return { buffer, fileName: pr.proofFileName ?? "proof", mimeType: pr.proofMime ?? "application/octet-stream" };
}

// Guard: a non-admin must never reach the admin functions above.
export function assertAdmin(user) {
  if (!user) throw forbidden();
}

export const _internal = { removeStored };
