// Transactional email — the EmailProvider behind the notification service.
//
// Contract (shared with whatsapp.mjs):
//   - Called ONLY after the relevant transaction has committed; a delivery
//     failure must never fail or roll back the business change.
//   - Never fakes success: with no SMTP configured the delivery is recorded
//     SKIPPED and logged, not "sent".
//   - Every attempt leaves a NotificationDelivery row (channel "email").
//
// Configuration comes from Settings → Notifications → Email (PostgreSQL,
// password encrypted at rest) with server/.env as a fallback — see
// services/settings.mjs getNotificationSettings(). The nodemailer transport is
// cached per configuration signature, so saving new SMTP settings takes
// effect immediately without a restart. nodemailer is imported lazily and
// defensively, so a deployment without it simply no-ops.
import { prisma } from "../lib/prisma.mjs";
import { getNotificationSettings, isEmailConfigured } from "./settings.mjs";

let transport = null;
let transportSig = "";
async function getTransport(e) {
  const sig = JSON.stringify([e.host, e.port, e.secure, e.user, e.pass]);
  if (transport && transportSig === sig) return transport;
  try {
    const nodemailer = (await import("nodemailer")).default;
    transport = nodemailer.createTransport({ host: e.host, port: e.port, secure: e.secure, auth: { user: e.user, pass: e.pass } });
    transportSig = sig;
    return transport;
  } catch (err) {
    console.error("[email] nodemailer not available:", err.message);
    return null;
  }
}

const fromHeader = (e) => (e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail);

/**
 * Send one email and record its delivery. Never throws.
 * `to` may be a single address or an array. `userId` links the delivery to
 * the customer it was for (null for owner/admin alerts).
 */
export async function sendMail({ to, subject, text, html, messageType = "email", entityType = null, entityId = null, userId = null }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const s = await getNotificationSettings();
  const configured = isEmailConfigured(s);
  let delivery = null;
  try {
    delivery = await prisma.notificationDelivery.create({
      data: {
        channel: "email",
        provider: configured ? "smtp" : "none",
        recipient: recipients.join(", ").slice(0, 500) || "unconfigured",
        messageType,
        entityType,
        entityId,
        userId,
        subject: subject ? String(subject).slice(0, 300) : null,
        body: text ? String(text).slice(0, 4000) : null,
        status: "PENDING",
      },
    });
  } catch (e) {
    console.error("[email] delivery bookkeeping failed:", e.message);
  }

  if (recipients.length === 0 || !configured) {
    const reason = recipients.length === 0 ? "No recipient" : "SMTP not configured";
    console.log(`[email] ${messageType} not sent (${reason})`);
    if (delivery) {
      await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "SKIPPED", error: reason } }).catch(() => {});
    }
    return { status: "SKIPPED", error: reason, deliveryId: delivery?.id ?? null };
  }

  try {
    const t = await getTransport(s.email);
    if (!t) throw new Error("nodemailer unavailable");
    const info = await t.sendMail({
      from: fromHeader(s.email),
      to: recipients.join(", "),
      ...(s.email.replyTo ? { replyTo: s.email.replyTo } : {}),
      subject,
      text,
      html,
    });
    if (delivery) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", providerMessageId: info?.messageId ?? null, sentAt: new Date() },
      }).catch(() => {});
    }
    return { status: "SENT", providerMessageId: info?.messageId ?? null, deliveryId: delivery?.id ?? null };
  } catch (e) {
    // The message may contain the host but never the password.
    const error = String(e.message).slice(0, 500);
    console.error(`[email] ${messageType} FAILED:`, error);
    if (delivery) {
      await prisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error, failedAt: new Date() } }).catch(() => {});
    }
    return { status: "FAILED", error, deliveryId: delivery?.id ?? null };
  }
}

/** Admin "Test email": really sends through the configured SMTP and reports the outcome. */
export async function sendTestEmail(to, { actorId = null } = {}) {
  const s = await getNotificationSettings();
  if (!isEmailConfigured(s)) return { status: "SKIPPED", error: "SMTP is not configured — save host, username and password first." };
  const res = await sendMail({
    to,
    subject: "Zolo Packaging — test email",
    text: `This is a test email from Zolo Packaging.\n\nIf you can read this, SMTP (${s.email.host}:${s.email.port}) is working.`,
    html: wrap("Test email", `<p>This is a test email from <b>Zolo Packaging</b>.</p><p>If you can read this, SMTP (<code>${esc(s.email.host)}:${s.email.port}</code>) is working.</p>`),
    messageType: "settings.email.test",
    entityType: "NotificationSetting",
    entityId: "default",
    userId: actorId,
  });
  return res;
}

export const esc = (s) => String(s ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
export const wrap = (title, bodyHtml) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
     <h2 style="color:#ea580c;margin:0 0 12px">${esc(title)}</h2>${bodyHtml}
     <p style="margin-top:24px;font-size:12px;color:#94a3b8">Zolo Packaging</p>
   </div>`;

function itemLines(items = []) {
  return items
    .map((it, i) => `${i + 1}. ${it.productName} — ${Number(it.quantity).toLocaleString("en-IN")} ${it.unit || "pcs"}`)
    .join("\n");
}

/** On RFQ submit: confirm to the customer and alert the admin/team. Never throws. */
export async function sendRfqSubmitted(rfqId) {
  try {
    const rfq = await prisma.rfq.findUnique({
      where: { id: rfqId },
      include: { items: true, user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    if (!rfq) return;
    const s = await getNotificationSettings();
    const name = [rfq.user?.firstName, rfq.user?.lastName].filter(Boolean).join(" ") || "there";
    const ship = [rfq.shipCity, rfq.shipState].filter(Boolean).join(", ") || "Not specified";
    const items = itemLines(rfq.items);

    if (rfq.user?.email) {
      await sendMail({
        to: rfq.user.email,
        userId: rfq.user.id,
        subject: `Your bulk quote request ${rfq.rfqNumber} has been submitted`,
        text: `Hi ${name},\n\nThanks — your bulk quote request ${rfq.rfqNumber} has been submitted with ${rfq.items.length} product(s):\n\n${items}\n\nDelivery: ${ship}\n\nOur team and matched suppliers will send you quotations shortly. You can track them under My Quotes.\n\n— Zolo Packaging`,
        html: wrap("Your quote request is in!", `<p>Hi ${esc(name)},</p><p>Your bulk quote request <b>${esc(rfq.rfqNumber)}</b> has been submitted with ${rfq.items.length} product(s):</p><pre style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(items)}</pre><p>Delivery: ${esc(ship)}</p><p>We'll notify you as quotations arrive — track them under <b>My Quotes</b>.</p>`),
        messageType: "rfq.submitted.customer",
        entityType: "Rfq",
        entityId: rfq.id,
      });
    }

    if (s.email.adminEmail) {
      const link = s.publicBaseUrl ? `\n\nView: ${s.publicBaseUrl}/admin/quotes/${encodeURIComponent(rfq.rfqNumber)}` : "";
      await sendMail({
        to: s.email.adminEmail,
        subject: `New bulk RFQ received — ${rfq.rfqNumber}`,
        text: `New bulk RFQ ${rfq.rfqNumber} from ${rfq.user?.email || "a customer"} with ${rfq.items.length} product(s):\n\n${items}\n\nDelivery: ${ship}${link}`,
        html: wrap("New bulk RFQ received", `<p><b>${esc(rfq.rfqNumber)}</b> from ${esc(rfq.user?.email || "a customer")} — ${rfq.items.length} product(s):</p><pre style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(items)}</pre><p>Delivery: ${esc(ship)}</p>${s.publicBaseUrl ? `<p><a href="${s.publicBaseUrl}/admin/quotes/${encodeURIComponent(rfq.rfqNumber)}">Open in admin</a></p>` : ""}`),
        messageType: "rfq.submitted.admin",
        entityType: "Rfq",
        entityId: rfq.id,
      });
    }
  } catch (e) {
    console.error("[email] sendRfqSubmitted failed:", e.message);
  }
}

/** Email the invited sellers that a matching RFQ is available. Never throws. */
export async function sendSellerInvites(rfqId, supplierIds = []) {
  try {
    if (!supplierIds.length) return;
    const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, include: { items: true } });
    if (!rfq) return;
    const s = await getNotificationSettings();
    const items = itemLines(rfq.items);
    const profiles = await prisma.supplierProfile.findMany({ where: { id: { in: supplierIds } }, select: { organizationId: true } });
    const orgIds = profiles.map((p) => p.organizationId);
    if (!orgIds.length) return;
    const members = await prisma.organizationMember.findMany({ where: { organizationId: { in: orgIds } }, select: { user: { select: { email: true } } } });
    const emails = [...new Set(members.map((m) => m.user?.email).filter(Boolean))];
    if (!emails.length) return;
    const link = s.publicBaseUrl ? `\n\nRespond: ${s.publicBaseUrl}/seller/rfqs` : "";
    await sendMail({
      to: emails,
      subject: `New RFQ matching your products — ${rfq.rfqNumber}`,
      text: `A new buyer request (${rfq.rfqNumber}) matches your catalogue:\n\n${items}\n\nSign in to your seller dashboard to submit a quote.${link}`,
      html: wrap("New RFQ matching your products", `<p>A new buyer request <b>${esc(rfq.rfqNumber)}</b> matches your catalogue:</p><pre style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(items)}</pre><p>Sign in to your seller dashboard to submit a quote.</p>${s.publicBaseUrl ? `<p><a href="${s.publicBaseUrl}/seller/rfqs">Open seller dashboard</a></p>` : ""}`),
      messageType: "rfq.invite.seller",
      entityType: "Rfq",
      entityId: rfq.id,
    });
  } catch (e) {
    console.error("[email] sendSellerInvites failed:", e.message);
  }
}

/** Email the buyer that a new quotation has arrived. Never throws. */
export async function sendQuoteReceived(quotationId) {
  try {
    const q = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        rfq: { select: { rfqNumber: true } },
        user: { select: { id: true, email: true, firstName: true } },
        supplier: { select: { organization: { select: { name: true } } } },
      },
    });
    if (!q || !q.user?.email) return;
    const s = await getNotificationSettings();
    const sellerName = q.supplier?.organization?.name || "Zolo Packaging";
    const total = `₹${(q.grandTotalMinor / 100).toLocaleString("en-IN")}`;
    const link = s.publicBaseUrl ? `\n\nView & compare: ${s.publicBaseUrl}/account/quotations` : "";
    await sendMail({
      to: q.user.email,
      userId: q.user.id,
      subject: `New quotation for ${q.rfq?.rfqNumber ?? "your request"} — ${total}`,
      text: `Hi ${q.user.firstName || "there"},\n\n${sellerName} sent a quotation (${q.quotationNumber}) for ${q.rfq?.rfqNumber ?? "your request"}.\n\nTotal: ${total}${q.leadTimeDays ? `\nLead time: ${q.leadTimeDays} days` : ""}\n\nCompare and respond under My Quotes.${link}`,
      html: wrap("You have a new quotation", `<p>Hi ${esc(q.user.firstName || "there")},</p><p><b>${esc(sellerName)}</b> sent quotation <b>${esc(q.quotationNumber)}</b> for <b>${esc(q.rfq?.rfqNumber ?? "your request")}</b>.</p><p style="font-size:20px;font-weight:700">${esc(total)}</p>${q.leadTimeDays ? `<p>Lead time: ${q.leadTimeDays} days</p>` : ""}<p>Compare and respond under <b>My Quotes</b>.</p>`),
      messageType: "quotation.received.customer",
      entityType: "Quotation",
      entityId: q.id,
    });
  } catch (e) {
    console.error("[email] sendQuoteReceived failed:", e.message);
  }
}
