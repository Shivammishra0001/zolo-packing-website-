// RFQ -> Quotation -> Order.
//
// A buyer collects MULTIPLE products into ONE RFQ (RFQ-1001 may hold
// Product A x5000, B x10000, C x2000). Admin answers with a Quotation; the
// buyer accepts and it converts to an Order referencing both.
//
// Money is integer minor units (paise) throughout, matching orders.mjs.
// Product details are SNAPSHOT onto the line at write time: a catalogue rename
// or reprice must never retroactively alter what was quoted or agreed.
import { prisma } from "../lib/prisma.mjs";
// Use the SHARED error helpers: errorHandler tests `err instanceof HttpError`
// against this exact class, so a locally-declared duplicate would fail that
// check and surface every deliberate 400/404/409 as an opaque 500.
import { badRequest, notFound, conflict } from "../lib/http.mjs";
import { recordEvent, notify, notifyRoles } from "./events.mjs";
// Orders use the codebase's existing ORD-xxxx generator. Deriving a sequential
// number here instead collided with it on the @unique column (P2002).
import { newOrderNumber, newQuotationNumber } from "../lib/commerce.mjs";

// Sequential, human-readable numbers. Allocated inside the caller's
// transaction and derived from the current max so concurrent submits cannot
// collide on the @unique column.
async function nextNumber(tx, model, field, prefix, start) {
  const last = await tx[model].findFirst({
    where: { [field]: { startsWith: `${prefix}-` } },
    orderBy: { [field]: "desc" },
    select: { [field]: true },
  });
  const n = last ? Number(String(last[field]).replace(/\D/g, "")) : NaN;
  return `${prefix}-${(Number.isFinite(n) ? n : start - 1) + 1}`;
}

/** Buyer's own RFQs, newest first. */
export async function listMyRfqs(userId, { status } = {}) {
  const rfqs = await prisma.rfq.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      items: true,
      quotations: {
        where: { status: { not: "DRAFT" } }, // drafts are admin-only
        orderBy: { version: "desc" },
        include: { items: true },
      },
    },
  });
  return rfqs.map(shapeRfq);
}

/**
 * Create an RFQ with all of its lines in ONE transaction.
 *
 * `items` is the whole RFQ cart, so a three-product request is one RFQ with
 * three RfqItem rows — never three RFQs. A partial write here would strand an
 * RFQ with no lines, so the rows and the audit event share the transaction.
 */
export async function createRfq(userId, { items, title, notes, requiredBy, ship = {}, submit = true, autoMatch = true }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("An RFQ needs at least one product", "RFQ_EMPTY");
  }

  // Resolve every product first: an unknown id must fail the whole request
  // rather than silently dropping a line the buyer asked to be quoted.
  const ids = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  const products = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, sku: true } })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const id of ids) if (!byId.has(id)) throw badRequest(`Unknown product: ${id}`, "PRODUCT_NOT_FOUND");

  const lines = items.map((i) => {
    const qty = Number(i.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest("Each item needs a positive whole quantity", "BAD_QUANTITY");
    const p = i.productId ? byId.get(i.productId) : null;
    const name = (i.productName || p?.name || "").trim();
    if (!name) throw badRequest("Each item needs a product", "ITEM_NAME_REQUIRED");
    return {
      productId: i.productId ?? null,
      productName: name,
      sku: i.sku ?? p?.sku ?? null,
      variant: i.variant ?? null,
      specs: i.specs ?? {},
      quantity: qty,
      unit: i.unit || "pcs",
      targetPriceMinor: Number.isFinite(Number(i.targetPriceMinor)) ? Number(i.targetPriceMinor) : null,
      notes: i.notes ?? null,
    };
  });

  const created = await prisma.$transaction(async (tx) => {
    const rfqNumber = await nextNumber(tx, "rfq", "rfqNumber", "RFQ", 1001);
    const rfq = await tx.rfq.create({
      data: {
        rfqNumber,
        userId,
        status: submit ? "SUBMITTED" : "DRAFT",
        submittedAt: submit ? new Date() : null,
        title: title ?? null,
        notes: notes ?? null,
        requiredBy: requiredBy ? new Date(requiredBy) : null,
        shipCity: ship.city ?? null,
        shipState: ship.state ?? null,
        shipPostalCode: ship.postalCode ?? null,
        shipCountry: ship.country ?? "India",
        items: { create: lines },
      },
      include: { items: true, quotations: { include: { items: true } } },
    });

    if (submit) {
      await recordEvent(
        {
          eventType: "rfq.created",
          actorId: userId,
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: { rfqNumber: rfq.rfqNumber, itemCount: lines.length },
        },
        tx,
      );
      await notifyRoles(
        ["admin"],
        {
          type: "rfq.new",
          title: "New quotation request",
          body: `${rfq.rfqNumber} — ${lines.length} product${lines.length === 1 ? "" : "s"}.`,
          entityType: "Rfq",
          entityId: rfq.id,
        },
        tx,
      );
    }
    return rfq;
  });

  // Fan out to matching suppliers AFTER the RFQ is committed. A matching
  // failure must not roll back a valid RFQ — the buyer's request still stands
  // and admin can re-run matching.
  //
  // Callers can opt out (autoMatch: false) when they need an RFQ nobody else
  // quotes — a test asserting on an exact quotation count, for instance.
  if (submit && autoMatch) {
    try {
      const { matchRfqToSuppliers } = await import("./marketplace.mjs");
      await matchRfqToSuppliers(created.id);
    } catch (e) {
      console.error("[rfq] supplier matching failed:", e.message);
    }
  }

  return shapeRfq(created);
}

/** One RFQ the buyer owns. Returns null for someone else's — the route 404s. */
export async function getMyRfq(userId, id) {
  const rfq = await prisma.rfq.findFirst({
    where: { id, userId },
    include: {
      items: true,
      quotations: { where: { status: { not: "DRAFT" } }, orderBy: { version: "desc" }, include: { items: true } },
    },
  });
  return rfq ? shapeRfq(rfq) : null;
}

/** Buyer withdraws an RFQ that has not been settled. */
export async function cancelMyRfq(userId, id) {
  const rfq = await prisma.rfq.findFirst({ where: { id, userId }, select: { id: true, status: true, rfqNumber: true } });
  if (!rfq) return null;
  if (["ACCEPTED", "CANCELLED"].includes(rfq.status)) {
    throw conflict(`RFQ is already ${rfq.status.toLowerCase()}`, "RFQ_SETTLED");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.rfq.update({
      where: { id },
      data: { status: "CANCELLED", closedAt: new Date() },
      include: { items: true, quotations: { include: { items: true } } },
    });
    await recordEvent(
      { eventType: "rfq.cancelled", actorId: userId, entityType: "Rfq", entityId: id, metadata: { rfqNumber: rfq.rfqNumber } },
      tx,
    );
    return r;
  });
  return shapeRfq(updated);
}

// ---- Admin ---------------------------------------------------------------

/** Admin list with search + status filter. */
export async function adminListRfqs({ status, q, take = 50, skip = 0 } = {}) {
  const where = {
    // Drafts are the buyer's private RFQ cart — never surface them to admin.
    status: status ? status : { not: "DRAFT" },
    ...(q
      ? {
          OR: [
            { rfqNumber: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
            { items: { some: { productName: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.rfq.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(take) || 50, 200),
      skip: Number(skip) || 0,
      include: {
        items: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        quotations: { orderBy: { version: "desc" }, include: { items: true } },
      },
    }),
    prisma.rfq.count({ where }),
  ]);
  return { rfqs: rows.map(shapeRfq), total };
}

export async function adminGetRfq(id) {
  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: {
      items: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      quotations: { orderBy: { version: "desc" }, include: { items: true } },
    },
  });
  return rfq ? shapeRfq(rfq) : null;
}

/**
 * Admin prices an RFQ. Each revision is a NEW Quotation row with version+1, so
 * the negotiation history is preserved rather than overwritten.
 */
export async function adminCreateQuotation(adminId, rfqId, { items, leadTimeDays, paymentTerms, terms, notes, validUntil, shippingMinor = 0, discountMinor = 0, send = true }) {
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, include: { items: true } });
  if (!rfq) throw notFound("RFQ not found");
  if (["CANCELLED", "ACCEPTED"].includes(rfq.status)) {
    throw conflict(`Cannot quote an RFQ that is ${rfq.status.toLowerCase()}`, "RFQ_SETTLED");
  }
  if (!Array.isArray(items) || items.length === 0) throw badRequest("A quotation needs at least one line", "QUOTE_EMPTY");

  const byRfqItem = new Map(rfq.items.map((i) => [i.id, i]));
  const lines = items.map((i) => {
    const src = i.rfqItemId ? byRfqItem.get(i.rfqItemId) : null;
    if (i.rfqItemId && !src) throw badRequest(`Unknown RFQ item: ${i.rfqItemId}`, "RFQ_ITEM_NOT_FOUND");
    const qty = Number(i.quantity ?? src?.quantity);
    const unitPriceMinor = Number(i.unitPriceMinor);
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest("Each line needs a positive whole quantity", "BAD_QUANTITY");
    if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
      throw badRequest("Each line needs a unit price in paise", "BAD_PRICE");
    }
    const lineDiscount = Number(i.discountMinor) || 0;
    const lineTax = Number(i.taxMinor) || 0;
    return {
      rfqItemId: i.rfqItemId ?? null,
      productId: i.productId ?? src?.productId ?? null,
      productName: i.productName ?? src?.productName ?? "Item",
      sku: i.sku ?? src?.sku ?? null,
      variant: i.variant ?? src?.variant ?? null,
      specs: i.specs ?? src?.specs ?? {},
      quantity: qty,
      unit: i.unit ?? src?.unit ?? "pcs",
      unitPriceMinor,
      discountMinor: lineDiscount,
      taxMinor: lineTax,
      // Totals are computed server-side; a client-supplied total is never trusted.
      lineTotalMinor: qty * unitPriceMinor - lineDiscount + lineTax,
      notes: i.notes ?? null,
    };
  });

  const subtotalMinor = lines.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
  const taxMinor = lines.reduce((s, l) => s + l.taxMinor, 0);
  const lineDiscounts = lines.reduce((s, l) => s + l.discountMinor, 0);
  const totalDiscount = lineDiscounts + (Number(discountMinor) || 0);
  const ship = Number(shippingMinor) || 0;
  const grandTotalMinor = subtotalMinor - totalDiscount + taxMinor + ship;
  if (grandTotalMinor < 0) throw badRequest("Discount exceeds the quotation total", "DISCOUNT_TOO_LARGE");

  const created = await prisma.$transaction(async (tx) => {
    const prior = await tx.quotation.findFirst({ where: { rfqId }, orderBy: { version: "desc" }, select: { version: true } });
    const quotationNumber = newQuotationNumber();
    const quotation = await tx.quotation.create({
      data: {
        quotationNumber,
        rfqId,
        userId: rfq.userId,
        createdById: adminId,
        version: (prior?.version ?? 0) + 1,
        status: send ? "SENT" : "DRAFT",
        sentAt: send ? new Date() : null,
        subtotalMinor,
        discountMinor: totalDiscount,
        taxMinor,
        shippingMinor: ship,
        grandTotalMinor,
        leadTimeDays: Number.isFinite(Number(leadTimeDays)) ? Number(leadTimeDays) : null,
        paymentTerms: paymentTerms ?? null,
        terms: terms ?? null,
        notes: notes ?? null,
        validUntil: validUntil ? new Date(validUntil) : null,
        items: { create: lines },
      },
      include: { items: true },
    });

    if (send) {
      await tx.rfq.update({ where: { id: rfqId }, data: { status: "QUOTED" } });
      await recordEvent(
        {
          eventType: "quotation.created",
          actorId: adminId,
          entityType: "Quotation",
          entityId: quotation.id,
          metadata: { quotationNumber, rfqNumber: rfq.rfqNumber, version: quotation.version, grandTotalMinor },
        },
        tx,
      );
      await notify(
        {
          userId: rfq.userId,
          type: "quotation.received",
          title: "Your quotation is ready",
          body: `${quotationNumber} for ${rfq.rfqNumber}.`,
          entityType: "Quotation",
          entityId: quotation.id,
        },
        tx,
      );
    }
    return quotation;
  });

  return created;
}

/** Admin marks an RFQ as being worked on. */
export async function adminMarkUnderReview(adminId, rfqId) {
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { id: true, status: true } });
  if (!rfq) return null;
  if (rfq.status !== "SUBMITTED") return adminGetRfq(rfqId); // idempotent
  await prisma.rfq.update({ where: { id: rfqId }, data: { status: "UNDER_REVIEW" } });
  return adminGetRfq(rfqId);
}

// ---- Buyer responds ------------------------------------------------------

/**
 * Buyer accepts a quotation, which CONVERTS IT TO AN ORDER in one transaction.
 *
 * The order's prices come from the quotation, not the live catalogue — an
 * accepted price is a commitment, and re-reading the product here would let a
 * catalogue change silently alter what the buyer agreed to.
 */
export async function acceptQuotation(userId, quotationId) {
  const q = await prisma.quotation.findFirst({
    where: { id: quotationId, userId },
    include: { items: true, rfq: true },
  });
  if (!q) return null;
  if (q.status === "ACCEPTED") throw conflict("Quotation is already accepted", "ALREADY_ACCEPTED");
  if (q.status !== "SENT") throw conflict(`Cannot accept a ${q.status.toLowerCase()} quotation`, "NOT_ACCEPTABLE");
  if (q.validUntil && q.validUntil < new Date()) throw conflict("This quotation has expired", "QUOTE_EXPIRED");

  return prisma.$transaction(async (tx) => {
    const orderNumber = newOrderNumber();
    const order = await tx.order.create({
      data: {
        orderNumber,
        userId,
        rfqId: q.rfqId,
        quotationId: q.id,
        status: "PENDING",
        paymentStatus: "PENDING",
        subtotalMinor: q.subtotalMinor,
        discountMinor: q.discountMinor,
        taxMinor: q.taxMinor,
        shippingMinor: q.shippingMinor,
        grandTotalMinor: q.grandTotalMinor,
        currency: q.currency,
        paymentMethod: "bank_transfer", // negotiated B2B orders settle offline
        notes: `Converted from quotation ${q.quotationNumber}`,
        shipCity: q.rfq.shipCity,
        shipState: q.rfq.shipState,
        shipPostalCode: q.rfq.shipPostalCode,
        shipCountry: q.rfq.shipCountry,
        items: {
          create: q.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            variant: i.variant,
            specs: i.specs,
            quantity: i.quantity,
            unitPriceMinor: i.unitPriceMinor,
            discountMinor: i.discountMinor,
            taxMinor: i.taxMinor,
            lineTotalMinor: i.lineTotalMinor,
          })),
        },
      },
      include: { items: true },
    });

    await tx.quotation.update({ where: { id: q.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    // Sibling quotations for the same RFQ are now moot.
    await tx.quotation.updateMany({
      where: { rfqId: q.rfqId, id: { not: q.id }, status: "SENT" },
      data: { status: "WITHDRAWN" },
    });
    await tx.rfq.update({ where: { id: q.rfqId }, data: { status: "ACCEPTED", closedAt: new Date() } });

    await recordEvent(
      {
        eventType: "quotation.accepted",
        actorId: userId,
        entityType: "Quotation",
        entityId: q.id,
        metadata: { quotationNumber: q.quotationNumber, orderNumber, grandTotalMinor: q.grandTotalMinor },
      },
      tx,
    );
    await notifyRoles(
      ["admin"],
      {
        type: "quotation.accepted",
        title: "Quotation accepted",
        body: `${q.quotationNumber} accepted — order ${orderNumber} created.`,
        entityType: "Order",
        entityId: order.id,
      },
      tx,
    );
    return { quotation: { ...q, status: "ACCEPTED" }, order };
  });
}

/** Buyer rejects, or asks for a revision. */
export async function respondToQuotation(userId, quotationId, { action, message }) {
  if (!["reject", "request_changes"].includes(action)) throw badRequest("Unknown action", "BAD_ACTION");
  const q = await prisma.quotation.findFirst({ where: { id: quotationId, userId }, select: { id: true, status: true, rfqId: true, quotationNumber: true } });
  if (!q) return null;
  if (q.status !== "SENT") throw conflict(`Cannot respond to a ${q.status.toLowerCase()} quotation`, "NOT_ACTIONABLE");

  const status = action === "reject" ? "REJECTED" : "CHANGES_REQUESTED";
  return prisma.$transaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: q.id },
      data: { status, respondedAt: new Date(), buyerMessage: message ?? null },
      include: { items: true },
    });
    // A rejection closes the RFQ; a change request sends it back for revision.
    await tx.rfq.update({
      where: { id: q.rfqId },
      data: action === "reject" ? { status: "REJECTED", closedAt: new Date() } : { status: "UNDER_REVIEW" },
    });
    await recordEvent(
      {
        eventType: action === "reject" ? "quotation.rejected" : "quotation.changes_requested",
        actorId: userId,
        entityType: "Quotation",
        entityId: q.id,
        metadata: { quotationNumber: q.quotationNumber },
      },
      tx,
    );
    await notifyRoles(
      ["admin"],
      {
        type: "quotation.responded",
        title: action === "reject" ? "Quotation rejected" : "Changes requested",
        body: `${q.quotationNumber}${message ? `: ${message}` : ""}`,
        entityType: "Quotation",
        entityId: q.id,
      },
      tx,
    );
    return updated;
  });
}

// ---- Shaping -------------------------------------------------------------

// One consistent wire shape for both portals, so the admin table and the buyer
// list cannot drift apart.
function shapeRfq(r) {
  return {
    id: r.id,
    rfqNumber: r.rfqNumber,
    status: r.status,
    title: r.title,
    notes: r.notes,
    currency: r.currency,
    requiredBy: r.requiredBy,
    submittedAt: r.submittedAt,
    closedAt: r.closedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    itemCount: r.items?.length ?? 0,
    totalQuantity: (r.items ?? []).reduce((s, i) => s + i.quantity, 0),
    ship: { city: r.shipCity, state: r.shipState, postalCode: r.shipPostalCode, country: r.shipCountry },
    customer: r.user
      ? {
          id: r.user.id,
          email: r.user.email,
          name: [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") || r.user.email,
        }
      : undefined,
    items: (r.items ?? []).map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      variant: i.variant,
      specs: i.specs,
      quantity: i.quantity,
      unit: i.unit,
      targetPriceMinor: i.targetPriceMinor,
      notes: i.notes,
    })),
    quotations: (r.quotations ?? []).map((q) => ({
      id: q.id,
      quotationNumber: q.quotationNumber,
      version: q.version,
      status: q.status,
      subtotalMinor: q.subtotalMinor,
      discountMinor: q.discountMinor,
      taxMinor: q.taxMinor,
      shippingMinor: q.shippingMinor,
      grandTotalMinor: q.grandTotalMinor,
      currency: q.currency,
      leadTimeDays: q.leadTimeDays,
      paymentTerms: q.paymentTerms,
      terms: q.terms,
      notes: q.notes,
      buyerMessage: q.buyerMessage,
      validUntil: q.validUntil,
      sentAt: q.sentAt,
      respondedAt: q.respondedAt,
      items: (q.items ?? []).map((i) => ({
        id: i.id,
        rfqItemId: i.rfqItemId,
        productId: i.productId,
        productName: i.productName,
        sku: i.sku,
        quantity: i.quantity,
        unit: i.unit,
        unitPriceMinor: i.unitPriceMinor,
        discountMinor: i.discountMinor,
        taxMinor: i.taxMinor,
        lineTotalMinor: i.lineTotalMinor,
        notes: i.notes,
      })),
    })),
  };
}
