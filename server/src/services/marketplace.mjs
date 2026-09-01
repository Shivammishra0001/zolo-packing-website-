// Marketplace layer over the RFQ flow: auto-match an RFQ to sellers, let those
// sellers compete with versioned quotes, and carry a private negotiation
// thread per buyer/seller pair.
//
// This sits ALONGSIDE the admin-quotes path in rfq.mjs rather than replacing
// it — a house quote (supplierId null) and a seller quote are both Quotation
// rows, so accepting either converts to an order the same way.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.mjs";
import { recordEvent, notify } from "./events.mjs";
import { findEligibleSuppliers } from "./matching.mjs";
import { newQuotationNumber } from "../lib/commerce.mjs";

/**
 * Users to notify for a supplier. A SupplierProfile belongs to an
 * Organization, not to a single user, so its members are the recipients.
 */
async function supplierMemberIds(supplierId, tx = prisma) {
  const profile = await tx.supplierProfile.findUnique({
    where: { id: supplierId },
    select: { organizationId: true },
  });
  if (!profile) return [];
  const members = await tx.organizationMember.findMany({
    where: { organizationId: profile.organizationId },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** How many sellers an RFQ is offered to. */
export const MATCH_FANOUT = 5;

/**
 * Score eligible suppliers and invite the top N.
 *
 * The score and reasons are SNAPSHOT onto each RfqMatch so the shortlist stays
 * explainable months later, after capabilities have changed. Invitations are
 * idempotent: re-running skips suppliers already invited rather than
 * duplicating (the @@unique makes that a hard guarantee).
 */
export async function matchRfqToSuppliers(rfqId, { fanout = MATCH_FANOUT } = {}) {
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, include: { items: true } });
  if (!rfq) throw notFound("RFQ not found");

  // Score against the RFQ's largest line — the one that most constrains who
  // can actually make it.
  const biggest = [...rfq.items].sort((a, b) => b.quantity - a.quantity)[0];
  const criteria = {
    category: biggest?.specs?.category ?? undefined,
    quantity: biggest?.quantity,
    state: rfq.shipState ?? undefined,
  };

  const ranked = await findEligibleSuppliers(criteria);
  const top = ranked.slice(0, fanout);
  if (top.length === 0) return { matches: [], invited: 0 };

  const existing = await prisma.rfqMatch.findMany({ where: { rfqId }, select: { supplierId: true } });
  const already = new Set(existing.map((m) => m.supplierId));
  const fresh = top.filter(({ supplier }) => !already.has(supplier.id));

  if (fresh.length === 0) return { matches: existing, invited: 0 };

  const matches = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const { supplier, match } of fresh) {
      created.push(
        await tx.rfqMatch.create({
          data: { rfqId, supplierId: supplier.id, score: match.score, reasons: match.reasons },
        }),
      );
      // Notify the supplier's organisation members, not the profile.
      for (const userId of await supplierMemberIds(supplier.id, tx)) {
        await notify(
          {
            userId,
            type: "rfq.invited",
            title: "New quotation request",
            body: `${rfq.rfqNumber} — ${rfq.items.length} product${rfq.items.length === 1 ? "" : "s"}.`,
            entityType: "Rfq",
            entityId: rfqId,
          },
          tx,
        );
      }
    }
    await recordEvent(
      {
        eventType: "rfq.matched",
        entityType: "Rfq",
        entityId: rfqId,
        metadata: { rfqNumber: rfq.rfqNumber, invited: created.length },
      },
      tx,
    );
    return created;
  });

  return { matches, invited: matches.length };
}

/** A seller's lead inbox: the RFQs they were invited to. */
export async function listSellerLeads(supplierId, { status } = {}) {
  const matches = await prisma.rfqMatch.findMany({
    where: { supplierId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { rfq: { include: { items: true, files: true } } },
  });
  return matches.map((m) => ({
    matchId: m.id,
    status: m.status,
    score: m.score,
    // Surfacing the reasons tells the seller why they were shortlisted, which
    // is what makes a lead worth pricing.
    reasons: m.reasons,
    invitedAt: m.createdAt,
    rfq: {
      id: m.rfq.id,
      rfqNumber: m.rfq.rfqNumber,
      title: m.rfq.title,
      notes: m.rfq.notes,
      status: m.rfq.status,
      requiredBy: m.rfq.requiredBy,
      itemCount: m.rfq.items.length,
      totalQuantity: m.rfq.items.reduce((s, i) => s + i.quantity, 0),
      items: m.rfq.items,
      // Requirement sheets — downloadable via /sellers/rfqs/:rfqId/files/:fileId/download.
      files: m.rfq.files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, size: f.size })),
      ship: { city: m.rfq.shipCity, state: m.rfq.shipState },
    },
  }));
}

/** Seller opens a lead. Idempotent — only the first view stamps viewedAt. */
export async function markLeadViewed(supplierId, rfqId) {
  const match = await prisma.rfqMatch.findUnique({
    where: { rfqId_supplierId: { rfqId, supplierId } },
  });
  if (!match) return null;
  if (match.status !== "INVITED") return match;
  return prisma.rfqMatch.update({
    where: { id: match.id },
    data: { status: "VIEWED", viewedAt: new Date() },
  });
}

/** Seller passes on a lead, so the buyer is not left waiting on it. */
export async function declineLead(supplierId, rfqId) {
  const match = await prisma.rfqMatch.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } } });
  if (!match) return null;
  if (match.status === "QUOTED") throw conflict("You have already quoted this request", "ALREADY_QUOTED");
  return prisma.rfqMatch.update({
    where: { id: match.id },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
}

/**
 * A seller submits or revises a quote.
 *
 * Re-quoting UPDATES the live Quotation row and APPENDS a QuoteVersion, so the
 * negotiation ladder survives: the buyer can see that a price moved.
 *
 * supplierId comes from the caller's session, never from the request body —
 * otherwise a seller could quote as one of their rivals.
 */
export async function sellerSubmitQuote(supplierId, userId, rfqId, input) {
  const match = await prisma.rfqMatch.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId } } });
  if (!match) throw forbidden("You were not invited to quote this request", "NOT_INVITED");

  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, include: { items: true } });
  if (!rfq) throw notFound("RFQ not found");
  if (["ACCEPTED", "CANCELLED", "REJECTED"].includes(rfq.status)) {
    throw conflict(`This request is ${rfq.status.toLowerCase()}`, "RFQ_SETTLED");
  }

  const lines = buildQuoteLines(rfq, input.items);
  const totals = quoteTotals(lines, input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.quotation.findFirst({
      where: { rfqId, supplierId },
      orderBy: { version: "desc" },
    });
    const version = (existing?.version ?? 0) + 1;

    const data = {
      status: "SENT",
      sentAt: new Date(),
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      shippingMinor: totals.shippingMinor,
      grandTotalMinor: totals.grandTotalMinor,
      leadTimeDays: intOrNull(input.leadTimeDays),
      paymentTerms: input.paymentTerms ?? null,
      terms: input.terms ?? null,
      notes: input.notes ?? null,
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      version,
    };

    let quotation;
    if (existing) {
      // Replace the live lines, then re-create them for this version.
      await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
      quotation = await tx.quotation.update({
        where: { id: existing.id },
        data: { ...data, items: { create: lines } },
        include: { items: true },
      });
    } else {
      quotation = await tx.quotation.create({
        data: {
          ...data,
          quotationNumber: newQuotationNumber(),
          rfqId,
          supplierId,
          userId: rfq.userId,
          createdById: userId,
          items: { create: lines },
        },
        include: { items: true },
      });
    }

    // Append-only history.
    await tx.quoteVersion.create({
      data: {
        quotationId: quotation.id,
        version,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        shippingMinor: totals.shippingMinor,
        grandTotalMinor: totals.grandTotalMinor,
        leadTimeDays: data.leadTimeDays,
        paymentTerms: data.paymentTerms,
        notes: data.notes,
        items: lines,
        createdById: userId,
      },
    });

    await tx.rfqMatch.update({
      where: { id: match.id },
      data: { status: "QUOTED", respondedAt: new Date() },
    });
    if (rfq.status === "SUBMITTED" || rfq.status === "UNDER_REVIEW") {
      await tx.rfq.update({ where: { id: rfqId }, data: { status: "QUOTED" } });
    }

    await recordEvent(
      {
        eventType: "quotation.created",
        actorId: userId,
        entityType: "Quotation",
        entityId: quotation.id,
        metadata: { quotationNumber: quotation.quotationNumber, version, rfqNumber: rfq.rfqNumber },
      },
      tx,
    );
    await notify(
      {
        userId: rfq.userId,
        type: "quotation.received",
        title: version === 1 ? "New quotation received" : "A quotation was revised",
        body: `${quotation.quotationNumber} v${version} for ${rfq.rfqNumber}.`,
        entityType: "Quotation",
        entityId: quotation.id,
      },
      tx,
    );
    return quotation;
  });
}

/** Full negotiation ladder for one quotation. */
export async function quoteHistory(quotationId) {
  return prisma.quoteVersion.findMany({ where: { quotationId }, orderBy: { version: "asc" } });
}

// ---- Messaging -----------------------------------------------------------

/**
 * Post to the buyer<->seller thread for one RFQ.
 *
 * Access is decided here: the RFQ's owner, or a supplier invited to it. A
 * seller can only ever read and write their OWN thread, never a rival's.
 */
export async function postMessage(user, rfqId, { supplierId, body }) {
  const text = String(body ?? "").trim();
  if (!text) throw badRequest("Message cannot be empty", "EMPTY_MESSAGE");

  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { id: true, userId: true } });
  if (!rfq) throw notFound("RFQ not found");

  const thread = await resolveThread(user, rfq, supplierId);
  const message = await prisma.message.create({
    data: { rfqId, supplierId: thread.supplierId, senderId: user.id, body: text },
  });

  // Tell the other side.
  if (user.id === rfq.userId && thread.supplierUserId) {
    await notify({
      userId: thread.supplierUserId,
      type: "rfq.message",
      title: "New message from a buyer",
      body: text.slice(0, 120),
      entityType: "Rfq",
      entityId: rfqId,
    });
  } else if (user.id !== rfq.userId) {
    await notify({
      userId: rfq.userId,
      type: "rfq.message",
      title: "New message from a supplier",
      body: text.slice(0, 120),
      entityType: "Rfq",
      entityId: rfqId,
    });
  }
  return message;
}

export async function listMessages(user, rfqId, supplierId) {
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { id: true, userId: true } });
  if (!rfq) return null;
  const thread = await resolveThread(user, rfq, supplierId);
  return prisma.message.findMany({
    where: { rfqId, supplierId: thread.supplierId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Decide which thread the caller may use, and refuse anything else.
 * Buyers must name the supplier they are talking to; sellers are pinned to
 * their own thread regardless of what they ask for.
 */
async function resolveThread(user, rfq, requestedSupplierId) {
  const isBuyer = user.id === rfq.userId;

  if (isBuyer) {
    if (!requestedSupplierId) throw badRequest("Choose a supplier to message", "SUPPLIER_REQUIRED");
    const match = await prisma.rfqMatch.findUnique({
      where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: requestedSupplierId } },
    });
    if (!match) throw notFound("That supplier is not on this request");
    const [supplierUserId] = await supplierMemberIds(requestedSupplierId);
    return { supplierId: requestedSupplierId, supplierUserId: supplierUserId ?? null };
  }

  // Seller: pinned to their own thread, whatever they asked for.
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    select: { organizationId: true },
  });
  const own = membership
    ? await prisma.supplierProfile.findUnique({
        where: { organizationId: membership.organizationId },
        select: { id: true },
      })
    : null;
  if (!own) throw forbidden("No supplier profile for this account", "NOT_A_SELLER");
  const match = await prisma.rfqMatch.findUnique({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: own.id } },
  });
  if (!match) throw forbidden("You were not invited to this request", "NOT_INVITED");
  return { supplierId: own.id, supplierUserId: user.id };
}

// ---- Helpers -------------------------------------------------------------

const intOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function buildQuoteLines(rfq, items) {
  if (!Array.isArray(items) || items.length === 0) throw badRequest("A quote needs at least one line", "QUOTE_EMPTY");
  const byRfqItem = new Map(rfq.items.map((i) => [i.id, i]));
  return items.map((i) => {
    const src = i.rfqItemId ? byRfqItem.get(i.rfqItemId) : null;
    if (i.rfqItemId && !src) throw badRequest(`Unknown RFQ item: ${i.rfqItemId}`, "RFQ_ITEM_NOT_FOUND");
    const quantity = Number(i.quantity ?? src?.quantity);
    const unitPriceMinor = Number(i.unitPriceMinor);
    if (!Number.isInteger(quantity) || quantity <= 0) throw badRequest("Each line needs a positive whole quantity", "BAD_QUANTITY");
    if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) throw badRequest("Each line needs a unit price in paise", "BAD_PRICE");
    const discountMinor = Number(i.discountMinor) || 0;
    const taxMinor = Number(i.taxMinor) || 0;
    return {
      rfqItemId: i.rfqItemId ?? null,
      productId: i.productId ?? src?.productId ?? null,
      productName: i.productName ?? src?.productName ?? "Item",
      sku: i.sku ?? src?.sku ?? null,
      variant: src?.variant ?? null,
      specs: i.specs ?? src?.specs ?? {},
      quantity,
      unit: i.unit ?? src?.unit ?? "pcs",
      unitPriceMinor,
      discountMinor,
      taxMinor,
      // Server-computed; a client-supplied total is never trusted.
      lineTotalMinor: quantity * unitPriceMinor - discountMinor + taxMinor,
      notes: i.notes ?? null,
    };
  });
}

function quoteTotals(lines, input) {
  const subtotalMinor = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  const taxMinor = lines.reduce((s, l) => s + l.taxMinor, 0);
  const discountMinor = lines.reduce((s, l) => s + l.discountMinor, 0) + (Number(input.discountMinor) || 0);
  const shippingMinor = Number(input.shippingMinor) || 0;
  const grandTotalMinor = subtotalMinor - discountMinor + taxMinor + shippingMinor;
  if (grandTotalMinor < 0) throw badRequest("Discount exceeds the quote total", "DISCOUNT_TOO_LARGE");
  return { subtotalMinor, taxMinor, discountMinor, shippingMinor, grandTotalMinor };
}
