// Order + checkout service — the authoritative commerce core.
//
// SECURITY INVARIANTS:
//  - Prices, discounts, tax, shipping and totals are ALWAYS computed here from
//    catalog + coupon rows read fresh from the DB. Nothing money-related is
//    accepted from the client.
//  - Order placement runs in a single transaction: reprice → validate stock →
//    deduct inventory → create Order/Items/Payment/Invoice/CouponRedemption →
//    write status history + audit + notifications. Any failure rolls back all.
//  - Idempotency: a repeated placement with the same idempotencyKey returns the
//    already-created order instead of creating a duplicate.
//  - Ownership: buyers can only read/cancel their own orders (queries scoped by
//    userId); admin operations are gated by role at the route layer.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.mjs";
import {
  priceOrder,
  evaluateCoupon,
  effectiveUnitPriceMinor,
  newOrderNumber,
  newPaymentNumber,
  canTransition,
  CUSTOMER_CANCELLABLE,
} from "../lib/commerce.mjs";
import { recordEvent, notify, notifyRoles } from "./events.mjs";
// Tiered pricing + commission are resolved server-side; see pricing.mjs.
import { resolveUnitPriceMinor, commissionBpsFor, commissionFor } from "./pricing.mjs";

const availableStock = (p) => Math.max(0, p.stock - p.reservedStock);

// Resolve the caller's cart into priced, validated line items. Throws on empty
// cart, unavailable product, or insufficient stock. `tx` lets it run inside the
// placement transaction against consistent rows.
async function buildPricedItems(userId, tx = prisma) {
  const cart = await tx.cart.findUnique({ where: { userId } });
  const items = cart ? await tx.cartItem.findMany({ where: { cartId: cart.id } }) : [];
  if (items.length === 0) throw badRequest("Your cart is empty", "CART_EMPTY");

  // Tiers come along so the ladder is resolved against the SAME rows the
  // stock check uses — pricing and availability must agree.
  const products = await tx.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    include: { priceTiers: { orderBy: { minQty: "asc" } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const priced = items.map((it) => {
    const p = byId.get(it.productId);
    if (!p || p.deletedAt || p.status !== "active") {
      throw badRequest(`"${p?.name ?? "A product"}" is no longer available`, "PRODUCT_UNAVAILABLE");
    }
    if (it.quantity > availableStock(p)) {
      throw badRequest(`"${p.name}" has only ${availableStock(p)} in stock`, "INSUFFICIENT_STOCK");
    }
    // Tiered B2B pricing: the highest minQty not exceeding this quantity wins.
    // Falls back to the product's effective base price when it has no ladder.
    const tierPrice = p.priceTiers?.length ? resolveUnitPriceMinor(p, it.quantity) : null;
    const unitPriceMinor = tierPrice ?? effectiveUnitPriceMinor(p);
    const lineTotalMinor = unitPriceMinor * it.quantity;
    // Commission SNAPSHOT: rate and amount are frozen onto the line at order
    // time, so an admin repricing the product later cannot restate payouts.
    const commissionBps = commissionBpsFor(p);
    return {
      commissionBps,
      commissionMinor: commissionFor(lineTotalMinor, commissionBps),
      product: p,
      productId: p.id,
      productName: p.name,
      sku: p.sku,
      variant: it.variant,
      quantity: it.quantity,
      unitPriceMinor,
      lineTotalMinor,
      specs: {
        dimensions:
          p.length || p.width || p.height
            ? { length: p.length, width: p.width, height: p.height, unit: p.dimUnit }
            : undefined,
        gsm: p.gsm ?? undefined,
        color: p.color ?? undefined,
        material: p.material ?? undefined,
        printing: p.printing ?? undefined,
      },
    };
  });
  return priced;
}

// Look up + evaluate a coupon against a subtotal. Returns { coupon, discountMinor }.
async function resolveCoupon(couponCode, subtotalMinor, userId, tx = prisma) {
  if (!couponCode) return { coupon: null, discountMinor: 0 };
  const coupon = await tx.coupon.findUnique({ where: { code: couponCode.trim().toUpperCase() } });
  const evalResult = evaluateCoupon(coupon, subtotalMinor);
  if (!evalResult.ok) throw badRequest(evalResult.reason, "COUPON_INVALID");
  // Per-user single use.
  const priorUse = await tx.couponRedemption.findFirst({ where: { couponId: coupon.id, userId } });
  if (priorUse) throw badRequest("You have already used this coupon", "COUPON_ALREADY_USED");
  return { coupon, discountMinor: evalResult.discountMinor };
}

// Preview pricing for the cart (no order created). Used by cart + review pages.
export async function quote(userId, { couponCode } = {}) {
  const priced = await buildPricedItems(userId).catch((e) => {
    if (e.code === "CART_EMPTY") return [];
    throw e;
  });
  const subtotalMinor = priced.reduce((s, it) => s + it.lineTotalMinor, 0);

  let discountMinor = 0;
  let couponError = null;
  let appliedCode = null;
  if (couponCode && priced.length) {
    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.trim().toUpperCase() } });
    const evalResult = evaluateCoupon(coupon, subtotalMinor);
    if (evalResult.ok) {
      const priorUse = coupon ? await prisma.couponRedemption.findFirst({ where: { couponId: coupon.id, userId } }) : null;
      if (priorUse) couponError = "You have already used this coupon";
      else { discountMinor = evalResult.discountMinor; appliedCode = coupon.code; }
    } else {
      couponError = evalResult.reason;
    }
  }

  const totals = priceOrder({ items: priced, discountMinor });
  return {
    items: priced.map(({ product: _p, ...rest }) => rest),
    ...totals,
    couponCode: appliedCode,
    couponError,
  };
}

const addressSnapshot = (a) => ({
  name: a.name, phone: a.phone, line1: a.line1, line2: a.line2 ?? null,
  city: a.city, state: a.state, postalCode: a.postalCode, country: a.country,
});

/**
 * Place an order from the caller's cart. COD only for now: the order is created
 * PENDING with a PENDING COD payment; inventory is deducted immediately so the
 * stock can't be oversold. Idempotent on idempotencyKey.
 */
export async function placeOrder(user, input) {
  const {
    shippingAddressId, billingAddressId, couponCode, paymentMethod = "cod", notes, idempotencyKey,
  } = input;

  // Idempotency: return the prior order for a repeated key (stored in AuditLog).
  if (idempotencyKey) {
    const prior = await prisma.auditLog.findFirst({
      where: { eventType: "order.placed", actorId: user.id, metadata: { path: ["idempotencyKey"], equals: idempotencyKey } },
      orderBy: { createdAt: "desc" },
    });
    if (prior?.entityId) {
      const existing = await prisma.order.findUnique({ where: { id: prior.entityId }, include: orderInclude });
      if (existing) return shapeOrder(existing);
    }
  }

  const ship = await prisma.address.findFirst({ where: { id: shippingAddressId, userId: user.id } });
  if (!ship) throw badRequest("Select a valid shipping address", "ADDRESS_INVALID");
  const bill = billingAddressId
    ? await prisma.address.findFirst({ where: { id: billingAddressId, userId: user.id } })
    : ship;
  if (!bill) throw badRequest("Select a valid billing address", "ADDRESS_INVALID");

  const order = await prisma.$transaction(async (tx) => {
    const priced = await buildPricedItems(user.id, tx);
    const subtotalMinor = priced.reduce((s, it) => s + it.lineTotalMinor, 0);
    const { coupon, discountMinor } = await resolveCoupon(couponCode, subtotalMinor, user.id, tx);
    const totals = priceOrder({ items: priced, discountMinor });

    // Stock is deducted before the order row exists, so the ledger rows are
    // linked back to the order immediately after it is created.
    const checkoutMovementIds = [];

    // Deduct inventory atomically. The conditional updateMany is the race guard
    // — two concurrent checkouts cannot both pass `stock >= quantity` — so the
    // stock write stays here rather than going through recordMovement(), which
    // reads-then-writes. The ledger row is appended immediately after in the
    // same transaction, so Product.stock and the ledger still reconcile.
    for (const it of priced) {
      const res = await tx.product.updateMany({
        where: { id: it.productId, stock: { gte: it.quantity } },
        data: { stock: { decrement: it.quantity } },
      });
      if (res.count === 0) throw conflict(`"${it.productName}" just went out of stock`, "INSUFFICIENT_STOCK");
      const movement = await postLedger(tx, {
        productId: it.productId,
        type: "DISPATCH",
        delta: -it.quantity,
        reason: "Order placed",
        refType: "Order",
        actorId: user.id,
      });
      if (movement) checkoutMovementIds.push(movement.id);
    }

    // Distribute the order-level discount/tax across line items proportionally
    // so each OrderItem snapshot carries its own discount/tax/lineTotal.
    const s = addressSnapshot(ship);
    const b = addressSnapshot(bill);
    // (see checkoutMovementIds above — linked immediately after creation)
    const created = await tx.order.create({
      data: {
        orderNumber: newOrderNumber(),
        userId: user.id,
        status: "PENDING",
        paymentStatus: "PENDING",
        paymentMethod,
        // Roll-up of the line snapshots, so payout queries never re-derive it.
        commissionMinor: priced.reduce((n, it) => n + it.commissionMinor, 0),
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        shippingMinor: totals.shippingMinor,
        grandTotalMinor: totals.grandTotalMinor,
        paidMinor: 0,
        couponId: coupon?.id ?? null,
        couponCode: coupon?.code ?? null,
        notes: notes ?? null,
        shipName: s.name, shipPhone: s.phone, shipLine1: s.line1, shipLine2: s.line2,
        shipCity: s.city, shipState: s.state, shipPostalCode: s.postalCode, shipCountry: s.country,
        billName: b.name, billPhone: b.phone, billLine1: b.line1, billLine2: b.line2,
        billCity: b.city, billState: b.state, billPostalCode: b.postalCode, billCountry: b.country,
        items: {
          create: priced.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            sku: it.sku,
            variant: it.variant,
            specs: it.specs ?? {},
            quantity: it.quantity,
            unitPriceMinor: it.unitPriceMinor,
            // proportional share of order discount, then GST on the net line
            discountMinor: totals.subtotalMinor
              ? Math.round((it.lineTotalMinor / totals.subtotalMinor) * totals.discountMinor)
              : 0,
            taxMinor: 0, // filled below once discount is known (kept simple: order-level tax authoritative)
            lineTotalMinor: it.lineTotalMinor,
            commissionBps: it.commissionBps,
            commissionMinor: it.commissionMinor,
          })),
        },
        statusHistory: { create: { status: "PENDING", note: "Order placed", actorId: user.id } },
        payments: {
          create: {
            paymentNumber: newPaymentNumber(),
            method: paymentMethod,
            amountMinor: totals.grandTotalMinor,
            status: "PENDING", // COD captures on delivery; offline methods on admin confirmation
          },
        },
      },
      include: orderInclude,
    });

    // Coupon redemption ledger + usage counter.
    if (coupon) {
      await tx.couponRedemption.create({
        data: { couponId: coupon.id, userId: user.id, orderId: created.id, discountMinor: totals.discountMinor },
      });
      await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }

    // Invoice with a gapless, race-safe number (single-row counter locked in-txn).
    const invoiceNumber = await nextInvoiceNumber(tx);
    await tx.invoice.create({
      data: {
        invoiceNumber,
        orderId: created.id,
        status: "issued",
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        shippingMinor: totals.shippingMinor,
        grandTotalMinor: totals.grandTotalMinor,
      },
    });

    // Clear the cart now that it's an order.
    const cart = await tx.cart.findUnique({ where: { userId: user.id } });
    // Link the pre-created ledger rows to the order they belong to, so the
    // Stock Movement tab can trace every DISPATCH back to its order.
    if (checkoutMovementIds.length) {
      await tx.stockMovement.updateMany({
        where: { id: { in: checkoutMovementIds } },
        data: { refId: created.id },
      });
    }

    if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    await recordEvent(
      {
        eventType: "order.placed",
        actorId: user.id,
        entityType: "Order",
        entityId: created.id,
        metadata: { orderNumber: created.orderNumber, grandTotalMinor: totals.grandTotalMinor, idempotencyKey: idempotencyKey ?? null },
      },
      tx,
    );
    await notify(
      { userId: user.id, type: "order.placed", title: "Order placed", body: `Your order ${created.orderNumber} has been placed.`, entityType: "Order", entityId: created.id },
      tx,
    );
    await notifyRoles(
      ["admin", "operations_admin"],
      { type: "order.new", title: "New order", body: `Order ${created.orderNumber} placed.`, entityType: "Order", entityId: created.id },
      tx,
    );

    return created;
  });

  const full = await prisma.order.findUnique({ where: { id: order.id }, include: orderInclude });
  return shapeOrder(full);
}

// Gapless invoice numbering: ZOLO/<year>/<6-digit seq>, incremented under a
// row lock inside the caller's transaction.
async function nextInvoiceNumber(tx) {
  const year = new Date().getFullYear();
  // Ensure the single counter row exists, then lock+increment.
  await tx.$executeRaw`INSERT INTO "InvoiceCounter" ("id","year","seq") VALUES (1, ${year}, 0) ON CONFLICT ("id") DO NOTHING`;
  const rows = await tx.$queryRaw`SELECT "year","seq" FROM "InvoiceCounter" WHERE "id" = 1 FOR UPDATE`;
  let { year: curYear, seq } = rows[0];
  if (curYear !== year) { curYear = year; seq = 0; }
  seq += 1;
  await tx.$executeRaw`UPDATE "InvoiceCounter" SET "year" = ${curYear}, "seq" = ${seq} WHERE "id" = 1`;
  return `ZOLO/${curYear}/${String(seq).padStart(6, "0")}`;
}

const orderInclude = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" } },
  payments: { orderBy: { createdAt: "asc" } },
  shipments: { include: { events: { orderBy: { createdAt: "asc" } } } },
  invoice: true,
  coupon: true,
};

// Serialize an order for API responses (adds a light user summary for admin).
function shapeOrder(o, includeUser = false) {
  if (!o) return null;
  const base = {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    currency: o.currency,
    subtotalMinor: o.subtotalMinor,
    discountMinor: o.discountMinor,
    taxMinor: o.taxMinor,
    shippingMinor: o.shippingMinor,
    grandTotalMinor: o.grandTotalMinor,
    paidMinor: o.paidMinor,
    couponCode: o.couponCode,
    notes: o.notes,
    cancelReason: o.cancelReason,
    placedAt: o.placedAt,
    updatedAt: o.updatedAt,
    shippingAddress: { name: o.shipName, phone: o.shipPhone, line1: o.shipLine1, line2: o.shipLine2, city: o.shipCity, state: o.shipState, postalCode: o.shipPostalCode, country: o.shipCountry },
    billingAddress: { name: o.billName, phone: o.billPhone, line1: o.billLine1, line2: o.billLine2, city: o.billCity, state: o.billState, postalCode: o.billPostalCode, country: o.billCountry },
    items: (o.items ?? []).map((it) => ({
      id: it.id, productId: it.productId, productName: it.productName, sku: it.sku, variant: it.variant,
      specs: it.specs, quantity: it.quantity, unitPriceMinor: it.unitPriceMinor,
      discountMinor: it.discountMinor, taxMinor: it.taxMinor, lineTotalMinor: it.lineTotalMinor,
    })),
    statusHistory: (o.statusHistory ?? []).map((h) => ({ status: h.status, note: h.note, at: h.createdAt })),
    payments: (o.payments ?? []).map((p) => ({ paymentNumber: p.paymentNumber, method: p.method, amountMinor: p.amountMinor, status: p.status, reference: p.reference, paidAt: p.paidAt })),
    shipments: (o.shipments ?? []).map((s) => ({ shipmentNumber: s.shipmentNumber, courier: s.courier, trackingNumber: s.trackingNumber, status: s.status, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, expectedAt: s.expectedAt, events: (s.events ?? []).map((e) => ({ status: e.status, location: e.location, note: e.note, at: e.createdAt })) })),
    invoice: o.invoice ? { invoiceNumber: o.invoice.invoiceNumber, status: o.invoice.status, issuedAt: o.invoice.issuedAt } : null,
  };
  if (includeUser && o.user) base.customer = { id: o.user.id, name: `${o.user.firstName} ${o.user.lastName ?? ""}`.trim(), email: o.user.email, phone: o.user.phone };
  return base;
}

// ---- Buyer reads ----
export async function listMyOrders(userId) {
  const orders = await prisma.order.findMany({ where: { userId }, include: orderInclude, orderBy: { placedAt: "desc" } });
  return orders.map((o) => shapeOrder(o));
}

export async function getMyOrder(userId, orderId) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: orderInclude });
  if (!order) throw notFound("Order not found");
  return shapeOrder(order);
}

export async function cancelMyOrder(userId, orderId, reason) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, userId }, include: { items: true } });
    if (!order) throw notFound("Order not found");
    if (!CUSTOMER_CANCELLABLE.has(order.status)) {
      throw badRequest(`Order can't be cancelled once it is ${order.status.toLowerCase()}`, "NOT_CANCELLABLE");
    }
    // Restock through the ledger so the return is explainable.
    for (const it of order.items) {
      if (!it.productId) continue;
      await tx.product.updateMany({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
      await postLedger(tx, {
        productId: it.productId,
        type: "RETURN",
        delta: it.quantity,
        reason: "Order cancelled by customer",
        refType: "Order",
        refId: order.id,
        actorId: userId,
      });
    }
    await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelReason: reason ?? "Cancelled by customer" } });
    await tx.orderStatusHistory.create({ data: { orderId: order.id, status: "CANCELLED", note: reason ?? "Cancelled by customer", actorId: userId } });
    if (order.invoice) await tx.invoice.updateMany({ where: { orderId: order.id }, data: { status: "cancelled" } });
    await recordEvent({ eventType: "order.cancelled", actorId: userId, entityType: "Order", entityId: order.id, metadata: { reason: reason ?? null } }, tx);
    const full = await tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
    return shapeOrder(full);
  });
}

// ---- Invoice (buyer or admin) ----
export async function getInvoice(orderId, { userId = null, isAdmin = false }) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { ...orderInclude, user: true } });
  if (!order) throw notFound("Order not found");
  if (!isAdmin && order.userId !== userId) throw forbidden("Not your order");
  if (!order.invoice) throw notFound("Invoice not available");
  return {
    invoiceNumber: order.invoice.invoiceNumber,
    issuedAt: order.invoice.issuedAt,
    status: order.invoice.status,
    order: shapeOrder(order, true),
  };
}

// ---- Admin reads + status management ----
export async function adminListOrders({ status, paymentStatus, search, from, to, page = 1, pageSize = 20 }) {
  const where = {};
  if (status) where.status = status;
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (from || to) where.placedAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { shipName: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ];
  }
  const take = Math.min(Math.max(1, pageSize), 100);
  const skip = (Math.max(1, page) - 1) * take;
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: { ...orderInclude, user: true }, orderBy: { placedAt: "desc" }, skip, take }),
  ]);
  return { total, page, pageSize: take, orders: orders.map((o) => shapeOrder(o, true)) };
}

export async function adminGetOrder(orderId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { ...orderInclude, user: true } });
  if (!order) throw notFound("Order not found");
  return shapeOrder(order, true);
}

export async function adminOrderStats() {
  const [byStatus, byPayment, revenue, totalOrders] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: true }),
    prisma.order.groupBy({ by: ["paymentStatus"], _count: true }),
    prisma.order.aggregate({ _sum: { grandTotalMinor: true }, where: { status: { notIn: ["CANCELLED"] } } }),
    prisma.order.count(),
  ]);
  const countOf = (arr, key, val) => arr.find((r) => r[key] === val)?._count ?? 0;
  return {
    totalOrders,
    revenueMinor: revenue._sum.grandTotalMinor ?? 0,
    pendingPayment: countOf(byPayment, "paymentStatus", "PENDING"),
    paid: countOf(byPayment, "paymentStatus", "PAID") + countOf(byPayment, "paymentStatus", "SUCCESS"),
    processing: countOf(byStatus, "status", "PROCESSING"),
    shipped: countOf(byStatus, "status", "SHIPPED"),
    delivered: countOf(byStatus, "status", "DELIVERED"),
    cancelled: countOf(byStatus, "status", "CANCELLED"),
    pending: countOf(byStatus, "status", "PENDING"),
    confirmed: countOf(byStatus, "status", "CONFIRMED"),
  };
}

export async function adminUpdateStatus(adminUser, orderId, { status, note, courier, trackingNumber }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, invoice: true } });
    if (!order) throw notFound("Order not found");
    if (order.status === status) throw badRequest("Order is already in that status", "NO_CHANGE");
    if (!canTransition(order.status, status)) {
      throw badRequest(`Cannot move an order from ${order.status} to ${status}`, "INVALID_TRANSITION");
    }

    const data = { status };
    // Delivery of a COD order captures payment.
    if (status === "DELIVERED" && order.paymentMethod === "cod") {
      data.paymentStatus = "PAID";
      data.paidMinor = order.grandTotalMinor;
      await tx.payment.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date() } });
      if (order.invoice) await tx.invoice.updateMany({ where: { orderId: order.id }, data: { status: "paid" } });
    }
    // Cancellation restocks.
    if (status === "CANCELLED") {
      for (const it of order.items) {
        if (!it.productId) continue;
        await tx.product.updateMany({ where: { id: it.productId }, data: { stock: { increment: it.quantity } } });
        await postLedger(tx, {
          productId: it.productId,
          type: "RETURN",
          delta: it.quantity,
          reason: note ?? "Cancelled by admin",
          refType: "Order",
          refId: order.id,
          actorId: adminUser.id,
        });
      }
      data.cancelReason = note ?? "Cancelled by admin";
      if (order.invoice) await tx.invoice.updateMany({ where: { orderId: order.id }, data: { status: "cancelled" } });
    }

    await tx.order.update({ where: { id: order.id }, data });
    await tx.orderStatusHistory.create({ data: { orderId: order.id, status, note: note ?? null, actorId: adminUser.id } });

    // A SHIPPED transition may attach shipment/tracking info.
    const alreadyShipped = await tx.shipment.count({ where: { orderId: order.id, status: { not: "CANCELLED" } } });
    if (status === "SHIPPED" && (courier || trackingNumber) && alreadyShipped === 0) {
      await tx.shipment.create({
        data: {
          shipmentNumber: `SHP-${order.orderNumber.slice(4)}`,
          orderId: order.id,
          courier: courier ?? null,
          trackingNumber: trackingNumber ?? null,
          status: "IN_TRANSIT",
          shippedAt: new Date(),
          events: { create: { status: "IN_TRANSIT", note: "Shipment dispatched" } },
        },
      });
    } else if (status === "SHIPPED" && (courier || trackingNumber)) {
      // A shipment was booked earlier — update it rather than creating a second.
      await tx.shipment.updateMany({
        where: { orderId: order.id, status: { not: "CANCELLED" } },
        data: { courier: courier ?? undefined, trackingNumber: trackingNumber ?? undefined },
      });
    }

    await recordEvent({ eventType: "order.status_changed", actorId: adminUser.id, entityType: "Order", entityId: order.id, metadata: { from: order.status, to: status, note: note ?? null } }, tx);
    await notify({ userId: order.userId, type: "order.status", title: "Order update", body: `Your order ${order.orderNumber} is now ${status.replace(/_/g, " ").toLowerCase()}.`, entityType: "Order", entityId: order.id }, tx);

    const full = await tx.order.findUnique({ where: { id: order.id }, include: { ...orderInclude, user: true } });
    return shapeOrder(full, true);
  });
}

// ---------------------------------------------------------------------------
// Payments & refunds (admin)
//
// Payment state is authoritative on the Payment row; the Order carries a
// denormalised `paymentStatus`/`paidMinor` so order lists don't need a join.
// Both are written in one transaction so Finance and Orders can never disagree.
// ---------------------------------------------------------------------------

/**
 * Append a StockMovement row for a stock change that was already applied by a
 * conditional update.
 *
 * Checkout must use `updateMany({ where: { stock: { gte: qty } } })` to stay
 * race-safe, which recordMovement() cannot express (it reads, then writes). So
 * the write happens at the call site and the ledger row is appended here, in
 * the same transaction — the invariant (Product.stock == sum of movements) is
 * preserved even though the two statements are separate.
 *
 * `delta` is signed and must match what was applied to Product.stock.
 */
async function postLedger(tx, { productId, type, delta, reason = null, refType = null, refId = null, actorId = null }) {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { stock: true } });
  if (!product) return; // product vanished mid-transaction; nothing to record

  // Opening balance: a product holding stock from before the ledger existed
  // needs one back-posted row, or its history can never sum to on-hand stock.
  // `product.stock` is already post-change here, so the pre-change quantity is
  // stock - delta.
  const hasHistory = (await tx.stockMovement.count({ where: { productId } })) > 0;
  if (!hasHistory) {
    const opening = product.stock - delta;
    if (opening !== 0) {
      await tx.stockMovement.create({
        data: {
          productId,
          type: "ADJUSTMENT",
          quantity: opening,
          balance: opening,
          reason: "Opening balance (stock on hand before ledger tracking began)",
          refType: "opening",
          actorId,
        },
      });
    }
  }

  return tx.stockMovement.create({
    data: { productId, type, quantity: delta, balance: product.stock, reason, refType, refId, actorId },
  });
}

const PAYMENT_STATUSES = new Set(["PENDING", "PARTIAL", "PAID", "SUCCESS", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]);
const PAID_STATUSES = new Set(["PAID", "SUCCESS"]);

/** Admin records a payment outcome (gateway callback, NEFT receipt, cheque cleared). */
export async function adminUpdatePayment(adminUser, paymentId, { status, reference, method, note } = {}) {
  if (!PAYMENT_STATUSES.has(status)) throw badRequest(`Unknown payment status: ${status}`);

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment) throw notFound("Payment not found");
    const order = payment.order;

    const isPaid = PAID_STATUSES.has(status);
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status,
        reference: reference ?? payment.reference,
        method: method ?? payment.method,
        // Stamp paidAt on the transition into paid; clear it on the way out so
        // a reversed payment doesn't keep a settlement date.
        paidAt: isPaid ? (payment.paidAt ?? new Date()) : status === "PENDING" || status === "FAILED" ? null : payment.paidAt,
      },
    });

    // Re-derive the order's payment position from ALL its payments rather than
    // trusting the single row we just wrote.
    const rows = await tx.payment.findMany({ where: { orderId: order.id } });
    const paidMinor = rows.filter((p) => PAID_STATUSES.has(p.status)).reduce((s, p) => s + p.amountMinor, 0);
    const refundedMinor = rows.filter((p) => p.status === "REFUNDED").reduce((s, p) => s + p.amountMinor, 0);

    let orderPaymentStatus = "PENDING";
    if (refundedMinor > 0 && refundedMinor >= order.grandTotalMinor) orderPaymentStatus = "REFUNDED";
    else if (refundedMinor > 0) orderPaymentStatus = "PARTIALLY_REFUNDED";
    else if (paidMinor >= order.grandTotalMinor && order.grandTotalMinor > 0) orderPaymentStatus = "PAID";
    else if (paidMinor > 0) orderPaymentStatus = "PARTIAL";
    else if (rows.some((p) => p.status === "FAILED")) orderPaymentStatus = "FAILED";

    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: orderPaymentStatus, paidMinor } });

    if ((await tx.invoice.count({ where: { orderId: order.id } })) > 0) {
      const invoiceStatus = orderPaymentStatus === "PAID" ? "paid" : "issued";
      await tx.invoice.updateMany({ where: { orderId: order.id }, data: { status: invoiceStatus } });
    }

    await recordEvent(
      {
        eventType: "payment.updated",
        actorId: adminUser.id,
        entityType: "Payment",
        entityId: payment.id,
        metadata: { orderNumber: order.orderNumber, from: payment.status, to: status, amountMinor: payment.amountMinor, note: note ?? null },
      },
      tx,
    );
    await notify(
      {
        userId: order.userId,
        type: "payment.updated",
        title: isPaid ? "Payment received" : "Payment update",
        body: `Payment for ${order.orderNumber} is now ${status.replace(/_/g, " ").toLowerCase()}.`,
        entityType: "Order",
        entityId: order.id,
      },
      tx,
    );

    const full = await tx.order.findUnique({ where: { id: order.id }, include: { ...orderInclude, user: true } });
    return shapeOrder(full, true);
  });
}

/** Admin raises a refund against a captured payment. */
export async function adminCreateRefund(adminUser, paymentId, { amountMinor, reason } = {}) {
  const amount = Number(amountMinor);
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Refund amount must be a positive integer (paise)");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true, refunds: true } });
    if (!payment) throw notFound("Payment not found");
    if (!PAID_STATUSES.has(payment.status) && payment.status !== "PARTIALLY_REFUNDED") {
      throw badRequest("Only a captured payment can be refunded");
    }

    const alreadyRefunded = payment.refunds
      .filter((r) => r.status !== "rejected")
      .reduce((s, r) => s + r.amountMinor, 0);
    if (alreadyRefunded + amount > payment.amountMinor) {
      throw badRequest("Refund exceeds the remaining refundable amount");
    }

    const seq = await tx.refund.count();
    const refund = await tx.refund.create({
      data: {
        refundNumber: `REF-${String(seq + 1).padStart(6, "0")}`,
        paymentId: payment.id,
        amountMinor: amount,
        reason: reason ?? null,
        status: "processed",
        processedAt: new Date(),
      },
    });

    const totalRefunded = alreadyRefunded + amount;
    const fullyRefunded = totalRefunded >= payment.amountMinor;
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });
    await tx.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });

    await recordEvent(
      {
        eventType: "refund.created",
        actorId: adminUser.id,
        entityType: "Refund",
        entityId: refund.id,
        metadata: { orderNumber: payment.order.orderNumber, amountMinor: amount, reason: reason ?? null },
      },
      tx,
    );
    await notify(
      {
        userId: payment.order.userId,
        type: "refund.created",
        title: "Refund issued",
        body: `A refund of ₹${(amount / 100).toLocaleString("en-IN")} was issued for ${payment.order.orderNumber}.`,
        entityType: "Order",
        entityId: payment.orderId,
      },
      tx,
    );

    return refund;
  });
}

// ---------------------------------------------------------------------------
// Shipments (admin)
//
// The Shipment carries the courier relationship; the Order carries the
// customer-facing status. Advancing a shipment therefore also advances the
// order so Admin Shipping and the customer's tracking page never diverge.
// ---------------------------------------------------------------------------

const SHIPMENT_STATUSES = ["PACKING", "AWB_BOOKED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

// Where a shipment status leaves the order. Statuses absent from this map
// (PACKING, AWB_BOOKED) don't move the order on their own.
const SHIPMENT_TO_ORDER = {
  PICKED_UP: "SHIPPED",
  IN_TRANSIT: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
};

/** Book a shipment against an order (AWB creation). */
export async function adminCreateShipment(adminUser, orderId, { courier, trackingNumber, expectedAt, note } = {}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound("Order not found");
    if (order.status === "CANCELLED") throw badRequest("A cancelled order cannot be shipped");

    const existing = await tx.shipment.count({ where: { orderId, status: { not: "CANCELLED" } } });
    if (existing > 0) throw conflict("This order already has an active shipment");

    const status = trackingNumber ? "AWB_BOOKED" : "PACKING";
    const shipment = await tx.shipment.create({
      data: {
        shipmentNumber: `SHP-${order.orderNumber.slice(4)}`,
        orderId: order.id,
        courier: courier ?? null,
        trackingNumber: trackingNumber ?? null,
        status,
        expectedAt: expectedAt ? new Date(expectedAt) : null,
        events: { create: { status, note: note ?? "Shipment created" } },
      },
      include: { events: true },
    });

    await recordEvent(
      {
        eventType: "shipment.created",
        actorId: adminUser.id,
        entityType: "Shipment",
        entityId: shipment.id,
        metadata: { orderNumber: order.orderNumber, courier: courier ?? null, trackingNumber: trackingNumber ?? null },
      },
      tx,
    );
    await notify(
      {
        userId: order.userId,
        type: "shipment.created",
        title: "Your order is being packed",
        body: `Shipment ${shipment.shipmentNumber} was created for ${order.orderNumber}.`,
        entityType: "Order",
        entityId: order.id,
      },
      tx,
    );

    return shipment;
  });
}

/** Add a tracking event and advance both the shipment and its order. */
export async function adminAddShipmentEvent(adminUser, shipmentId, { status, location, note } = {}) {
  if (!SHIPMENT_STATUSES.includes(status)) throw badRequest(`Unknown shipment status: ${status}`);

  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!shipment) throw notFound("Shipment not found");
    const order = shipment.order;

    // Statuses are a forward-only ladder; CANCELLED may be reached from anywhere.
    const from = SHIPMENT_STATUSES.indexOf(shipment.status);
    const to = SHIPMENT_STATUSES.indexOf(status);
    if (status !== "CANCELLED" && to < from) {
      throw badRequest(`Cannot move a shipment from ${shipment.status} back to ${status}`);
    }

    await tx.shipmentEvent.create({
      data: { shipmentId: shipment.id, status, location: location ?? null, note: note ?? null },
    });
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status,
        shippedAt: shipment.shippedAt ?? (status === "PICKED_UP" || status === "IN_TRANSIT" ? new Date() : null),
        deliveredAt: status === "DELIVERED" ? new Date() : shipment.deliveredAt,
      },
    });

    // Keep the order in step with the shipment.
    const orderStatus = SHIPMENT_TO_ORDER[status];
    if (orderStatus && orderStatus !== order.status && order.status !== "CANCELLED") {
      const data = { status: orderStatus };
      if (orderStatus === "DELIVERED") {
        // Delivery time lives on the Shipment (deliveredAt); Order tracks only
        // status + placedAt/updatedAt.
        // A COD order settles on delivery.
        if (order.paymentMethod === "cod") {
          data.paymentStatus = "PAID";
          data.paidMinor = order.grandTotalMinor;
          await tx.payment.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "PAID", paidAt: new Date() } });
          await tx.invoice.updateMany({ where: { orderId: order.id }, data: { status: "paid" } });
        }
      }
      await tx.order.update({ where: { id: order.id }, data });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, status: orderStatus, note: `Shipment ${shipment.shipmentNumber}: ${status}`, actorId: adminUser.id },
      });
      await recordEvent(
        {
          eventType: "order.status_changed",
          actorId: adminUser.id,
          entityType: "Order",
          entityId: order.id,
          metadata: { orderNumber: order.orderNumber, from: order.status, to: orderStatus, via: "shipment" },
        },
        tx,
      );
    }

    await recordEvent(
      {
        eventType: "shipment.status_changed",
        actorId: adminUser.id,
        entityType: "Shipment",
        entityId: shipment.id,
        metadata: { orderNumber: order.orderNumber, from: shipment.status, to: status, location: location ?? null },
      },
      tx,
    );
    await notify(
      {
        userId: order.userId,
        type: "shipment.status",
        title: status === "DELIVERED" ? "Order delivered" : "Shipment update",
        body: `${order.orderNumber}: ${status.replace(/_/g, " ").toLowerCase()}${location ? ` — ${location}` : ""}.`,
        entityType: "Order",
        entityId: order.id,
      },
      tx,
    );

    return tx.shipment.findUnique({ where: { id: shipment.id }, include: { events: { orderBy: { createdAt: "desc" } } } });
  });
}

/** Full tracking timeline for one shipment. */
export async function adminGetShipment(shipmentId) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      events: { orderBy: { createdAt: "desc" } },
      order: { select: { id: true, orderNumber: true, status: true, user: { select: { firstName: true, lastName: true, email: true } } } },
    },
  });
  if (!shipment) throw notFound("Shipment not found");
  return shipment;
}
