// WhatsApp — the WhatsAppProvider behind the notification service (Meta Cloud API).
//
// Contract (shared with email.mjs):
//   - Called ONLY after the relevant transaction has committed. A delivery
//     failure must never fail (or roll back) the business change.
//   - Never fakes success: without configured credentials the delivery is
//     recorded as SKIPPED and logged, not "sent".
//   - Every attempt leaves a NotificationDelivery row (channel "whatsapp").
//
// Configuration comes from Settings → Notifications → WhatsApp (PostgreSQL,
// token encrypted at rest) with server/.env as a fallback — see
// services/settings.mjs. This is a real integration: if it is not configured it
// says so; it never pretends a message was sent.
import { prisma } from "../lib/prisma.mjs";
import { getNotificationSettings, isWhatsAppConfigured } from "./settings.mjs";

const GRAPH_VERSION = "v20.0";

/** Indian numbers: keep digits, prefix 91 when a bare 10-digit mobile is given. */
export function toWhatsAppNumber(raw) {
  const d = String(raw ?? "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.length === 10) return `91${d}`;
  return d;
}

function formatSpecs(specs = {}) {
  const parts = [];
  if (specs.dimensions) parts.push(`Size: ${specs.dimensions}`);
  if (specs.material) parts.push(`Material: ${specs.material}`);
  if (specs.color) parts.push(`Color: ${specs.color}`);
  if (specs.printing) parts.push(`Printing: ${specs.printing}`);
  return parts;
}

/** The owner-facing message body for a new RFQ. Plain text (Cloud API "text"). */
export function buildNewRfqMessage(rfq, { adminBaseUrl } = {}) {
  const customerName = [rfq.user?.firstName, rfq.user?.lastName].filter(Boolean).join(" ") || rfq.user?.email || "Customer";
  const lines = [
    "🔔 NEW ZOLO PACKAGING RFQ",
    "",
    `RFQ: ${rfq.rfqNumber}`,
    `Customer: ${customerName}`,
    ...(rfq.user?.phone ? [`Phone: +${rfq.user.phone.length === 10 ? "91 " : ""}${rfq.user.phone}`] : []),
    ...(rfq.user?.email ? [`Email: ${rfq.user.email}`] : []),
    "",
    `Products: ${rfq.items.length}`,
  ];
  rfq.items.forEach((item, i) => {
    lines.push("", `${i + 1}. ${item.productName}`, `Quantity: ${item.quantity.toLocaleString("en-IN")} ${item.unit || "pcs"}`);
    lines.push(...formatSpecs(item.specs));
  });
  const ship = [rfq.shipCity, rfq.shipState].filter(Boolean).join(", ");
  lines.push("", `Delivery: ${ship || "Not specified"}`);
  lines.push(`Requirement Sheet: ${rfq.files?.length ? `${rfq.files.length} file${rfq.files.length === 1 ? "" : "s"} attached` : "None"}`);
  if (adminBaseUrl) lines.push("", `View RFQ: ${adminBaseUrl}/admin/quotes/${encodeURIComponent(rfq.rfqNumber)}`);
  lines.push("", `Created: ${new Date(rfq.submittedAt ?? rfq.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}`);
  return lines.join("\n");
}

async function sendViaMeta(w, to, body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${w.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${w.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || `WhatsApp API responded ${res.status}`);
  return payload?.messages?.[0]?.id ?? null;
}

/**
 * Send a WhatsApp text to any number. Records a NotificationDelivery and never
 * throws. `userId` links the delivery to the customer it was for.
 */
export async function sendWhatsApp({ to, body, messageType = "whatsapp", entityType = null, entityId = null, userId = null }) {
  const s = await getNotificationSettings();
  const configured = isWhatsAppConfigured(s);
  const recipient = toWhatsAppNumber(to);
  let delivery = null;
  try {
    delivery = await prisma.notificationDelivery.create({
      data: {
        channel: "whatsapp",
        provider: configured ? s.whatsapp.provider : "none",
        recipient: recipient || "unconfigured",
        messageType, entityType, entityId, userId,
        body: body ? String(body).slice(0, 4000) : null,
        status: "PENDING",
      },
    });
  } catch (e) {
    console.error("[WhatsApp] delivery bookkeeping failed:", e.message);
  }

  if (!recipient || !configured) {
    const reason = !recipient ? "No recipient number" : "WhatsApp provider not configured";
    console.log(`[WhatsApp] ${messageType} not sent (${reason})`);
    if (delivery) await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SKIPPED", error: reason } }).catch(() => {});
    return { status: "SKIPPED", error: reason, deliveryId: delivery?.id ?? null };
  }

  try {
    const messageId = await sendViaMeta(s.whatsapp, recipient, body);
    if (delivery) await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", providerMessageId: messageId, sentAt: new Date() } }).catch(() => {});
    return { status: "SENT", providerMessageId: messageId, deliveryId: delivery?.id ?? null };
  } catch (e) {
    const error = String(e.message).slice(0, 500);
    console.error(`[WhatsApp] ${messageType} FAILED:`, error);
    if (delivery) await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error, failedAt: new Date() } }).catch(() => {});
    return { status: "FAILED", error, deliveryId: delivery?.id ?? null };
  }
}

/** Admin "Test WhatsApp": really sends through the configured provider. */
export async function sendTestWhatsApp(to, { actorId = null } = {}) {
  const s = await getNotificationSettings();
  if (!isWhatsAppConfigured(s)) return { status: "SKIPPED", error: "WhatsApp is not configured — save the provider, phone number id and access token first." };
  return sendWhatsApp({
    to,
    body: "✅ Zolo Packaging — WhatsApp test message. If you received this, notifications are working.",
    messageType: "settings.whatsapp.test",
    entityType: "NotificationSetting",
    entityId: "default",
    userId: actorId,
  });
}

/**
 * Notify the owner about a newly submitted RFQ (sent to the business number).
 * Never throws — the RFQ is already committed and must stay successful.
 */
export async function sendNewRfqNotification(rfqId) {
  try {
    const rfq = await prisma.rfq.findUnique({
      where: { id: rfqId },
      include: { items: true, files: true, user: { select: { email: true, firstName: true, lastName: true, phone: true } } },
    });
    if (!rfq) return { status: "FAILED", error: "RFQ not found" };
    const s = await getNotificationSettings();
    return sendWhatsApp({
      to: s.whatsapp.businessNumber,
      body: buildNewRfqMessage(rfq, { adminBaseUrl: s.publicBaseUrl }),
      messageType: "rfq.created",
      entityType: "Rfq",
      entityId: rfq.id,
    });
  } catch (e) {
    console.error("[WhatsApp] new RFQ notification failed:", e.message);
    return { status: "FAILED", error: e.message };
  }
}
