// ===========================================================================
// Admin CRM — customers, admin-raised orders, and the payment ledger.
//
// This module deliberately adds NO new customer/order/payment entities. The
// audit (docs/CRM-AUDIT.md) established that:
//   * `User` (role=buyer) IS the customer — it already carries company, gstin,
//     pan, businessType, alternatePhone, plus Address[], Order[] and the
//     notification preferences. The legacy `Customer` table has 0 rows and
//     every order has customerId = null, so it stays untouched.
//   * `Order` + `OrderItem` + `Payment` + `Refund` already model everything
//     the brief asks for; they only needed a due date, a payment kind and
//     custom line items (migration 20260926171246).
//
// The one rule this module enforces everywhere: money is DERIVED. `paidMinor`
// and `paymentStatus` are never set by a caller — they are recomputed from the
// Payment rows by `recomputeOrderPayment()` inside the same transaction.
// ===========================================================================
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, notFound } from "../lib/http.mjs";
import { newOrderNumber, newPaymentNumber } from "../lib/commerce.mjs";
import { recordEvent } from "./events.mjs";

/** Payment rows in these states count as money actually received. */
const PAID_STATUSES = new Set(["PAID", "SUCCESS"]);
const PAYMENT_KINDS = new Set(["ADVANCE", "PARTIAL", "FINAL", "ADJUSTMENT"]);
const PAYMENT_METHODS = new Set(["cash", "bank_transfer", "upi", "card", "cheque", "other"]);
const ORDER_SOURCES = new Set(["website", "admin", "whatsapp", "phone", "offline", "quote"]);

/**
 * Is this a real, contactable address — or the placeholder stored for a
 * customer who only gave a phone number?
 *
 * The ONE test for "can we email this person". Anything that sends mail must
 * check it, otherwise a walk-in customer's generated address becomes a
 * permanent bounce. `.invalid` is reserved by RFC 2606 precisely so it can
 * never resolve; the legacy import uses the same suffix.
 */
export const hasEmail = (email) =>
  Boolean(email) && !String(email).toLowerCase().endsWith(".invalid");

const digits = (s) => String(s ?? "").replace(/\D/g, "");
/** Phone stored normalised (last 10 digits) to match the User.phone convention. */
const normalizePhone = (raw) => {
  const d = digits(raw);
  return d.length >= 10 ? d.slice(-10) : d || null;
};

// ---------------------------------------------------------------------------
// Derived money — THE single source of truth for an order's payment position
// ---------------------------------------------------------------------------

/**
 * Recompute `paidMinor` + `paymentStatus` for one order from its payment rows.
 * Every code path that touches money must call this instead of assigning
 * `paidMinor` directly, otherwise the two figures drift apart (§13/§20).
 *
 * OVERDUE is intentionally NOT stored: it is a function of `dueDate` and the
 * clock, so storing it would be wrong the next morning. `derivePaymentState()`
 * computes it for reads.
 *
 * @param tx      a Prisma transaction client
 * @param orderId the order to restate
 */
export async function recomputeOrderPayment(tx, orderId) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound("Order not found");

  const rows = await tx.payment.findMany({ where: { orderId }, include: { refunds: true } });

  // Gross receipts: rows that represent money actually taken.
  const receivedMinor = rows.filter((p) => PAID_STATUSES.has(p.status)).reduce((s, p) => s + p.amountMinor, 0);

  // Refunds come from the Refund ledger, NOT from a payment row's status. A
  // PARTIAL refund leaves its payment row PAID (the original receipt is never
  // rewritten — §33), so counting only rows flipped to REFUNDED would miss
  // every partial refund and leave the order overstated as fully paid.
  const refundedMinor = rows.reduce(
    (s, p) => s + p.refunds.filter((r) => r.status === "processed").reduce((n, r) => n + r.amountMinor, 0),
    0,
  );
  // A payment row flipped wholly to REFUNDED is already excluded from
  // receivedMinor, so only subtract refunds recorded against rows that still
  // count, otherwise the same money is deducted twice.
  const refundedAgainstCounted = rows
    .filter((p) => PAID_STATUSES.has(p.status))
    .reduce((s, p) => s + p.refunds.filter((r) => r.status === "processed").reduce((n, r) => n + r.amountMinor, 0), 0);

  const paidMinor = Math.max(0, receivedMinor - refundedAgainstCounted);

  let paymentStatus = "PENDING";
  if (refundedMinor > 0 && paidMinor <= 0) paymentStatus = "REFUNDED";
  else if (refundedMinor > 0) paymentStatus = "PARTIALLY_REFUNDED";
  else if (paidMinor >= order.grandTotalMinor && order.grandTotalMinor > 0) paymentStatus = "PAID";
  else if (paidMinor > 0) paymentStatus = "PARTIAL";
  else if (rows.some((p) => p.status === "FAILED")) paymentStatus = "FAILED";

  await tx.order.update({ where: { id: orderId }, data: { paidMinor, paymentStatus } });

  // Keep the invoice in step when one exists.
  if ((await tx.invoice.count({ where: { orderId } })) > 0) {
    await tx.invoice.updateMany({ where: { orderId }, data: { status: paymentStatus === "PAID" ? "paid" : "issued" } });
  }

  return { paidMinor, pendingMinor: Math.max(0, order.grandTotalMinor - paidMinor), paymentStatus };
}

/**
 * Read-side payment state for one order, including OVERDUE — which is derived
 * from the due date at read time and never stored.
 */
export function derivePaymentState(order, now = new Date()) {
  const pendingMinor = Math.max(0, (order.grandTotalMinor ?? 0) - (order.paidMinor ?? 0));
  const overdue = pendingMinor > 0 && Boolean(order.dueDate) && new Date(order.dueDate) < now;
  return {
    pendingMinor,
    overdue,
    // The label the admin sees. OVERDUE outranks UNPAID/PARTIALLY_PAID because
    // it is the state that needs action.
    displayStatus: overdue
      ? "OVERDUE"
      : order.paymentStatus === "PARTIAL"
        ? "PARTIALLY_PAID"
        : order.paymentStatus === "PENDING"
          ? "UNPAID"
          : order.paymentStatus,
  };
}

// ---------------------------------------------------------------------------
// Customers (User rows, role=buyer)
// ---------------------------------------------------------------------------

/**
 * Create a customer from the admin side.
 *
 * A walk-in customer has no password: we store an unusable placeholder hash so
 * the row can never be logged into until the person runs the normal
 * reset-password flow. We never invent a password and never email one.
 */
export async function createCustomer(adminUser, input = {}) {
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const phone = normalizePhone(input.phone);

  if (!name) throw badRequest("Customer name is required", "NAME_REQUIRED");
  if (!phone || phone.length !== 10) throw badRequest("Enter a valid 10-digit phone number", "PHONE_INVALID");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw badRequest("Enter a valid email address", "EMAIL_INVALID");
  }

  // Email is OPTIONAL for an admin-created customer. Most walk-in trade
  // customers have only a phone number, and refusing the record until someone
  // invents an address is how three different screens each grew their own
  // placeholder convention.
  //
  // User.email is a required unique column, so a row still needs a value. The
  // placeholder is generated HERE, once, from the phone number (which is
  // already validated unique), rather than in each form:
  //   * .invalid is reserved by RFC 2606 and can never be deliverable, so no
  //     mail is ever sent to a real stranger;
  //   * hasEmail() below is the single test the rest of the system uses to
  //     decide whether a customer is contactable by email.
  const placeholder = !email;
  const storedEmail = email || `${phone}@no-email.zolopacking.invalid`;

  const [firstName, ...rest] = name.split(/\s+/);

  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email: storedEmail } })) {
      throw conflict(
        placeholder
          ? "A customer with this phone number already exists"
          : "A customer with this email already exists",
        placeholder ? "PHONE_TAKEN" : "EMAIL_TAKEN",
      );
    }
    if (await tx.user.findUnique({ where: { phone } })) {
      throw conflict("A customer with this phone number already exists", "PHONE_TAKEN");
    }

    const user = await tx.user.create({
      data: {
        email: storedEmail,
        phone,
        firstName,
        lastName: rest.join(" ") || null,
        // Deliberately unusable: bcrypt never produces this, so no password
        // matches it. The customer sets one via the normal reset flow.
        passwordHash: "!admin-created:no-login",
        role: "buyer",
        company: input.company?.trim() || null,
        gstin: input.gstin?.trim()?.toUpperCase() || null,
        alternatePhone: normalizePhone(input.alternatePhone),
        businessType: input.customerType === "business" ? "business" : input.customerType === "individual" ? "individual" : null,
      },
    });

    // Optional billing/shipping address in the same transaction, so an admin
    // can create a customer who is immediately orderable.
    const a = input.address ?? {};
    if (a.line1?.trim()) {
      await tx.address.create({
        data: {
          userId: user.id,
          kind: "shipping",
          name,
          phone,
          line1: a.line1.trim(),
          line2: a.line2?.trim() || null,
          city: a.city?.trim() || "",
          state: a.state?.trim() || "",
          postalCode: a.postalCode?.trim() || "",
          country: a.country?.trim() || "India",
          isDefault: true,
        },
      });
    }

    await recordEvent(
      {
        eventType: "customer.created",
        actorId: adminUser.id,
        entityType: "User",
        entityId: user.id,
        metadata: { email, company: user.company, createdBy: "admin" },
      },
      tx,
    );

    return user;
  });
}

/** Update an admin-editable subset of a customer's profile. */
export async function updateCustomer(adminUser, userId, input = {}) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw notFound("Customer not found");

  const data = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw badRequest("Customer name cannot be empty", "NAME_REQUIRED");
    const [firstName, ...rest] = name.split(/\s+/);
    data.firstName = firstName;
    data.lastName = rest.join(" ") || null;
  }
  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Enter a valid email address", "EMAIL_INVALID");
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== userId) throw conflict("Another customer already uses this email", "EMAIL_TAKEN");
    data.email = email;
  }
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!phone || phone.length !== 10) throw badRequest("Enter a valid 10-digit phone number", "PHONE_INVALID");
    const clash = await prisma.user.findUnique({ where: { phone } });
    if (clash && clash.id !== userId) throw conflict("Another customer already uses this phone number", "PHONE_TAKEN");
    data.phone = phone;
  }
  for (const [key, val] of Object.entries({
    company: input.company,
    gstin: input.gstin?.toUpperCase?.(),
    pan: input.pan?.toUpperCase?.(),
    website: input.website,
    industry: input.industry,
  })) {
    if (val !== undefined) data[key] = String(val).trim() || null;
  }
  if (input.alternatePhone !== undefined) data.alternatePhone = normalizePhone(input.alternatePhone);

  // Account manager. "" / null clears it, so an account can be unassigned as
  // well as handed over. Validated against the role rather than trusted from
  // the client: assigning a customer to a buyer would silently corrupt every
  // sales report that groups by this column.
  if (input.salespersonId !== undefined) {
    const target = String(input.salespersonId ?? "").trim();
    if (!target) {
      data.capturedById = null;
    } else {
      const rep = await prisma.user.findUnique({ where: { id: target }, select: { id: true, role: true } });
      if (!rep) throw notFound("Sales person not found");
      if (rep.role !== "salesperson" && rep.role !== "admin") {
        throw badRequest("That user is not a sales person", "NOT_A_SALESPERSON");
      }
      data.capturedById = rep.id;
    }
  }
  if (input.customerType !== undefined) data.businessType = input.customerType || null;
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data });
    await recordEvent(
      {
        eventType: "customer.updated",
        actorId: adminUser.id,
        entityType: "User",
        entityId: userId,
        metadata: { fields: Object.keys(data) },
      },
      tx,
    );
    return user;
  });
}

// ---------------------------------------------------------------------------
// Admin-raised orders
// ---------------------------------------------------------------------------

/**
 * Build priced order items from admin input.
 *
 * Two kinds of line are supported:
 *   catalog  — { productId, quantity, unitPriceMinor? }  price defaults to the
 *              product's current price but the admin MAY override it (B2B
 *              negotiated pricing is the norm here).
 *   custom   — { itemName, quantity, unitPriceMinor }    no catalog product;
 *              this is how custom packaging jobs are ordered.
 *
 * Every line is snapshotted (name/sku/specs), matching how checkout freezes
 * items so later catalog edits never restate an old order.
 */
async function buildAdminItems(tx, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw badRequest("Add at least one item to the order", "ITEMS_REQUIRED");
  }

  const productIds = rawItems.map((i) => i.productId).filter(Boolean);
  const products = productIds.length
    ? await tx.product.findMany({ where: { id: { in: productIds } } })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  return rawItems.map((raw, idx) => {
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest(`Item ${idx + 1}: quantity must be a whole number of 1 or more`, "QUANTITY_INVALID");
    }

    const discountMinor = Math.max(0, Math.round(Number(raw.discountMinor ?? 0)));
    const taxMinor = Math.max(0, Math.round(Number(raw.taxMinor ?? 0)));

    let productId = null;
    let productName;
    let sku = null;
    let unitPriceMinor;
    // Cost SNAPSHOT. Null when unknown — never 0, which would claim the line
    // was free and report the whole sale as profit.
    let unitCostMinor = null;

    if (raw.productId) {
      const product = byId.get(raw.productId);
      if (!product) throw badRequest(`Item ${idx + 1}: product not found`, "PRODUCT_NOT_FOUND");
      productId = product.id;
      productName = product.name;
      sku = product.sku;
      // Frozen here so a later cost edit cannot restate this order's margin.
      unitCostMinor = product.costMinor ?? null;
      unitPriceMinor = raw.unitPriceMinor === undefined || raw.unitPriceMinor === null
        ? Math.round(product.basePrice * 100)
        : Math.round(Number(raw.unitPriceMinor));
    } else {
      productName = String(raw.itemName ?? "").trim();
      if (!productName) throw badRequest(`Item ${idx + 1}: choose a product or enter an item name`, "ITEM_NAME_REQUIRED");
      sku = raw.sku?.trim() || null;
      unitPriceMinor = Math.round(Number(raw.unitPriceMinor));
      // A bespoke job has no catalog cost, so the admin may state one.
      if (raw.unitCostMinor !== undefined && raw.unitCostMinor !== null && raw.unitCostMinor !== "") {
        const c = Math.round(Number(raw.unitCostMinor));
        if (Number.isFinite(c) && c >= 0) unitCostMinor = c;
      }
    }

    if (!Number.isFinite(unitPriceMinor) || unitPriceMinor < 0) {
      throw badRequest(`Item ${idx + 1}: enter a valid unit price`, "PRICE_INVALID");
    }

    const lineTotalMinor = Math.max(0, unitPriceMinor * quantity - discountMinor) + taxMinor;

    return {
      productId,
      productName,
      sku,
      variant: raw.variant?.trim() || null,
      specs: raw.specs ?? {},
      quantity,
      unitPriceMinor,
      unitCostMinor,
      discountMinor,
      taxMinor,
      lineTotalMinor,
      isCustomItem: !productId,
      description: raw.description?.trim() || null,
    };
  });
}

/**
 * Create an order on a customer's behalf, optionally with an advance payment
 * recorded in the same transaction.
 *
 * This does NOT reuse `placeOrder()`: that path reads the *buyer's own cart*
 * and requires an Address the buyer owns, neither of which applies when an
 * admin raises an order over the phone. The item snapshot and money rules are
 * kept identical so both kinds of order behave the same downstream.
 */
export async function createOrder(adminUser, input = {}) {
  const customerId = String(input.customerId ?? "");
  if (!customerId) throw badRequest("Choose a customer", "CUSTOMER_REQUIRED");

  const source = ORDER_SOURCES.has(input.source) ? input.source : "admin";

  return prisma.$transaction(async (tx) => {
    const customer = await tx.user.findUnique({
      where: { id: customerId },
      include: { addresses: { where: { isDefault: true }, take: 1 } },
    });
    if (!customer) throw notFound("Customer not found");

    const items = await buildAdminItems(tx, input.items);

    // Order-level money. Item-level discount/tax are already inside
    // lineTotalMinor; these are the additional order-wide figures.
    const subtotalMinor = items.reduce((s, i) => s + i.unitPriceMinor * i.quantity, 0);
    const itemDiscountMinor = items.reduce((s, i) => s + i.discountMinor, 0);
    const itemTaxMinor = items.reduce((s, i) => s + i.taxMinor, 0);
    const orderDiscountMinor = Math.max(0, Math.round(Number(input.discountMinor ?? 0)));
    const orderTaxMinor = Math.max(0, Math.round(Number(input.taxMinor ?? 0)));
    const shippingMinor = Math.max(0, Math.round(Number(input.shippingMinor ?? 0)));

    const discountMinor = itemDiscountMinor + orderDiscountMinor;
    const taxMinor = itemTaxMinor + orderTaxMinor;
    const grandTotalMinor = Math.max(0, subtotalMinor - discountMinor) + taxMinor + shippingMinor;

    if (grandTotalMinor <= 0) throw badRequest("Order total must be greater than zero", "TOTAL_INVALID");

    // Address snapshot — frozen onto the order, exactly like checkout, so
    // later edits to the address book never rewrite history.
    const addr = input.shippingAddress ?? customer.addresses[0] ?? null;

    const order = await tx.order.create({
      data: {
        orderNumber: newOrderNumber(),
        userId: customer.id,
        status: input.status && input.status === "DRAFT" ? "PENDING" : (input.status ?? "CONFIRMED"),
        // paidMinor / paymentStatus are DERIVED below — never set here.
        subtotalMinor,
        discountMinor,
        taxMinor,
        shippingMinor,
        grandTotalMinor,
        paymentMethod: input.paymentMethod ?? "bank_transfer",
        notes: input.notes?.trim() || null,
        source,
        createdById: adminUser.id,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
        customerEmail: customer.email,
        shipName: addr?.name ?? [customer.firstName, customer.lastName].filter(Boolean).join(" "),
        shipPhone: addr?.phone ?? customer.phone,
        shipLine1: addr?.line1 ?? null,
        shipLine2: addr?.line2 ?? null,
        shipCity: addr?.city ?? null,
        shipState: addr?.state ?? null,
        shipPostalCode: addr?.postalCode ?? null,
        shipCountry: addr?.country ?? "India",
        items: { create: items },
      },
      include: { items: true },
    });

    await tx.orderStatusHistory.create({
      data: { orderId: order.id, status: order.status, note: "Order created by admin", actorId: adminUser.id },
    });

    // Optional advance, recorded as a real Payment row (never an ad-hoc
    // paidMinor write), so the ledger is complete from the first rupee.
    if (Number(input.advanceMinor) > 0) {
      await addPaymentInTx(tx, adminUser, order.id, {
        amountMinor: input.advanceMinor,
        method: input.advanceMethod ?? "cash",
        kind: "ADVANCE",
        reference: input.advanceReference,
        notes: input.advanceNotes,
        paidAt: input.advancePaidAt,
      });
    }

    await recomputeOrderPayment(tx, order.id);

    await recordEvent(
      {
        eventType: "order.created",
        actorId: adminUser.id,
        entityType: "Order",
        entityId: order.id,
        metadata: {
          orderNumber: order.orderNumber,
          customerId: customer.id,
          grandTotalMinor,
          itemCount: items.length,
          source,
          advanceMinor: Number(input.advanceMinor) || 0,
        },
      },
      tx,
    );

    return tx.order.findUnique({
      where: { id: order.id },
      include: { items: true, payments: { orderBy: { createdAt: "asc" } } },
    });
  });
}

// ---------------------------------------------------------------------------
// Payment ledger
// ---------------------------------------------------------------------------

/**
 * Append one payment to an order, inside an existing transaction.
 *
 * Validation (§32): no zero/negative amounts, no payment beyond the
 * outstanding balance unless `allowOverpayment`, and no duplicate transaction
 * reference for the same order.
 */
async function addPaymentInTx(tx, adminUser, orderId, input = {}) {
  // LOCK THE ORDER ROW FIRST.
  //
  // Without this, two concurrent requests both read the same outstanding
  // balance, both pass the overpayment check below, and both insert. Verified
  // reproducible: two simultaneous full payments on a 1,000 order recorded
  // 2,000 paid and still reported PAID. An admin double-clicking "Mark full
  // payment" is enough to trigger it.
  //
  // SELECT ... FOR UPDATE makes the second transaction wait here until the
  // first commits, so it then reads the balance the first one left behind and
  // is correctly refused. Raw SQL because Prisma has no row-lock API.
  const locked = await tx.$queryRawUnsafe(
    `SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`,
    orderId,
  );
  if (locked.length === 0) throw notFound("Order not found");

  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound("Order not found");

  const amountMinor = Math.round(Number(input.amountMinor));
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw badRequest("Enter a payment amount greater than zero", "AMOUNT_INVALID");
  }

  const method = String(input.method ?? "cash");
  if (!PAYMENT_METHODS.has(method)) throw badRequest(`Unknown payment method: ${method}`, "METHOD_INVALID");

  const kind = PAYMENT_KINDS.has(input.kind) ? input.kind : "PARTIAL";

  // Outstanding is derived from the existing rows, not from order.paidMinor,
  // so a stale cached figure can never authorise an overpayment.
  const existing = await tx.payment.findMany({ where: { orderId } });
  const paidMinor = existing.filter((p) => PAID_STATUSES.has(p.status)).reduce((s, p) => s + p.amountMinor, 0);
  const outstandingMinor = order.grandTotalMinor - paidMinor;

  if (!input.allowOverpayment && amountMinor > outstandingMinor) {
    throw badRequest(
      `Payment exceeds the outstanding balance of ₹${(outstandingMinor / 100).toLocaleString("en-IN")}`,
      "OVERPAYMENT",
    );
  }

  const reference = input.reference?.trim() || null;
  if (reference && existing.some((p) => p.reference && p.reference.toLowerCase() === reference.toLowerCase())) {
    throw conflict("This transaction reference is already recorded on this order", "REFERENCE_DUPLICATE");
  }

  // An admin recording a receipt is recording money already in hand, so the
  // row is created settled. Gateway flows still create PENDING rows elsewhere.
  const status = input.status === "PENDING" ? "PENDING" : "PAID";

  const payment = await tx.payment.create({
    data: {
      paymentNumber: newPaymentNumber(),
      orderId,
      method,
      amountMinor,
      status,
      kind,
      reference,
      notes: input.notes?.trim() || null,
      receivedById: adminUser.id,
      proofUrl: input.proofUrl?.trim() || null,
      paidAt: status === "PAID" ? (input.paidAt ? new Date(input.paidAt) : new Date()) : null,
    },
  });

  await recordEvent(
    {
      eventType: "payment.recorded",
      actorId: adminUser.id,
      entityType: "Payment",
      entityId: payment.id,
      metadata: { orderId, orderNumber: order.orderNumber, amountMinor, method, kind, reference },
    },
    tx,
  );

  return payment;
}

/**
 * Record a payment against an order (the "Record Payment" modal).
 * Atomically: create the payment → restate the order → write the audit event.
 */
export async function addPayment(adminUser, orderId, input = {}) {
  return prisma.$transaction(async (tx) => {
    const payment = await addPaymentInTx(tx, adminUser, orderId, input);
    const totals = await recomputeOrderPayment(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: "asc" } } },
    });
    return { payment, order, totals };
  });
}

/**
 * Refund part or all of a payment.
 *
 * The original Payment row is NEVER deleted or reduced (§33): a `Refund` row
 * is appended, and the payment is marked REFUNDED only when the whole amount
 * has been returned, so history stays auditable.
 */
export async function refundPayment(adminUser, paymentId, input = {}) {
  const amountMinor = Math.round(Number(input.amountMinor));
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw badRequest("Enter a refund amount greater than zero", "AMOUNT_INVALID");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: true, order: true },
    });
    if (!payment) throw notFound("Payment not found");
    if (!PAID_STATUSES.has(payment.status) && payment.status !== "PARTIALLY_REFUNDED") {
      throw badRequest("Only a settled payment can be refunded", "NOT_REFUNDABLE");
    }

    const alreadyRefunded = payment.refunds
      .filter((r) => r.status === "processed")
      .reduce((s, r) => s + r.amountMinor, 0);
    if (amountMinor > payment.amountMinor - alreadyRefunded) {
      throw badRequest("Refund exceeds the remaining refundable amount", "REFUND_TOO_LARGE");
    }

    const refund = await tx.refund.create({
      data: {
        refundNumber: `REF-${newPaymentNumber().slice(4)}`,
        paymentId,
        amountMinor,
        reason: input.reason?.trim() || null,
        status: "processed",
        reference: input.reference?.trim() || null,
        processedById: adminUser.id,
        processedAt: new Date(),
      },
    });

    // Fully refunded → the payment stops counting as money received.
    const totalRefunded = alreadyRefunded + amountMinor;
    if (totalRefunded >= payment.amountMinor) {
      await tx.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED" } });
    }

    const totals = await recomputeOrderPayment(tx, payment.orderId);

    await recordEvent(
      {
        eventType: "payment.refunded",
        actorId: adminUser.id,
        entityType: "Refund",
        entityId: refund.id,
        metadata: {
          paymentId,
          orderNumber: payment.order.orderNumber,
          amountMinor,
          fullyRefunded: totalRefunded >= payment.amountMinor,
        },
      },
      tx,
    );

    return { refund, totals };
  });
}

// ---------------------------------------------------------------------------
// Reads — all server-side paginated and aggregated (§6/§38/§39/§56)
// ---------------------------------------------------------------------------

const PAGE_DEFAULT = 25;
const PAGE_MAX = 100;

const paging = (q = {}) => {
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(q.limit) || PAGE_DEFAULT));
  const page = Math.max(1, Number(q.page) || 1);
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Customer list with per-customer order/payment totals.
 *
 * Totals come from two grouped aggregates over Order (one query each), not
 * from a stored column and not from N queries per row — so the figures can
 * never drift and the page cost does not grow with the customer count (§20).
 */
export async function listCustomers(query = {}) {
  const { page, limit, skip } = paging(query);
  const q = String(query.q ?? "").trim();

  const where = { role: "buyer" };
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { phone: { contains: digits(q) || q } },
      { id: q },
    ];
  }
  if (query.status === "active") where.isActive = true;
  if (query.status === "inactive") where.isActive = false;
  if (query.customerType) where.businessType = query.customerType;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      // The rep who owns this account. Written when a rep captures a customer
      // in the field, and assignable by an admin — previously stored and then
      // never read anywhere, so the business could not see who owned an
      // account or hand one over.
      include: { capturedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
  ]);

  const ids = users.map((u) => u.id);
  const [totals, lastOrders] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { not: "CANCELLED" } },
          _count: { _all: true },
          _sum: { grandTotalMinor: true, paidMinor: true },
        }),
        prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids } },
          _max: { placedAt: true },
        }),
      ])
    : [[], []];

  const byUser = new Map(totals.map((t) => [t.userId, t]));
  const lastByUser = new Map(lastOrders.map((t) => [t.userId, t._max.placedAt]));

  // Overdue is time-dependent, so it is counted live rather than stored.
  const overdue = ids.length
    ? await prisma.order.groupBy({
        by: ["userId"],
        where: { userId: { in: ids }, dueDate: { lt: new Date() }, status: { not: "CANCELLED" } },
        _sum: { grandTotalMinor: true, paidMinor: true },
      })
    : [];
  const overdueByUser = new Map(
    overdue.map((o) => [o.userId, Math.max(0, (o._sum.grandTotalMinor ?? 0) - (o._sum.paidMinor ?? 0))]),
  );

  const customers = users.map((u) => {
    const t = byUser.get(u.id);
    const orderValueMinor = t?._sum.grandTotalMinor ?? 0;
    const paidMinor = t?._sum.paidMinor ?? 0;
    const pendingMinor = Math.max(0, orderValueMinor - paidMinor);
    const overdueMinor = overdueByUser.get(u.id) ?? 0;
    return {
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" "),
      email: u.email,
      phone: u.phone,
      company: u.company,
      customerType: u.businessType,
      gstin: u.gstin,
      isActive: u.isActive,
      createdAt: u.createdAt,
      salesperson: u.capturedBy
        ? {
            id: u.capturedBy.id,
            name:
              [u.capturedBy.firstName, u.capturedBy.lastName].filter(Boolean).join(" ") ||
              u.capturedBy.email,
          }
        : null,
      orderCount: t?._count._all ?? 0,
      orderValueMinor,
      paidMinor,
      pendingMinor,
      overdueMinor,
      lastOrderAt: lastByUser.get(u.id) ?? null,
      // Derived, never admin-set (§49).
      financialStatus: overdueMinor > 0 ? "OVERDUE" : pendingMinor > 0 ? "PENDING" : "CLEAR",
    };
  });

  // These two filters depend on derived figures, so they are applied after
  // aggregation. They narrow the current page rather than the whole table —
  // documented as such in the API so the UI does not imply otherwise.
  const filtered = query.hasPending === "1"
    ? customers.filter((c) => c.pendingMinor > 0)
    : query.hasOverdue === "1"
      ? customers.filter((c) => c.overdueMinor > 0)
      : customers;

  return { customers: filtered, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Business-wide receivables snapshot for the payments dashboard (§21/§37). */
export async function paymentSummary() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const live = { status: { not: "CANCELLED" } };

  const [all, overdue, todayAgg, monthAgg, partialCount, paidCount] = await Promise.all([
    prisma.order.aggregate({ where: live, _sum: { grandTotalMinor: true, paidMinor: true }, _count: { _all: true } }),
    prisma.order.aggregate({ where: { ...live, dueDate: { lt: now } }, _sum: { grandTotalMinor: true, paidMinor: true } }),
    prisma.payment.aggregate({ where: { status: { in: ["PAID", "SUCCESS"] }, paidAt: { gte: startOfToday } }, _sum: { amountMinor: true } }),
    prisma.payment.aggregate({ where: { status: { in: ["PAID", "SUCCESS"] }, paidAt: { gte: startOfMonth } }, _sum: { amountMinor: true } }),
    prisma.order.count({ where: { ...live, paymentStatus: "PARTIAL" } }),
    prisma.order.count({ where: { ...live, paymentStatus: "PAID" } }),
  ]);

  const totalValue = all._sum.grandTotalMinor ?? 0;
  const totalPaid = all._sum.paidMinor ?? 0;

  return {
    orderCount: all._count._all,
    totalValueMinor: totalValue,
    receivedMinor: totalPaid,
    pendingMinor: Math.max(0, totalValue - totalPaid),
    overdueMinor: Math.max(0, (overdue._sum.grandTotalMinor ?? 0) - (overdue._sum.paidMinor ?? 0)),
    collectedTodayMinor: todayAgg._sum.amountMinor ?? 0,
    collectedThisMonthMinor: monthAgg._sum.amountMinor ?? 0,
    partiallyPaidOrders: partialCount,
    paidOrders: paidCount,
  };
}

/** Payment transactions, newest first, with order + customer context (§21). */
export async function listPayments(query = {}) {
  const { page, limit, skip } = paging(query);
  const where = {};
  if (query.status) where.status = query.status;
  if (query.method) where.method = query.method;
  const q = String(query.q ?? "").trim();
  if (q) {
    where.OR = [
      { paymentNumber: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { order: { orderNumber: { contains: q, mode: "insensitive" } } },
      { order: { user: { email: { contains: q, mode: "insensitive" } } } },
      { order: { user: { firstName: { contains: q, mode: "insensitive" } } } },
      { order: { user: { company: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        order: { select: { id: true, orderNumber: true, user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } } } },
        receivedBy: { select: { id: true, firstName: true, lastName: true } },
        refunds: { select: { amountMinor: true, status: true } },
      },
    }),
  ]);

  return {
    payments: rows.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      orderId: p.order?.id ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      customerId: p.order?.user?.id ?? null,
      customerName: p.order?.user
        ? p.order.user.company || [p.order.user.firstName, p.order.user.lastName].filter(Boolean).join(" ")
        : null,
      amountMinor: p.amountMinor,
      refundedMinor: p.refunds.filter((r) => r.status === "processed").reduce((s, r) => s + r.amountMinor, 0),
      method: p.method,
      kind: p.kind,
      status: p.status,
      reference: p.reference,
      notes: p.notes,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      receivedBy: p.receivedBy ? [p.receivedBy.firstName, p.receivedBy.lastName].filter(Boolean).join(" ") : null,
    })),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Orders with an outstanding balance, for the dues/overdue views (§25/§50).
 * `bucket`: overdue | today | week | month | all
 */
export async function listOutstanding(query = {}) {
  const { page, limit, skip } = paging(query);
  const now = new Date();
  const endOf = (days) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 59, 999);
    return d;
  };

  const where = { status: { not: "CANCELLED" }, paymentStatus: { in: ["PENDING", "PARTIAL", "FAILED"] } };
  switch (query.bucket) {
    case "overdue": where.dueDate = { lt: now }; break;
    case "today": where.dueDate = { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), lte: endOf(0) }; break;
    case "week": where.dueDate = { gte: now, lte: endOf(7) }; break;
    case "month": where.dueDate = { gte: now, lte: endOf(30) }; break;
    default: break;
  }

  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { placedAt: "desc" }],
      skip,
      take: limit,
      include: { user: { select: { id: true, firstName: true, lastName: true, company: true, email: true, phone: true } } },
    }),
  ]);

  const MS_DAY = 86_400_000;
  return {
    orders: rows.map((o) => {
      const state = derivePaymentState(o, now);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerId: o.user.id,
        customerName: o.user.company || [o.user.firstName, o.user.lastName].filter(Boolean).join(" "),
        customerEmail: o.user.email,
        customerPhone: o.user.phone,
        grandTotalMinor: o.grandTotalMinor,
        paidMinor: o.paidMinor,
        pendingMinor: state.pendingMinor,
        paymentStatus: state.displayStatus,
        dueDate: o.dueDate,
        daysOverdue: state.overdue ? Math.floor((now - new Date(o.dueDate)) / MS_DAY) : 0,
        placedAt: o.placedAt,
      };
    }),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
