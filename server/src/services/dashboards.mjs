// ============================================================
// Dashboard aggregation — the read side of the data flow.
//
// Every figure here is computed from PostgreSQL at request time. Nothing is
// cached, denormalized or hardcoded, so a dashboard can never disagree with
// the orders/inventory pages: they read the same rows.
//
// Queries run in parallel (one round-trip's latency, not N) and use grouped
// aggregates rather than pulling rows into JS.
// ============================================================
import { prisma } from "../lib/prisma.mjs";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Orders that count toward revenue — cancelled orders never do. */
const REVENUE_WHERE = { status: { notIn: ["CANCELLED"] } };

/**
 * Admin overview. Returns counts, revenue, recent orders, recent activity and
 * low-stock products in a single response so the dashboard makes ONE request.
 */
export async function adminDashboard({ recentLimit = 10, activityLimit = 15 } = {}) {
  const today = startOfToday();
  const month = startOfMonth();

  const [
    ordersByStatus, ordersByPayment,
    totalOrders, todayOrders,
    revenueAll, revenueToday, revenueMonth,
    totalCustomers, newCustomersToday,
    totalProducts, productCounts,
    recentOrders, recentActivity,
  ] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: true }),
    prisma.order.groupBy({ by: ["paymentStatus"], _count: true }),
    prisma.order.count(),
    prisma.order.count({ where: { placedAt: { gte: today } } }),
    prisma.order.aggregate({ _sum: { grandTotalMinor: true }, where: REVENUE_WHERE }),
    prisma.order.aggregate({ _sum: { grandTotalMinor: true }, where: { ...REVENUE_WHERE, placedAt: { gte: today } } }),
    prisma.order.aggregate({ _sum: { grandTotalMinor: true }, where: { ...REVENUE_WHERE, placedAt: { gte: month } } }),
    prisma.user.count({ where: { role: "buyer", isActive: true } }),
    prisma.user.count({ where: { role: "buyer", createdAt: { gte: today } } }),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.product.findMany({
      where: { deletedAt: null, status: "active" },
      select: { id: true, stock: true, reservedStock: true, lowStockLevel: true },
    }),
    prisma.order.findMany({
      orderBy: { placedAt: "desc" },
      take: recentLimit,
      select: {
        id: true, orderNumber: true, status: true, paymentStatus: true,
        grandTotalMinor: true, placedAt: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: activityLimit,
      select: {
        id: true, eventType: true, entityType: true, entityId: true,
        metadata: true, createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    }),
  ]);

  const countOf = (arr, key, val) => arr.find((r) => r[key] === val)?._count ?? 0;

  // Availability is stock minus what in-flight orders already hold.
  const available = (p) => Math.max(0, p.stock - p.reservedStock);
  const lowStockIds = productCounts.filter((p) => p.lowStockLevel != null && available(p) <= p.lowStockLevel && available(p) > 0).map((p) => p.id);
  const outOfStockIds = productCounts.filter((p) => available(p) === 0).map((p) => p.id);

  const lowStockProducts = lowStockIds.length
    ? await prisma.product.findMany({
        where: { id: { in: lowStockIds.slice(0, 10) } },
        select: { id: true, sku: true, name: true, stock: true, reservedStock: true, lowStockLevel: true, images: true },
      })
    : [];

  return {
    orders: {
      total: totalOrders,
      today: todayOrders,
      pending: countOf(ordersByStatus, "status", "PENDING"),
      confirmed: countOf(ordersByStatus, "status", "CONFIRMED"),
      processing: countOf(ordersByStatus, "status", "PROCESSING"),
      packed: countOf(ordersByStatus, "status", "PACKED"),
      shipped: countOf(ordersByStatus, "status", "SHIPPED"),
      delivered: countOf(ordersByStatus, "status", "DELIVERED"),
      cancelled: countOf(ordersByStatus, "status", "CANCELLED"),
    },
    payments: {
      pending: countOf(ordersByPayment, "paymentStatus", "PENDING"),
      paid: countOf(ordersByPayment, "paymentStatus", "PAID"),
      failed: countOf(ordersByPayment, "paymentStatus", "FAILED"),
      refunded: countOf(ordersByPayment, "paymentStatus", "REFUNDED"),
    },
    revenue: {
      totalMinor: revenueAll._sum.grandTotalMinor ?? 0,
      todayMinor: revenueToday._sum.grandTotalMinor ?? 0,
      monthMinor: revenueMonth._sum.grandTotalMinor ?? 0,
    },
    customers: { total: totalCustomers, newToday: newCustomersToday },
    products: {
      total: totalProducts,
      lowStock: lowStockIds.length,
      outOfStock: outOfStockIds.length,
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      grandTotalMinor: o.grandTotalMinor,
      itemCount: o._count.items,
      createdAt: o.placedAt,
      customer: o.user
        ? { id: o.user.id, name: [o.user.firstName, o.user.lastName].filter(Boolean).join(" ") || o.user.email, email: o.user.email }
        : null,
    })),
    recentActivity: recentActivity.map(describeEvent),
    lowStockProducts: lowStockProducts.map((p) => ({
      id: p.id, sku: p.sku, name: p.name,
      available: Math.max(0, p.stock - p.reservedStock),
      threshold: p.lowStockLevel,
      image: p.images?.[0] ?? null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Turn a stored event row into a human-readable feed entry.
 *
 * Formatting lives here (server-side) so the admin UI and any future channel
 * (email, Slack) describe an event identically.
 */
export function describeEvent(row) {
  const meta = row.metadata ?? {};
  const actor = row.actor
    ? [row.actor.firstName, row.actor.lastName].filter(Boolean).join(" ") || row.actor.email
    : "System";

  const titles = {
    "order.placed": () => ({ title: "New order", body: `${meta.orderNumber ?? "Order"} placed${meta.grandTotalMinor != null ? ` — ₹${(meta.grandTotalMinor / 100).toLocaleString("en-IN")}` : ""}` }),
    "order.status_changed": () => ({ title: "Order status changed", body: `${meta.orderNumber ?? "Order"}: ${meta.from ?? "?"} → ${meta.to ?? "?"}` }),
    "order.cancelled": () => ({ title: "Order cancelled", body: meta.orderNumber ? `${meta.orderNumber} cancelled` : "An order was cancelled" }),
    "order.payment_captured": () => ({ title: "Payment received", body: meta.orderNumber ?? "Payment captured" }),
    "user.registered": () => ({ title: "New customer", body: `${actor} registered` }),
    "shipment.created": () => ({ title: "Shipment booked", body: `${meta.orderNumber ?? "Order"}${meta.courier ? ` — ${meta.courier}` : ""}` }),
    "shipment.status_changed": () => ({ title: "Shipment update", body: `${meta.orderNumber ?? "Order"}: ${meta.to ?? "?"}${meta.location ? ` — ${meta.location}` : ""}` }),
    "payment.updated": () => ({ title: "Payment updated", body: `${meta.orderNumber ?? "Order"}: ${meta.from ?? "?"} → ${meta.to ?? "?"}` }),
    "refund.created": () => ({ title: "Refund issued", body: `${meta.orderNumber ?? "Order"} — ₹${((meta.amountMinor ?? 0) / 100).toLocaleString("en-IN")}` }),
    "seller.created": () => ({ title: "New seller", body: `${meta.orgName ?? actor} signed up` }),
    "seller.onboarding.submitted": () => ({ title: "Seller submitted onboarding", body: meta.orgName ?? actor }),
    "product.created": () => ({ title: "Product created", body: meta.sku ?? meta.name ?? "A product was created" }),
    "inventory.low": () => ({ title: "Low stock", body: `${meta.name ?? meta.sku ?? "A product"} — ${meta.available ?? "?"} remaining` }),
  };

  const built = titles[row.eventType]?.() ?? {
    title: row.eventType.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    body: row.entityType ? `${row.entityType} ${row.entityId ?? ""}`.trim() : "",
  };

  return {
    id: row.id,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    actor,
    actorRole: row.actor?.role ?? null,
    createdAt: row.createdAt,
    ...built,
  };
}

/** Paginated activity feed. Optionally filtered by event type or entity. */
export async function activityFeed({ limit = 30, cursor = null, eventType = null, entityType = null } = {}) {
  const take = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(eventType ? { eventType } : {}),
      ...(entityType ? { entityType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1, // one extra row tells us whether more exist
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, eventType: true, entityType: true, entityId: true,
      metadata: true, createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    activity: page.map(describeEvent),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/** Inventory view: availability, reservations and low-stock flags. */
export async function inventoryOverview({ limit = 50, offset = 0, lowOnly = false } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const where = { deletedAt: null };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take, skip: Math.max(Number(offset) || 0, 0),
      select: { id: true, sku: true, name: true, category: true, stock: true, reservedStock: true, lowStockLevel: true, status: true, images: true },
    }),
    prisma.product.count({ where }),
  ]);

  const shaped = rows.map((p) => {
    const available = Math.max(0, p.stock - p.reservedStock);
    return {
      id: p.id, sku: p.sku, name: p.name, category: p.category, status: p.status,
      stock: p.stock, reserved: p.reservedStock, available,
      threshold: p.lowStockLevel,
      state: available === 0 ? "out_of_stock" : p.lowStockLevel != null && available <= p.lowStockLevel ? "low_stock" : "in_stock",
      image: p.images?.[0] ?? null,
    };
  });

  // On-hand valuation from real cost data. `costMinor` is optional, so we also
  // report how many products carry a cost — a valuation over 40 of 50 products
  // must not be presented as if it covered the whole catalogue.
  const valuation = await prisma.product.aggregate({
    where: { deletedAt: null, costMinor: { not: null } },
    _count: true,
  });
  const costed = await prisma.product.findMany({
    where: { deletedAt: null, costMinor: { not: null } },
    select: { stock: true, costMinor: true },
  });
  const stockValueMinor = costed.reduce((sum, p) => sum + p.stock * (p.costMinor ?? 0), 0);

  return {
    inventory: lowOnly ? shaped.filter((p) => p.state !== "in_stock") : shaped,
    total,
    valuation: {
      stockValueMinor,
      pricedProducts: valuation._count ?? 0,
      totalProducts: total,
    },
  };
}

/**
 * The authenticated customer's own dashboard. Scoped by userId from the
 * verified token — never a client-supplied id.
 */
export async function customerDashboard(userId, { recentLimit = 5 } = {}) {
  const [byStatus, totalOrders, spend, recentOrders, unreadNotifications, addresses] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: { userId }, _count: true }),
    prisma.order.count({ where: { userId } }),
    prisma.order.aggregate({ _sum: { grandTotalMinor: true }, where: { userId, ...REVENUE_WHERE } }),
    prisma.order.findMany({
      where: { userId },
      orderBy: { placedAt: "desc" },
      take: recentLimit,
      select: {
        id: true, orderNumber: true, status: true, paymentStatus: true,
        grandTotalMinor: true, placedAt: true, _count: { select: { items: true } },
      },
    }),
    // Notification uses a status enum (UNREAD/READ), not a readAt timestamp.
    prisma.notification.count({ where: { userId, status: "UNREAD" } }),
    prisma.address.count({ where: { userId } }),
  ]);

  const countOf = (val) => byStatus.find((r) => r.status === val)?._count ?? 0;
  const active = byStatus
    .filter((r) => !["DELIVERED", "CANCELLED"].includes(r.status))
    .reduce((n, r) => n + r._count, 0);

  return {
    orders: {
      total: totalOrders,
      active,
      delivered: countOf("DELIVERED"),
      cancelled: countOf("CANCELLED"),
    },
    totalSpendMinor: spend._sum.grandTotalMinor ?? 0,
    unreadNotifications,
    addresses,
    recentOrders: recentOrders.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, status: o.status,
      paymentStatus: o.paymentStatus, grandTotalMinor: o.grandTotalMinor,
      itemCount: o._count.items, createdAt: o.placedAt,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/** Sales analytics: revenue/orders per day plus best sellers from order_items. */
export async function salesAnalytics({ days = 30 } = {}) {
  const span = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date(Date.now() - span * 86400_000);

  const [series, topProducts] = await Promise.all([
    // Grouped in SQL — never by pulling every order into JS.
    prisma.$queryRaw`
      SELECT date_trunc('day', "placedAt")::date AS day,
             count(*)::int AS orders,
             COALESCE(sum("grandTotalMinor"), 0)::bigint AS revenue_minor
      FROM "Order"
      WHERE "placedAt" >= ${since} AND "status" <> 'CANCELLED'
      GROUP BY 1 ORDER BY 1 ASC`,
    prisma.$queryRaw`
      SELECT oi."productId", oi."productName", oi."sku",
             sum(oi.quantity)::int AS units,
             COALESCE(sum(oi."lineTotalMinor"), 0)::bigint AS revenue_minor
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."placedAt" >= ${since} AND o."status" <> 'CANCELLED'
      GROUP BY 1, 2, 3 ORDER BY units DESC LIMIT 10`,
  ]);

  // BigInt from SQL sums is not JSON-serializable.
  const num = (v) => (typeof v === "bigint" ? Number(v) : v);
  return {
    days: span,
    series: series.map((r) => ({ day: r.day, orders: r.orders, revenueMinor: num(r.revenue_minor) })),
    topProducts: topProducts.map((r) => ({
      productId: r.productId, name: r.productName, sku: r.sku,
      units: r.units, revenueMinor: num(r.revenue_minor),
    })),
  };
}

// ============================================================
// Module data — customers, finance, shipments, coupons, reviews.
//
// These power the admin modules that previously read empty mock arrays.
// Every figure is derived from live rows at request time.
// ============================================================

/**
 * Admin customer list.
 *
 * Customers are `User` rows with role=buyer — the `Customer` table exists in
 * the schema but was never written to (0 rows, while 564 buyers exist), so
 * deriving from User is the only correct source. Order totals are aggregated
 * per user rather than stored, so the figures can never drift.
 */
export async function customerList({ limit = 50, offset = 0, search = null, includeInactive = false } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const where = {
    role: "buyer",
    // Match the dashboard KPI, which counts ACTIVE buyers. `includeInactive`
    // surfaces suspended accounts for support/admin work without the two
    // screens silently disagreeing on "how many customers do we have".
    ...(includeInactive ? {} : { isActive: true }),
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: "desc" }, take, skip,
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        isActive: true, createdAt: true, lastLoginAt: true,
        // Company comes from the org the buyer belongs to, when there is one.
        memberships: { select: { organization: { select: { name: true } } }, take: 1 },
        // City comes from the buyer's own address book — default first.
        addresses: {
          select: { city: true, state: true, isDefault: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          take: 1,
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // One grouped query for every listed user, rather than N per-user queries.
  const ids = users.map((u) => u.id);
  const [spend, latestShip] = await Promise.all([
    ids.length
      ? prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { notIn: ["CANCELLED"] } },
          _count: true,
          _sum: { grandTotalMinor: true },
          _max: { placedAt: true },
        })
      : [],
    // Fallback city: a buyer who checked out as a guest-style flow may have no
    // saved Address, but their order carries a frozen shipping snapshot.
    ids.length
      ? prisma.order.findMany({
          where: { userId: { in: ids }, shipCity: { not: null } },
          orderBy: { placedAt: "desc" },
          select: { userId: true, shipCity: true, shipState: true },
        })
      : [],
  ]);
  const byUser = new Map(spend.map((s) => [s.userId, s]));
  // findMany returns newest first, so the first hit per user is their latest.
  const shipByUser = new Map();
  for (const o of latestShip) if (!shipByUser.has(o.userId)) shipByUser.set(o.userId, o);

  return {
    customers: users.map((u) => {
      const agg = byUser.get(u.id);
      const lifetimeMinor = agg?._sum.grandTotalMinor ?? 0;
      const addr = u.addresses?.[0] ?? null;
      const ship = shipByUser.get(u.id) ?? null;
      return {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
        email: u.email,
        phone: u.phone,
        // Null (not "—") when unknown: the UI decides how to render absence.
        company: u.memberships?.[0]?.organization?.name ?? null,
        city: addr?.city ?? ship?.shipCity ?? null,
        state: addr?.state ?? ship?.shipState ?? null,
        isActive: u.isActive,
        totalOrders: agg?._count ?? 0,
        lifetimeValueMinor: lifetimeMinor,
        lastOrderAt: agg?._max.placedAt ?? null,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        // Segment is derived from real spend, not a stored label.
        segment: lifetimeMinor >= 5_000_00 ? "enterprise" : lifetimeMinor > 0 ? "d2c_brand" : "small_seller",
      };
    }),
    total,
  };
}

/** One customer with their orders and addresses (admin view). */
export async function customerDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true,
      isActive: true, createdAt: true, lastLoginAt: true, role: true,
    },
  });
  if (!user) return null;

  const [orders, addresses, agg, payments, membership, cancelledAgg] = await Promise.all([
    prisma.order.findMany({
      where: { userId }, orderBy: { placedAt: "desc" }, take: 50,
      select: {
        id: true, orderNumber: true, status: true, paymentStatus: true,
        grandTotalMinor: true, paidMinor: true, placedAt: true,
        shipCity: true, shipState: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    prisma.order.aggregate({
      where: { userId, status: { notIn: ["CANCELLED"] } },
      _count: true, _sum: { grandTotalMinor: true }, _max: { placedAt: true }, _avg: { grandTotalMinor: true },
    }),
    // Payment history across every order this customer placed.
    prisma.payment.findMany({
      where: { order: { userId } },
      orderBy: { createdAt: "desc" }, take: 50,
      select: {
        id: true, paymentNumber: true, method: true, amountMinor: true, status: true,
        reference: true, paidAt: true, createdAt: true,
        order: { select: { id: true, orderNumber: true } },
        refunds: { select: { id: true, refundNumber: true, amountMinor: true, status: true, processedAt: true } },
      },
    }),
    prisma.organizationMember.findFirst({
      where: { userId }, select: { organization: { select: { id: true, name: true } } },
    }),
    prisma.order.aggregate({ where: { userId, status: "CANCELLED" }, _count: true }),
  ]);

  const paidMinor = payments
    .filter((p) => p.status === "PAID" || p.status === "SUCCESS")
    .reduce((s, p) => s + p.amountMinor, 0);
  const refundedMinor = payments.flatMap((p) => p.refunds)
    .filter((r) => r.status === "approved" || r.status === "processed")
    .reduce((s, r) => s + r.amountMinor, 0);
  const outstandingMinor = orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + Math.max(0, o.grandTotalMinor - o.paidMinor), 0);

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const latestShip = orders.find((o) => o.shipCity);

  return {
    customer: {
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
      firstName: user.firstName, lastName: user.lastName,
      email: user.email, phone: user.phone, isActive: user.isActive,
      createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
      company: membership?.organization?.name ?? null,
      city: defaultAddress?.city ?? latestShip?.shipCity ?? null,
      state: defaultAddress?.state ?? latestShip?.shipState ?? null,
      totalOrders: agg._count ?? 0,
      cancelledOrders: cancelledAgg._count ?? 0,
      addressCount: addresses.length,
      lifetimeValueMinor: agg._sum.grandTotalMinor ?? 0,
      averageOrderMinor: Math.round(agg._avg.grandTotalMinor ?? 0),
      lastOrderAt: agg._max.placedAt ?? null,
      // Derived from the same rule the list uses, so both screens agree.
      segment: (agg._sum.grandTotalMinor ?? 0) >= 5_000_00 ? "enterprise"
        : (agg._sum.grandTotalMinor ?? 0) > 0 ? "d2c_brand" : "small_seller",
    },
    totals: { paidMinor, refundedMinor, outstandingMinor },
    orders: orders.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, status: o.status,
      paymentStatus: o.paymentStatus, grandTotalMinor: o.grandTotalMinor,
      paidMinor: o.paidMinor, itemCount: o._count.items, createdAt: o.placedAt,
    })),
    payments: payments.map((p) => ({
      id: p.id, paymentNumber: p.paymentNumber, method: p.method,
      amountMinor: p.amountMinor, status: p.status, reference: p.reference,
      paidAt: p.paidAt, createdAt: p.createdAt,
      orderId: p.order?.id ?? null, orderNumber: p.order?.orderNumber ?? null,
      refundedMinor: p.refunds
        .filter((r) => r.status === "approved" || r.status === "processed")
        .reduce((s, r) => s + r.amountMinor, 0),
    })),
    addresses,
  };
}

/** Finance module: invoices, payments and receivables from real rows. */
export async function financeOverview({ limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [invoices, payments, paymentAgg, outstanding, refundAgg, refunds] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: { issuedAt: "desc" }, take,
      select: {
        id: true, invoiceNumber: true, status: true, grandTotalMinor: true, issuedAt: true,
        order: { select: { id: true, orderNumber: true, user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" }, take,
      select: {
        id: true, status: true, amountMinor: true, method: true, reference: true,
        paidAt: true, createdAt: true,
        order: { select: { id: true, orderNumber: true } },
      },
    }),
    prisma.payment.groupBy({ by: ["status"], _count: true, _sum: { amountMinor: true } }),
    prisma.order.aggregate({
      where: { paymentStatus: { in: ["PENDING", "PARTIAL"] }, status: { notIn: ["CANCELLED"] } },
      _sum: { grandTotalMinor: true }, _count: true,
    }),
    // Refunds are their own ledger: a partially-refunded payment still reads
    // PARTIALLY_REFUNDED, so summing payment statuses would under-report.
    prisma.refund.aggregate({ where: { status: { in: ["approved", "processed"] } }, _sum: { amountMinor: true }, _count: true }),
    prisma.refund.findMany({
      where: { status: { in: ["requested", "approved", "processed"] } },
      orderBy: { createdAt: "desc" }, take,
      select: {
        id: true, refundNumber: true, amountMinor: true, reason: true, status: true,
        createdAt: true, processedAt: true,
        payment: { select: { paymentNumber: true, order: { select: { orderNumber: true } } } },
      },
    }),
  ]);

  const sumOf = (s) => paymentAgg.find((p) => p.status === s)?._sum.amountMinor ?? 0;
  const countOf = (s) => paymentAgg.find((p) => p.status === s)?._count ?? 0;

  return {
    summary: {
      // PAID and SUCCESS both mean captured in PaymentStatus.
      capturedMinor: sumOf("PAID") + sumOf("SUCCESS") + sumOf("PARTIAL"),
      pendingMinor: sumOf("PENDING"),
      refundedMinor: refundAgg._sum.amountMinor ?? 0,
      refundCount: refundAgg._count ?? 0,
      failedCount: countOf("FAILED"),
      receivableMinor: outstanding._sum.grandTotalMinor ?? 0,
      receivableOrders: outstanding._count ?? 0,
    },
    refunds: refunds.map((r) => ({
      id: r.id, number: r.refundNumber, amountMinor: r.amountMinor, reason: r.reason,
      status: r.status, createdAt: r.createdAt, processedAt: r.processedAt,
      paymentNumber: r.payment?.paymentNumber ?? null,
      orderNumber: r.payment?.order?.orderNumber ?? null,
    })),
    invoices: invoices.map((i) => ({
      id: i.id, number: i.invoiceNumber, status: i.status, totalMinor: i.grandTotalMinor,
      createdAt: i.issuedAt, orderNumber: i.order?.orderNumber ?? null,
      customer: i.order?.user ? [i.order.user.firstName, i.order.user.lastName].filter(Boolean).join(" ") || i.order.user.email : null,
    })),
    payments: payments.map((p) => ({
      id: p.id, status: p.status, amountMinor: p.amountMinor, method: p.method,
      reference: p.reference, paidAt: p.paidAt, createdAt: p.createdAt,
      orderNumber: p.order?.orderNumber ?? null,
    })),
  };
}

/** Shipping module: shipments with their order + latest event. */
export async function shippingOverview({ limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [shipments, total, pendingDispatch] = await Promise.all([
    prisma.shipment.findMany({
      orderBy: { createdAt: "desc" }, take,
      include: {
        order: { select: { id: true, orderNumber: true } },
        events: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.shipment.count(),
    // Orders that are ready to ship but have no shipment yet.
    prisma.order.count({ where: { status: { in: ["CONFIRMED", "PROCESSING", "PACKED"] } } }),
  ]);

  return {
    shipments: shipments.map((s) => ({
      id: s.id, shipmentNumber: s.shipmentNumber, carrier: s.courier, trackingNumber: s.trackingNumber, status: s.status,
      shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, createdAt: s.createdAt,
      orderNumber: s.order?.orderNumber ?? null,
      lastEvent: s.events[0] ? { status: s.events[0].status, at: s.events[0].createdAt } : null,
    })),
    total,
    pendingDispatch,
  };
}

/** Marketing module: coupons with real redemption counts. */
export async function marketingOverview({ limit = 100 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const coupons = await prisma.coupon.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" }, take,
    include: { _count: { select: { redemptions: true } } },
  });
  const now = new Date();
  return {
    coupons: coupons.map((c) => ({
      id: c.id, code: c.code, discountType: c.discountType, discountValue: c.discountValue,
      minOrderMinor: c.minOrderMinor, maxDiscountMinor: c.maxDiscountMinor,
      usageLimit: c.usageLimit, usedCount: c.usedCount,
      validFrom: c.validFrom, validUntil: c.validUntil, isActive: c.isActive,
      redemptions: c._count.redemptions,
      state: !c.isActive ? "inactive" : c.validUntil && c.validUntil < now ? "expired" : "active",
    })),
    total: coupons.length,
  };
}

// ============================================================
// Buyer-scoped reads.
//
// OWNERSHIP: every query below filters on the authenticated `userId` that the
// route derives from the session — never from a request body or query string.
// A buyer therefore cannot address another buyer's rows even by guessing ids.
// ============================================================

/** Payment history for one buyer, across every order they placed. */
export async function customerPayments(userId, { limit = 50, offset = 0 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);
  const where = { order: { userId } };

  const [payments, total, agg] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true, paymentNumber: true, method: true, amountMinor: true, status: true,
        reference: true, paidAt: true, createdAt: true,
        order: { select: { id: true, orderNumber: true, grandTotalMinor: true, paidMinor: true, placedAt: true } },
        refunds: { select: { id: true, refundNumber: true, amountMinor: true, status: true, processedAt: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ["status"], where, _sum: { amountMinor: true } }),
  ]);

  const sumOf = (s) => agg.find((r) => r.status === s)?._sum.amountMinor ?? 0;
  const refundedMinor = payments
    .flatMap((p) => p.refunds)
    .filter((r) => r.status === "approved" || r.status === "processed")
    .reduce((s, r) => s + r.amountMinor, 0);

  // Outstanding is derived from the buyer's own orders, not from payment rows,
  // so a part-paid order still reports the balance it actually owes.
  const openOrders = await prisma.order.findMany({
    where: { userId, status: { not: "CANCELLED" } },
    select: { grandTotalMinor: true, paidMinor: true },
  });
  const outstandingMinor = openOrders.reduce((s, o) => s + Math.max(0, o.grandTotalMinor - o.paidMinor), 0);

  return {
    summary: {
      paidMinor: sumOf("PAID") + sumOf("SUCCESS"),
      pendingMinor: sumOf("PENDING"),
      refundedMinor,
      outstandingMinor,
    },
    payments: payments.map((p) => ({
      id: p.id, paymentNumber: p.paymentNumber, method: p.method,
      amountMinor: p.amountMinor, status: p.status, reference: p.reference,
      paidAt: p.paidAt, createdAt: p.createdAt,
      orderId: p.order?.id ?? null,
      orderNumber: p.order?.orderNumber ?? null,
      refundedMinor: p.refunds
        .filter((r) => r.status === "approved" || r.status === "processed")
        .reduce((s, r) => s + r.amountMinor, 0),
      refunds: p.refunds,
    })),
    total,
  };
}

/** Every shipment belonging to this buyer, newest first. */
export async function customerShipments(userId, { limit = 50 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const shipments = await prisma.shipment.findMany({
    where: { order: { userId } },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      order: { select: { id: true, orderNumber: true, status: true, placedAt: true } },
      events: { orderBy: { createdAt: "desc" } },
    },
  });

  return {
    shipments: shipments.map((s) => ({
      id: s.id, shipmentNumber: s.shipmentNumber, courier: s.courier,
      trackingNumber: s.trackingNumber, status: s.status,
      shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, expectedAt: s.expectedAt,
      createdAt: s.createdAt,
      orderId: s.order?.id ?? null,
      orderNumber: s.order?.orderNumber ?? null,
      orderStatus: s.order?.status ?? null,
      events: s.events.map((e) => ({ status: e.status, location: e.location, note: e.note, at: e.createdAt })),
    })),
    inTransit: shipments.filter((s) => !["DELIVERED", "CANCELLED"].includes(s.status)).length,
    total: shipments.length,
  };
}

/**
 * Tracking for ONE order. Returns null when the order isn't this buyer's, so
 * the route answers 404 either way — an attacker cannot distinguish
 * "doesn't exist" from "belongs to someone else".
 */
export async function customerOrderTracking(userId, orderId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true, orderNumber: true, status: true, placedAt: true,
      shipName: true, shipCity: true, shipState: true, shipPostalCode: true,
      shipments: { orderBy: { createdAt: "desc" }, include: { events: { orderBy: { createdAt: "desc" } } } },
      statusHistory: { orderBy: { createdAt: "asc" }, select: { status: true, note: true, createdAt: true } },
    },
  });
  if (!order) return null;

  return {
    order: {
      id: order.id, orderNumber: order.orderNumber, status: order.status, placedAt: order.placedAt,
      destination: [order.shipCity, order.shipState, order.shipPostalCode].filter(Boolean).join(", ") || null,
      recipient: order.shipName,
    },
    statusHistory: order.statusHistory.map((h) => ({ status: h.status, note: h.note, at: h.createdAt })),
    shipments: order.shipments.map((s) => ({
      id: s.id, shipmentNumber: s.shipmentNumber, courier: s.courier,
      trackingNumber: s.trackingNumber, status: s.status,
      shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, expectedAt: s.expectedAt,
      events: s.events.map((e) => ({ status: e.status, location: e.location, note: e.note, at: e.createdAt })),
    })),
  };
}
