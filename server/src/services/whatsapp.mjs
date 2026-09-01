// WhatsApp owner notifications.
//
// Contract with the RFQ flow:
//   - Called ONLY after the RFQ transaction has committed. A delivery failure
//     must never fail (or roll back) the RFQ itself.
//   - Never fakes success: without configured credentials the delivery is
//     recorded as SKIPPED and logged, not "sent".
//   - Every attempt leaves a NotificationDelivery row (provider, recipient,
//     status, provider message id, error) so the admin can see what happened.
//
// Configuration (server/.env — see .env.example):
//   WHATSAPP_PROVIDER=meta            currently only Meta's Cloud API
//   WHATSAPP_ACCESS_TOKEN=...
//   WHATSAPP_PHONE_NUMBER_ID=...
//   OWNER_WHATSAPP_NUMBER=91XXXXXXXXXX  (digits, country code first)
//   ADMIN_BASE_URL=https://yourdomain   (for the "View RFQ" link)
import { prisma } from "../lib/prisma.mjs";

const GRAPH_VERSION = "v20.0";

function config() {
  return {
    provider: String(process.env.WHATSAPP_PROVIDER || "").trim().toLowerCase(),
    accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
    ownerNumber: String(process.env.OWNER_WHATSAPP_NUMBER || "").replace(/[^\d]/g, ""),
    adminBaseUrl: String(process.env.ADMIN_BASE_URL || "").trim().replace(/\/$/, ""),
  };
}

const isConfigured = (c) => c.provider === "meta" && c.accessToken && c.phoneNumberId && c.ownerNumber;

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

async function sendViaMeta(c, to, body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error?.message || `WhatsApp API responded ${res.status}`);
  }
  return payload?.messages?.[0]?.id ?? null;
}

/**
 * Notify the owner about a newly submitted RFQ.
 *
 * Never throws — the RFQ is already committed and must stay successful whatever
 * happens here. Returns the delivery record's final status.
 */
export async function sendNewRfqNotification(rfqId) {
  try {
    const rfq = await prisma.rfq.findUnique({
      where: { id: rfqId },
      include: {
        items: true,
        files: true,
        user: { select: { email: true, firstName: true, lastName: true, phone: true } },
      },
    });
    if (!rfq) return { status: "FAILED", error: "RFQ not found" };

    const c = config();
    const delivery = await prisma.notificationDelivery.create({
      data: {
        channel: "whatsapp",
        provider: isConfigured(c) ? c.provider : "none",
        recipient: c.ownerNumber || "unconfigured",
        messageType: "rfq.created",
        entityType: "Rfq",
        entityId: rfq.id,
        status: "PENDING",
      },
    });

    if (!isConfigured(c)) {
      // Development / not-yet-configured: log honestly, never fake a delivery.
      console.log(`[WhatsApp] New RFQ notification queued: ${rfq.rfqNumber} (no provider configured — not sent)`);
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SKIPPED", error: "WhatsApp provider not configured" },
      });
      return { status: "SKIPPED" };
    }

    try {
      const messageId = await sendViaMeta(c, c.ownerNumber, buildNewRfqMessage(rfq, { adminBaseUrl: c.adminBaseUrl }));
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", providerMessageId: messageId },
      });
      console.log(`[WhatsApp] New RFQ notification sent: ${rfq.rfqNumber}`);
      return { status: "SENT" };
    } catch (e) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: String(e.message).slice(0, 500) },
      });
      console.error(`[WhatsApp] New RFQ notification FAILED for ${rfq.rfqNumber}:`, e.message);
      return { status: "FAILED", error: e.message };
    }
  } catch (e) {
    // Even the bookkeeping failed — log and move on; the RFQ stands.
    console.error("[WhatsApp] delivery bookkeeping failed:", e.message);
    return { status: "FAILED", error: e.message };
  }
}
