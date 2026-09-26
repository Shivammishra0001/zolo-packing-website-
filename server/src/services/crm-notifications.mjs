// ===========================================================================
// CRM notification templates.
//
// The existing `dispatch()` pipeline (services/notification-service.mjs) takes
// a title/body and handles the admin channel matrix, the customer's opt-ins,
// the providers and the NotificationDelivery log. What it lacked was named,
// reusable templates — every caller hand-wrote its own strings (§26/§27).
//
// Each template here is a pure function of real order/customer data. Nothing
// is faked: if WhatsApp or SMTP is not configured, dispatch() records a
// SKIPPED delivery and the admin sees exactly that (§28).
// ===========================================================================
import { prisma } from "../lib/prisma.mjs";
import { notFound } from "../lib/http.mjs";
import { dispatch } from "./notification-service.mjs";
import { recordEvent } from "./events.mjs";
import { derivePaymentState } from "./crm.mjs";

const inr = (minor) => `₹${((minor ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : null);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Money table shared by the payment templates. */
const moneyRows = (o) => {
  const { pendingMinor } = derivePaymentState(o);
  const rows = [
    ["Order total", inr(o.grandTotalMinor)],
    ["Paid", inr(o.paidMinor)],
    ["Pending", inr(pendingMinor)],
  ];
  if (o.dueDate) rows.push(["Due date", day(o.dueDate)]);
  return rows;
};

const asText = (rows) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");
const asHtml = (rows) =>
  `<table style="border-collapse:collapse;margin:12px 0">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;

/**
 * The template catalogue. Each returns { event, subject, title, body, html }.
 * `event` must be a key the notification matrix knows, so admins keep control
 * of which channels each one uses.
 */
export const TEMPLATES = {
  ORDER_CREATED: ({ customerName, order }) => {
    const rows = moneyRows(order);
    return {
      event: "ORDER_CREATED",
      title: `Order ${order.orderNumber} confirmed`,
      body: `Hello ${customerName},\n\nYour Zolo Packing order ${order.orderNumber} has been created.\n\n${asText(rows)}\n\nWe'll keep you posted as it progresses.`,
      html: `<p>Hello ${esc(customerName)},</p><p>Your Zolo Packing order <strong>${esc(order.orderNumber)}</strong> has been created.</p>${asHtml(rows)}<p>We'll keep you posted as it progresses.</p>`,
    };
  },

  PAYMENT_RECEIVED: ({ customerName, order, payment }) => {
    const rows = [["Payment received", inr(payment.amountMinor)], ...moneyRows(order)];
    const { pendingMinor } = derivePaymentState(order);
    const closing = pendingMinor === 0 ? "Your order is now fully paid. Thank you!" : "Thank you for your payment.";
    return {
      event: "PAYMENT_RECEIVED",
      title: `Payment received for ${order.orderNumber}`,
      body: `Hello ${customerName},\n\nWe've received your payment of ${inr(payment.amountMinor)} for order ${order.orderNumber}.\n\n${asText(rows)}\n\n${closing}`,
      html: `<p>Hello ${esc(customerName)},</p><p>We've received your payment of <strong>${esc(inr(payment.amountMinor))}</strong> for order <strong>${esc(order.orderNumber)}</strong>.</p>${asHtml(rows)}<p>${esc(closing)}</p>`,
    };
  },

  PAYMENT_DUE: ({ customerName, order }) => {
    const rows = moneyRows(order);
    const { pendingMinor } = derivePaymentState(order);
    return {
      event: "PAYMENT_REQUEST",
      title: `Payment reminder for ${order.orderNumber}`,
      body: `Hello ${customerName},\n\nYour Zolo Packing order ${order.orderNumber} has a pending amount of ${inr(pendingMinor)}.\n\n${asText(rows)}\n\nPlease contact Zolo Packing if you need any assistance.`,
      html: `<p>Hello ${esc(customerName)},</p><p>Your Zolo Packing order <strong>${esc(order.orderNumber)}</strong> has a pending amount of <strong>${esc(inr(pendingMinor))}</strong>.</p>${asHtml(rows)}<p>Please contact Zolo Packing if you need any assistance.</p>`,
    };
  },

  PAYMENT_OVERDUE: ({ customerName, order }) => {
    const rows = moneyRows(order);
    const { pendingMinor } = derivePaymentState(order);
    const days = order.dueDate ? Math.floor((Date.now() - new Date(order.dueDate)) / 86_400_000) : 0;
    const overdueLine = days > 0 ? ` It is now ${days} day${days === 1 ? "" : "s"} past the due date.` : "";
    return {
      event: "PAYMENT_REQUEST",
      title: `Overdue payment for ${order.orderNumber}`,
      body: `Hello ${customerName},\n\nOrder ${order.orderNumber} has an outstanding balance of ${inr(pendingMinor)}.${overdueLine}\n\n${asText(rows)}\n\nPlease contact Zolo Packing to arrange payment.`,
      html: `<p>Hello ${esc(customerName)},</p><p>Order <strong>${esc(order.orderNumber)}</strong> has an outstanding balance of <strong>${esc(inr(pendingMinor))}</strong>.${esc(overdueLine)}</p>${asHtml(rows)}<p>Please contact Zolo Packing to arrange payment.</p>`,
    };
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/**
 * Render a template for an order and send it through the existing pipeline.
 *
 * Returns dispatch()'s per-channel result, which reports SENT / FAILED /
 * SKIPPED truthfully — an unconfigured WhatsApp provider yields SKIPPED with
 * the reason, never a fake success (§28).
 */
export async function sendOrderNotification(adminUser, orderId, templateKey) {
  const template = TEMPLATES[templateKey];
  if (!template) throw notFound(`Unknown notification template: ${templateKey}`);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, company: true } },
      payments: { where: { status: { in: ["PAID", "SUCCESS"] } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw notFound("Order not found");

  const customerName = order.user.firstName || order.user.company || "there";
  const rendered = template({ customerName, order, payment: order.payments[0] ?? { amountMinor: 0 } });

  const result = await dispatch({
    event: rendered.event,
    userId: order.userId,
    title: rendered.title,
    body: rendered.body,
    html: rendered.html,
    entityType: "Order",
    entityId: order.id,
  });

  await recordEvent({
    eventType: "notification.sent",
    actorId: adminUser.id,
    entityType: "Order",
    entityId: order.id,
    metadata: { template: templateKey, orderNumber: order.orderNumber, channels: result },
  });

  return result;
}

/** Communication history for a customer (§29/§30) — real delivery rows only. */
export async function notificationHistory(userId, { limit = 50 } = {}) {
  const rows = await prisma.notificationDelivery.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, Number(limit) || 50)),
  });
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    messageType: r.messageType,
    recipient: r.recipient,
    subject: r.subject,
    status: r.status,
    error: r.error,
    entityType: r.entityType,
    entityId: r.entityId,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
  }));
}
