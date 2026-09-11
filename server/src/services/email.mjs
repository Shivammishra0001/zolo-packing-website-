// Transactional email for the RFQ / bulk-quote flow.
//
// Same contract as whatsapp.mjs:
//   - Called ONLY after the relevant transaction has committed; a delivery
//     failure must never fail or roll back the RFQ / quotation.
//   - Never fakes success: with no SMTP configured the delivery is recorded
//     SKIPPED and logged, not "sent".
//   - Every attempt leaves a NotificationDelivery row (channel "email").
//   - nodemailer is imported lazily and defensively, so a deployment that has
//     not installed it (or not configured SMTP) simply no-ops.
//
// Configuration (server/.env — see .env.example):
//   EMAIL_PROVIDER=smtp
//   SMTP_HOST=...            SMTP_PORT=587      SMTP_SECURE=false
//   SMTP_USER=...            SMTP_PASS=...
//   EMAIL_FROM="Zolo Packaging <no-reply@zolopackaging.com>"
//   ADMIN_EMAIL=...          (RFQ alerts to the team)
//   ADMIN_BASE_URL=https://yourdomain   (links in the emails)
import { prisma } from "../lib/prisma.mjs";

function config() {
  return {
    provider: String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase(),
    host: String(process.env.SMTP_HOST || "").trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true",
    user: String(process.env.SMTP_USER || "").trim(),
    pass: String(process.env.SMTP_PASS || "").trim(),
    from: String(process.env.EMAIL_FROM || "Zolo Packaging <no-reply@zolopackaging.com>").trim(),
    adminEmail: String(process.env.ADMIN_EMAIL || "").trim(),
    adminBaseUrl: String(process.env.ADMIN_BASE_URL || "").trim().replace(/\/$/, ""),
  };
}

const isConfigured = (c) => c.provider === "smtp" && c.host && c.user && c.pass;

let transportPromise = null;
async function getTransport(c) {
  if (transportPromise) return transportPromise;
  transportPromise = (async () => {
    try {
      const nodemailer = (await import("nodemailer")).default;
      return nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.secure,
        auth: { user: c.user, pass: c.pass },
      });
    } catch (e) {
      console.error("[email] nodemailer not available:", e.message);
      return null;
    }
  })();
  return transportPromise;
}

/**
 * Send one email and record its delivery. Never throws.
 * `to` may be a single address or an array.
 */
async function sendMail({ to, subject, text, html, messageType = "email", entityType, entityId }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const c = config();
  let delivery = null;
  try {
    delivery = await prisma.notificationDelivery.create({
      data: {
        channel: "email",
        provider: isConfigured(c) ? "smtp" : "none",
        recipient: recipients.join(", ").slice(0, 500) || "unconfigured",
        messageType,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        status: "PENDING",
      },
    });
  } catch (e) {
    console.error("[email] delivery bookkeeping failed:", e.message);
  }

  if (recipients.length === 0 || !isConfigured(c)) {
    console.log(`[email] ${messageType} not sent (${recipients.length === 0 ? "no recipient" : "SMTP not configured"})`);
    if (delivery) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SKIPPED", error: recipients.length === 0 ? "No recipient" : "SMTP not configured" },
      }).catch(() => {});
    }
    return { status: "SKIPPED" };
  }

  try {
    const transport = await getTransport(c);
    if (!transport) throw new Error("nodemailer unavailable");
    const info = await transport.sendMail({ from: c.from, to: recipients.join(", "), subject, text, html });
    if (delivery) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", providerMessageId: info?.messageId ?? null },
      }).catch(() => {});
    }
    return { status: "SENT" };
  } catch (e) {
    console.error(`[email] ${messageType} FAILED:`, e.message);
    if (delivery) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: String(e.message).slice(0, 500) },
      }).catch(() => {});
    }
    return { status: "FAILED", error: e.message };
  }
}

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
const wrap = (title, bodyHtml) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
     <h2 style="color:#ea580c;margin:0 0 12px">${esc(title)}</h2>${bodyHtml}
     <p style="margin-top:24px;font-size:12px;color:#94a3b8">Zolo Packaging</p>
   </div>`;

function itemLines(items = []) {
  return items
    .map((it, i) => `${i + 1}. ${it.productName} — ${Number(it.quantity).toLocaleString("en-IN")} ${it.unit || "pcs"}`)
    .join("\n");
}

/**
 * On RFQ submit: confirm to the customer and alert the admin/team.
 * Never throws.
 */
export async function sendRfqSubmitted(rfqId) {
  try {
    const rfq = await prisma.rfq.findUnique({
      where: { id: rfqId },
      include: { items: true, user: { select: { email: true, firstName: true, lastName: true } } },
    });
    if (!rfq) return;
    const c = config();
    const name = [rfq.user?.firstName, rfq.user?.lastName].filter(Boolean).join(" ") || "there";
    const ship = [rfq.shipCity, rfq.shipState].filter(Boolean).join(", ") || "Not specified";
    const items = itemLines(rfq.items);

    // Customer confirmation
    if (rfq.user?.email) {
      await sendMail({
        to: rfq.user.email,
        subject: `Your bulk quote request ${rfq.rfqNumber} has been submitted`,
        text: `Hi ${name},\n\nThanks — your bulk quote request ${rfq.rfqNumber} has been submitted with ${rfq.items.length} product(s):\n\n${items}\n\nDelivery: ${ship}\n\nOur team and matched suppliers will send you quotations shortly. You can track them under My Quotes.\n\n— Zolo Packaging`,
        html: wrap("Your quote request is in!", `<p>Hi ${esc(name)},</p><p>Your bulk quote request <b>${esc(rfq.rfqNumber)}</b> has been submitted with ${rfq.items.length} product(s):</p><pre style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(items)}</pre><p>Delivery: ${esc(ship)}</p><p>We'll notify you as quotations arrive — track them under <b>My Quotes</b>.</p>`),
        messageType: "rfq.submitted.customer",
        entityType: "Rfq",
        entityId: rfq.id,
      });
    }

    // Admin/team alert
    if (c.adminEmail) {
      const link = c.adminBaseUrl ? `\n\nView: ${c.adminBaseUrl}/admin/quotes/${encodeURIComponent(rfq.rfqNumber)}` : "";
      await sendMail({
        to: c.adminEmail,
        subject: `New bulk RFQ received — ${rfq.rfqNumber}`,
        text: `New bulk RFQ ${rfq.rfqNumber} from ${rfq.user?.email || "a customer"} with ${rfq.items.length} product(s):\n\n${items}\n\nDelivery: ${ship}${link}`,
        html: wrap("New bulk RFQ received", `<p><b>${esc(rfq.rfqNumber)}</b> from ${esc(rfq.user?.email || "a customer")} — ${rfq.items.length} product(s):</p><pre style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(items)}</pre><p>Delivery: ${esc(ship)}</p>${c.adminBaseUrl ? `<p><a href="${c.adminBaseUrl}/admin/quotes/${encodeURIComponent(rfq.rfqNumber)}">Open in admin</a></p>` : ""}`),
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
    const c = config();
    const items = itemLines(rfq.items);
    const profiles = await prisma.supplierProfile.findMany({
      where: { id: { in: supplierIds } },
      select: { organizationId: true },
    });
    const orgIds = profiles.map((p) => p.organizationId);
    if (!orgIds.length) return;
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: { in: orgIds } },
      select: { user: { select: { email: true } } },
    });
    const emails = [...new Set(members.map((m) => m.user?.email).filter(Boolean))];
    if (!emails.length) return;
    const link = c.adminBaseUrl ? `\n\nRespond: ${c.adminBaseUrl}/seller/rfqs` : "";
    await sendMail({
      to: emails,
      subject: `New RFQ matching your products — ${rfq.rfqNumber}`,
      text: `A new buyer request (${rfq.rfqNumber}) matches your catalogue:\n\n${items}\n\nSign in to your seller dashboard to submit a quote.${link}`,
      html: wrap("New RFQ matching your products", `<p>A new buyer request <b>${esc(rfq.rfqNumber)}</b> matches your catalogue:</p><pre style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(items)}</pre><p>Sign in to your seller dashboard to submit a quote.</p>${c.adminBaseUrl ? `<p><a href="${c.adminBaseUrl}/seller/rfqs">Open seller dashboard</a></p>` : ""}`),
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
        user: { select: { email: true, firstName: true } },
        supplier: { select: { /* name lives on org */ organization: { select: { name: true } } } },
      },
    });
    if (!q || !q.user?.email) return;
    const c = config();
    const sellerName = q.supplier?.organization?.name || "Zolo Packaging";
    const total = `₹${(q.grandTotalMinor / 100).toLocaleString("en-IN")}`;
    const link = c.adminBaseUrl ? `\n\nView & compare: ${c.adminBaseUrl}/account/quotations` : "";
    await sendMail({
      to: q.user.email,
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
