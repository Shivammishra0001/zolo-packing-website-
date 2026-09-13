// Centralised customer notification service.
//
//   business event (post-commit)
//     → dispatch()
//       → Admin notification settings  (channel on/off + per-event matrix)
//       → Customer preferences         (WhatsApp/SMS opt-in; marketing opt-out)
//       → providers: InApp (Notification row) / Email / WhatsApp / SMS (stub)
//       → NotificationDelivery row per channel with the real outcome
//
// Rules: the admin settings are the master switch — a disabled channel can
// never be used. Transactional events (orders, payments, quotations) are
// mandatory and ignore the marketing opt-out; WhatsApp/SMS additionally
// require the customer's opt-in. Nothing here ever throws to the caller.
import { prisma } from "../lib/prisma.mjs";
import { notify, notifyRoles } from "./events.mjs";
import { getNotificationSettings } from "./settings.mjs";

export const NOTIFICATION_EVENTS = [
  { key: "CUSTOMER_REGISTRATION", label: "Customer registration", mandatory: true },
  { key: "ORDER_CREATED", label: "Order created", mandatory: true },
  { key: "ORDER_CONFIRMED", label: "Order confirmed", mandatory: true },
  { key: "ORDER_STATUS_CHANGED", label: "Order status changed", mandatory: true },
  { key: "QUOTATION_CREATED", label: "Quotation created", mandatory: true },
  { key: "QUOTATION_UPDATED", label: "Quotation updated", mandatory: true },
  { key: "QUOTATION_ACCEPTED", label: "Quotation accepted", mandatory: true },
  { key: "PAYMENT_REQUEST", label: "Payment request", mandatory: true },
  { key: "PAYMENT_RECEIVED", label: "Payment received", mandatory: true },
  { key: "PAYMENT_FAILED", label: "Payment failed / rejected", mandatory: true },
  { key: "SHIPMENT_DISPATCHED", label: "Shipment dispatched", mandatory: true },
  { key: "SHIPMENT_IN_TRANSIT", label: "Shipment in transit", mandatory: true },
  { key: "ORDER_DELIVERED", label: "Order delivered", mandatory: true },
  { key: "REFUND_UPDATE", label: "Refund / payment update", mandatory: true },
  { key: "PROMOTION", label: "Offers & news (marketing)", mandatory: false },
];

const EVENT_BY_KEY = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

/** Default channel matrix when the admin has not customised an event. */
export function defaultChannels(eventKey) {
  if (eventKey === "PROMOTION") return { email: true, whatsapp: false, sms: false, inApp: false };
  return { email: true, whatsapp: true, sms: false, inApp: true };
}

/** Effective channel matrix (defaults merged with admin overrides) — for the admin UI. */
export function effectiveMatrix(eventMatrix = {}) {
  const out = {};
  for (const e of NOTIFICATION_EVENTS) out[e.key] = { ...defaultChannels(e.key), ...(eventMatrix[e.key] ?? {}) };
  return out;
}

async function recordSkipped({ channel, provider, recipient, messageType, entityType, entityId, userId, subject, body, reason }) {
  try {
    const d = await prisma.notificationDelivery.create({
      data: { channel, provider, recipient: recipient || "unconfigured", messageType, entityType, entityId, userId, subject, body, status: "SKIPPED", error: reason },
    });
    return { status: "SKIPPED", error: reason, deliveryId: d.id };
  } catch {
    return { status: "SKIPPED", error: reason, deliveryId: null };
  }
}

/**
 * Dispatch a customer notification for a business event.
 *
 * @param {object} p
 * @param {string} p.event       one of NOTIFICATION_EVENTS keys
 * @param {string} p.userId      the customer
 * @param {string} p.title       short title (in-app title / email subject)
 * @param {string} p.body        plain-text body
 * @param {string} [p.html]      optional email HTML body
 * @param {string} [p.link]      optional URL appended to email/WhatsApp
 * @param {boolean} [p.skipInApp] when the caller already wrote the in-app row
 */
export async function dispatch({ event, userId, title, body, html = null, link = null, entityType = null, entityId = null, skipInApp = false }) {
  const result = { event, inApp: null, email: null, whatsapp: null, sms: null };
  try {
    const def = EVENT_BY_KEY[event];
    if (!def) { result.error = `Unknown notification event ${event}`; return result; }
    const s = await getNotificationSettings();
    const channels = { ...defaultChannels(event), ...(s.eventMatrix?.[event] ?? {}) };
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, firstName: true, isActive: true, preferences: true },
    });
    if (!user || !user.isActive) { result.error = "Customer not found or inactive"; return result; }
    const prefs = user.preferences && typeof user.preferences === "object" ? user.preferences : {};
    // Marketing respects the customer's opt-out; transactional events do not.
    const marketingOptedOut = !def.mandatory && prefs.promotions === false;
    const fullBody = link ? `${body}\n\n${link}` : body;
    const base = { messageType: event, entityType, entityId, userId: user.id };

    // In-app
    if (!skipInApp && s.inAppEnabled && channels.inApp && !marketingOptedOut) {
      await notify({ userId: user.id, type: event.toLowerCase(), title, body, entityType, entityId });
      result.inApp = { status: "SENT" };
    }

    // Email
    if (channels.email && !marketingOptedOut) {
      if (!s.emailEnabled) result.email = await recordSkipped({ ...base, channel: "email", provider: "none", recipient: user.email, subject: title, body: fullBody, reason: "Email channel disabled by admin" });
      else {
        const { sendMail, wrap, esc } = await import("./email.mjs");
        const greeting = user.firstName ? `Hi ${esc(user.firstName)},` : "Hello,";
        result.email = await sendMail({
          ...base, to: user.email, subject: title,
          text: `${user.firstName ? `Hi ${user.firstName},\n\n` : ""}${fullBody}\n\n— Zolo Packaging`,
          html: html ?? wrap(title, `<p>${greeting}</p><p style="white-space:pre-wrap">${esc(body)}</p>${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#f97316;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open</a></p>` : ""}`),
        });
      }
    }

    // WhatsApp — needs the admin channel AND the customer's opt-in (default on).
    if (channels.whatsapp && !marketingOptedOut) {
      if (!s.whatsappEnabled) result.whatsapp = await recordSkipped({ ...base, channel: "whatsapp", provider: "none", recipient: user.phone, body: fullBody, reason: "WhatsApp channel disabled by admin" });
      else if (prefs.whatsapp === false) result.whatsapp = await recordSkipped({ ...base, channel: "whatsapp", provider: "none", recipient: user.phone, body: fullBody, reason: "Customer opted out of WhatsApp" });
      else {
        const { sendWhatsApp } = await import("./whatsapp.mjs");
        result.whatsapp = await sendWhatsApp({ ...base, to: user.phone, body: `${title}\n\n${fullBody}` });
      }
    }

    // SMS — provider abstraction: no SMS provider is integrated, so this is
    // recorded as SKIPPED with the honest reason (never faked).
    if (channels.sms && !marketingOptedOut && s.smsEnabled && prefs.sms === true) {
      result.sms = await recordSkipped({ ...base, channel: "sms", provider: "none", recipient: user.phone, body: fullBody, reason: "SMS provider not configured" });
    }
  } catch (e) {
    console.error(`[notify] dispatch ${event} failed:`, e.message);
    result.error = e.message;
  }
  return result;
}

/**
 * Alert the admin team (in-app to admin roles + email to the configured admin
 * inbox). Used for payment submissions and other events needing review.
 */
export async function dispatchToAdmins({ type, title, body, link = null, entityType = null, entityId = null }) {
  try {
    await notifyRoles(["admin", "operations_admin", "finance_admin"], { type, title, body, entityType, entityId });
    const s = await getNotificationSettings();
    if (s.emailEnabled && s.email.adminEmail) {
      const { sendMail, wrap, esc } = await import("./email.mjs");
      await sendMail({
        to: s.email.adminEmail, subject: title,
        text: `${body}${link ? `\n\n${link}` : ""}`,
        html: wrap(title, `<p style="white-space:pre-wrap">${esc(body)}</p>${link ? `<p><a href="${esc(link)}">Open in admin</a></p>` : ""}`),
        messageType: type, entityType, entityId,
      });
    }
  } catch (e) {
    console.error(`[notify] admin alert ${type} failed:`, e.message);
  }
}
