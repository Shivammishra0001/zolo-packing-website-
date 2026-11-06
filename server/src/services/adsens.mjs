// ===========================================================================
// AdSens by Zolo — marketing services, packages and the consultation pipeline.
//
// The public surface of this module is ONE function (`submitLead`) reachable
// without authentication, so it is written defensively:
//
//   * Pipeline fields are never taken from the request. status, assignedToId,
//     convertedUserId, leadNumber and source are set here; a visitor who posts
//     them is ignored.
//   * Services are validated against the database. A submitted slug that is
//     not a real active service is dropped rather than stored.
//   * Consent is required. Without it there is no lead, because the whole
//     point of the record is permission to call someone back.
//   * A near-duplicate submission returns the EXISTING lead instead of
//     creating a second one (§10 duplicate protection).
//
// Admin reads/writes are separate functions and assume requireAdmin upstream.
// ===========================================================================
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];
const CONTACT_METHODS = ["phone", "email", "whatsapp"];

/** ADS-xxxxxxxx. Random rather than a counter, matching ORD-/PAY-/QT-. */
const newLeadNumber = () => `ADS-${randomBytes(4).toString("hex").toUpperCase()}`;

const text = (v, max = 2000) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
/** Phone normalised to the last 10 digits, matching the User.phone convention. */
const normalizePhone = (raw) => {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------------------------------------------------------------------------
// Public reads — what /adsens renders
// ---------------------------------------------------------------------------

/** Active services and published packages for the public page. */
export async function publicCatalog() {
  const [services, packages] = await Promise.all([
    prisma.marketingService.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, summary: true, deliverables: true, icon: true },
    }),
    prisma.marketingPackage.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, slug: true, name: true, tagline: true, description: true,
        priceMinor: true, billingPeriod: true, deliverables: true, isFeatured: true,
        services: { select: { service: { select: { slug: true, name: true } } } },
      },
    }),
  ]);

  return {
    services,
    packages: packages.map((p) => ({
      ...p,
      services: p.services.map((s) => s.service),
    })),
  };
}

// ---------------------------------------------------------------------------
// Public write — the consultation form
// ---------------------------------------------------------------------------

/**
 * Create a consultation lead from the public page.
 *
 * Returns `{ lead, duplicate }`. `duplicate: true` means an identical-looking
 * enquiry arrived within the dedupe window and the earlier lead is returned —
 * the caller still reports success, because from the visitor's point of view
 * their request IS recorded.
 */
export async function submitLead(input = {}, { ip = null } = {}) {
  const fullName = text(input.fullName, 160);
  const email = text(input.email, 200)?.toLowerCase() ?? null;
  const phone = normalizePhone(input.phone);

  if (!fullName) throw badRequest("Tell us your name", "NAME_REQUIRED");
  if (!email || !EMAIL_RE.test(email)) throw badRequest("Enter a valid email address", "EMAIL_INVALID");
  if (!phone) throw badRequest("Enter a valid 10-digit phone number", "PHONE_INVALID");
  // Consent is the reason this record may exist at all.
  if (input.consent !== true) throw badRequest("Please agree to be contacted so we can respond", "CONSENT_REQUIRED");

  // Only real, active service slugs are stored — a posted slug is untrusted.
  const requested = Array.isArray(input.services) ? input.services.map((s) => String(s).trim()).filter(Boolean).slice(0, 20) : [];
  const known = requested.length
    ? await prisma.marketingService.findMany({ where: { slug: { in: requested }, isActive: true }, select: { slug: true } })
    : [];
  const services = known.map((s) => s.slug);

  // Likewise the package: a bogus id becomes null rather than a broken FK.
  let packageId = null;
  if (text(input.packageId, 60)) {
    const pkg = await prisma.marketingPackage.findFirst({
      where: { id: String(input.packageId), isPublished: true },
      select: { id: true },
    });
    packageId = pkg?.id ?? null;
  }

  const preferredContact = CONTACT_METHODS.includes(input.preferredContact) ? input.preferredContact : null;

  // Duplicate protection (§10): the same person re-submitting within 10
  // minutes gets their original lead back, so a double-click or a retry after
  // a flaky connection does not create two rows for the sales team to chase.
  const since = new Date(Date.now() - 10 * 60_000);
  const existing = await prisma.marketingLead.findFirst({
    where: { email, phone, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { lead: existing, duplicate: true };

  const lead = await prisma.$transaction(async (tx) => {
    const row = await tx.marketingLead.create({
      data: {
        leadNumber: newLeadNumber(),
        fullName,
        email,
        phone,
        companyName: text(input.companyName, 200),
        website: text(input.website, 300),
        industry: text(input.industry, 120),
        location: text(input.location, 200),
        services,
        budgetRange: text(input.budgetRange, 80),
        challenges: text(input.challenges, 2000),
        requirement: text(input.requirement, 4000),
        packageId,
        preferredContact,
        bestTimeToContact: text(input.bestTimeToContact, 120),
        consent: true,
        // Pipeline fields are OURS, never the request's.
        status: "NEW",
        source: "adsens_web",
      },
    });

    await tx.marketingLeadActivity.create({
      data: { leadId: row.id, kind: "note", body: "Consultation request received from the AdSens page.", toStatus: "NEW" },
    });

    await recordEvent({
      eventType: "marketing.lead.created",
      entityType: "MarketingLead",
      entityId: row.id,
      // `ip` is scrubbed of nothing sensitive beyond what events.mjs strips;
      // it is kept because spam triage needs it.
      metadata: { leadNumber: row.leadNumber, services, source: "adsens_web", ip },
    }, tx);

    return row;
  });

  return { lead, duplicate: false };
}

// ---------------------------------------------------------------------------
// Admin — leads
// ---------------------------------------------------------------------------

/** Paginated lead list with the counts the dashboard header shows. */
export async function listLeads(query = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const page = Math.max(1, Number(query.page) || 1);

  const where = {};
  if (LEAD_STATUSES.includes(query.status)) where.status = query.status;
  if (query.assignedToId) where.assignedToId = query.assignedToId;
  if (query.service) where.services = { has: String(query.service) };
  const q = text(query.q, 160);
  if (q) {
    const or = [
      { leadNumber: { contains: q, mode: "insensitive" } },
      { fullName: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
    // Only search phone when the term actually has digits. `contains: ""`
    // matches EVERY row, so a text search was returning the whole table.
    const digits = q.replace(/\D/g, "");
    if (digits) or.push({ phone: { contains: digits } });
    where.OR = or;
  }
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = new Date(query.from);
    if (query.to) where.createdAt.lte = new Date(query.to);
  }

  const [total, leads, byStatus] = await Promise.all([
    prisma.marketingLead.count({ where }),
    prisma.marketingLead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        package: { select: { id: true, name: true } },
      },
    }),
    prisma.marketingLead.groupBy({ by: ["status"], _count: true }),
  ]);

  return {
    leads,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
  };
}

/** One lead with its full activity history. */
export async function getLead(id) {
  const lead = await prisma.marketingLead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      convertedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      package: { select: { id: true, name: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

/**
 * Move a lead through the pipeline. Every change writes an activity row, so
 * the history explains itself without a separate audit lookup.
 */
export async function updateLead(adminId, id, input = {}) {
  const existing = await prisma.marketingLead.findUnique({ where: { id } });
  if (!existing) throw notFound("Lead not found");

  const data = {};
  const activities = [];

  if (input.status !== undefined) {
    if (!LEAD_STATUSES.includes(input.status)) throw badRequest(`Unknown lead status: ${input.status}`, "STATUS_INVALID");
    if (input.status === "LOST" && !text(input.lostReason, 500)) {
      throw badRequest("Say why the lead was lost so the pipeline stays honest", "LOST_REASON_REQUIRED");
    }
    if (input.status !== existing.status) {
      data.status = input.status;
      data.lostReason = input.status === "LOST" ? text(input.lostReason, 500) : null;
      activities.push({
        kind: "status_changed", fromStatus: existing.status, toStatus: input.status,
        body: input.status === "LOST" ? text(input.lostReason, 500) : null,
      });
    }
  }

  if (input.assignedToId !== undefined) {
    const assignee = input.assignedToId
      ? await prisma.user.findUnique({ where: { id: input.assignedToId }, select: { id: true, firstName: true, lastName: true } })
      : null;
    if (input.assignedToId && !assignee) throw badRequest("That team member does not exist", "ASSIGNEE_NOT_FOUND");
    data.assignedToId = assignee?.id ?? null;
    activities.push({
      kind: "assigned",
      body: assignee ? `Assigned to ${[assignee.firstName, assignee.lastName].filter(Boolean).join(" ")}` : "Unassigned",
    });
  }

  if (input.nextFollowUpAt !== undefined) {
    data.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
    activities.push({
      kind: "follow_up",
      body: data.nextFollowUpAt ? `Follow-up set for ${data.nextFollowUpAt.toISOString().slice(0, 10)}` : "Follow-up cleared",
    });
  }

  const note = text(input.note, 2000);
  if (note) activities.push({ kind: "note", body: note });

  if (Object.keys(data).length === 0 && activities.length === 0) return existing;

  return prisma.$transaction(async (tx) => {
    const lead = Object.keys(data).length ? await tx.marketingLead.update({ where: { id }, data }) : existing;
    for (const a of activities) {
      await tx.marketingLeadActivity.create({ data: { ...a, leadId: id, actorId: adminId } });
    }
    await recordEvent({
      eventType: "marketing.lead.updated",
      actorId: adminId,
      entityType: "MarketingLead",
      entityId: id,
      metadata: { leadNumber: existing.leadNumber, changed: Object.keys(data) },
    }, tx);
    return lead;
  });
}

/**
 * Link a WON lead to a customer account.
 *
 * Deliberately does NOT create a User: §15 says won leads must not duplicate
 * customer records. The admin picks an existing account (or matches one by
 * email), and the lead keeps its own history either way.
 */
export async function convertLead(adminId, id, { userId } = {}) {
  const lead = await prisma.marketingLead.findUnique({ where: { id } });
  if (!lead) throw notFound("Lead not found");
  if (lead.status !== "WON") throw badRequest("Mark the lead WON before converting it", "NOT_WON");

  // Prefer the explicit choice; otherwise match the lead's own email.
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    : await prisma.user.findUnique({ where: { email: lead.email }, select: { id: true, email: true } });
  if (!user) {
    throw badRequest(
      "No customer account matches this lead. Create the customer first, then link it — this never makes a duplicate record.",
      "CUSTOMER_NOT_FOUND",
    );
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.marketingLead.update({
      where: { id },
      data: { convertedUserId: user.id, convertedAt: new Date() },
    });
    await tx.marketingLeadActivity.create({
      data: { leadId: id, kind: "converted", body: `Linked to customer ${user.email}`, actorId: adminId },
    });
    await recordEvent({
      eventType: "marketing.lead.converted",
      actorId: adminId,
      entityType: "MarketingLead",
      entityId: id,
      metadata: { leadNumber: lead.leadNumber, userId: user.id },
    }, tx);
    return row;
  });
}

// ---------------------------------------------------------------------------
// Notifications (§18)
// ---------------------------------------------------------------------------

/**
 * Tell the admins a lead arrived, and acknowledge it to the visitor.
 *
 * `dispatch()` is NOT used for the visitor: it resolves a User by id, and an
 * AdSens lead is from an anonymous business with no account. We call the email
 * and WhatsApp providers directly, which record a NotificationDelivery row
 * each — SENT, FAILED, or SKIPPED with the real reason when a provider is not
 * configured. Nothing is ever reported as sent that was not.
 *
 * Never throws: a notification problem must not lose a lead that is already
 * safely in the database.
 */
export async function notifyNewLead(lead) {
  const out = { admin: null, email: null, whatsapp: null };
  const services = lead.services?.length ? lead.services.join(", ") : "Not specified";
  const who = lead.companyName ? `${lead.fullName} (${lead.companyName})` : lead.fullName;

  try {
    const { dispatchToAdmins } = await import("./notification-service.mjs");
    await dispatchToAdmins({
      type: "marketing.lead.created",
      title: `New AdSens enquiry — ${lead.leadNumber}`,
      body: `${who}\nServices: ${services}\nPhone: ${lead.phone}\nEmail: ${lead.email}`,
      entityType: "MarketingLead",
      entityId: lead.id,
    });
    out.admin = { status: "SENT" };
  } catch (e) {
    out.admin = { status: "FAILED", error: e?.message ?? "admin notification failed" };
  }

  try {
    const { sendMail, esc, wrap } = await import("./email.mjs");
    out.email = await sendMail({
      to: lead.email,
      subject: `We've received your enquiry — ${lead.leadNumber}`,
      text: `Thank you for contacting AdSens by Zolo!\n\nYour enquiry has been received successfully (reference ${lead.leadNumber}). Our team will review your requirements and contact you shortly.\n\nServices you asked about: ${services}`,
      html: wrap(
        "Thank you for contacting AdSens by Zolo",
        `<p>Hello ${esc(lead.fullName)},</p>
         <p>Your enquiry has been received successfully. Our team will review your requirements and contact you shortly.</p>
         <p><strong>Reference:</strong> ${esc(lead.leadNumber)}<br/>
            <strong>Services:</strong> ${esc(services)}</p>`,
      ),
      messageType: "MARKETING_LEAD_ACK",
      entityType: "MarketingLead",
      entityId: lead.id,
    });
  } catch (e) {
    out.email = { status: "FAILED", error: e?.message ?? "email failed" };
  }

  // WhatsApp only when the visitor chose it — an unsolicited message to a
  // number given for a callback is not what they consented to.
  if (lead.preferredContact === "whatsapp") {
    try {
      const { sendWhatsApp } = await import("./whatsapp.mjs");
      out.whatsapp = await sendWhatsApp({
        to: lead.phone,
        body: `Hello ${lead.fullName}, thank you for contacting AdSens by Zolo. Your enquiry ${lead.leadNumber} has been received and our team will contact you shortly.`,
        messageType: "MARKETING_LEAD_ACK",
        entityType: "MarketingLead",
        entityId: lead.id,
      });
    } catch (e) {
      out.whatsapp = { status: "FAILED", error: e?.message ?? "whatsapp failed" };
    }
  }

  return out;
}
