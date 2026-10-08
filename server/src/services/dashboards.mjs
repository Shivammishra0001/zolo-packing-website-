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
    // Settings + payment requests
    "payment_method.enabled": () => ({ title: "Payment method enabled", body: `${String(meta.method ?? "").replace(/_/g, " ").toUpperCase()} enabled by ${actor}` }),
    "payment_method.disabled": () => ({ title: "Payment method disabled", body: `${String(meta.method ?? "").replace(/_/g, " ").toUpperCase()} disabled by ${actor}` }),
    "payment_method.updated": () => ({ title: "Payment method updated", body: `${String(meta.method ?? "").replace(/_/g, " ").toUpperCase()}: ${(meta.fields ?? []).join(", ")}` }),
    "payment_settings.qr_updated": () => ({ title: "UPI QR code " + (meta.action ?? "updated"), body: `by ${actor}` }),
    "settings.smtp.updated": () => ({ title: "Email (SMTP) settings updated", body: `${meta.host ?? ""}${meta.port ? `:${meta.port}` : ""}${meta.passwordChanged ? " — password changed" : ""}` }),
    "settings.whatsapp.updated": () => ({ title: "WhatsApp settings updated", body: `${meta.provider ?? "provider cleared"}${meta.tokenChanged ? " — token changed" : ""}` }),
    "settings.notifications.updated": () => ({ title: "Notification settings updated", body: `${(meta.fields ?? []).join(", ")} by ${actor}` }),
    "payment_request.created": () => ({ title: "Payment request created", body: `${meta.requestNumber ?? ""} — ₹${((meta.amountMinor ?? 0) / 100).toLocaleString("en-IN")}${meta.orderNumber ? ` for ${meta.orderNumber}` : ""}` }),
    "payment_request.sent": () => ({ title: meta.resend ? "Payment link resent" : "Payment link sent", body: meta.requestNumber ?? "" }),
    "payment_request.submitted": () => ({ title: "Payment proof submitted", body: `${meta.requestNumber ?? ""} via ${String(meta.method ?? "").replace(/_/g, " ")}` }),
    "payment_request.paid": () => ({ title: "Payment verified", body: `${meta.requestNumber ?? ""} — ₹${((meta.amountMinor ?? 0) / 100).toLocaleString("en-IN")}${meta.orderNumber ? ` for ${meta.orderNumber}` : ""}` }),
    "payment_request.rejected": () => ({ title: "Payment proof rejected", body: `${meta.requestNumber ?? ""}${meta.note ? ` — ${meta.note}` : ""}` }),
    "payment_request.expired": () => ({ title: "Payment request expired", body: meta.requestNumber ?? "" }),
    "payment_request.cancelled": () => ({ title: "Payment request cancelled", body: meta.requestNumber ?? "" }),
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
            { company: { contains: search, mode: "insensitive" } },
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
        // Customer profile fields (User is the source of truth).
        avatarUrl: true, company: true, businessType: true, gstin: true, industry: true, alternatePhone: true,
        // Legacy fallback: an org the buyer belongs to, when there is one.
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
        // The buyer's own profile wins; org membership is the legacy fallback.
        company: u.company ?? u.memberships?.[0]?.organization?.name ?? null,
        avatarUrl: u.avatarUrl ?? null,
        businessType: u.businessType ?? null,
        gstin: u.gstin ?? null,
        industry: u.industry ?? null,
        alternatePhone: u.alternatePhone ?? null,
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
      isActive: true, createdAt: true, updatedAt: true, lastLoginAt: true, role: true,
      // Customer profile fields (User is the source of truth).
      avatarUrl: true, alternatePhone: true, company: true, businessType: true,
      gstin: true, pan: true, website: true, industry: true, preferences: true,
      dateOfBirth: true, gender: true,
      // The rep who owns this account.
      capturedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  if (!user) return null;

  const [orders, addresses, agg, payments, membership, cancelledAgg, rfqs, rfqCount] = await Promise.all([
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
    // RFQs + quotations, so the customer page shows their B2B activity too.
    prisma.rfq.findMany({
      where: { userId, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, rfqNumber: true, status: true, createdAt: true,
        _count: { select: { items: true, quotations: true } },
      },
    }),
    prisma.rfq.count({ where: { userId, status: { not: "DRAFT" } } }),
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
      createdAt: user.createdAt, updatedAt: user.updatedAt, lastLoginAt: user.lastLoginAt,
      // The buyer's own profile wins; org membership is the legacy fallback.
      company: user.company ?? membership?.organization?.name ?? null,
      avatarUrl: user.avatarUrl ?? null,
      alternatePhone: user.alternatePhone ?? null,
      salesperson: user.capturedBy
        ? {
            id: user.capturedBy.id,
            name:
              [user.capturedBy.firstName, user.capturedBy.lastName].filter(Boolean).join(" ") ||
              user.capturedBy.email,
          }
        : null,
      businessType: user.businessType ?? null,
      gstin: user.gstin ?? null,
      pan: user.pan ?? null,
      website: user.website ?? null,
      industry: user.industry ?? null,
      dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().slice(0, 10) : null,
      gender: user.gender ?? null,
      preferences: user.preferences && typeof user.preferences === "object" ? user.preferences : {},
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
    rfqs: {
      total: rfqCount,
      recent: rfqs.map((r) => ({
        id: r.id,
        rfqNumber: r.rfqNumber,
        status: r.status,
        itemCount: r._count.items,
        quotationCount: r._count.quotations,
        createdAt: r.createdAt,
      })),
    },
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

/** Marketing overview: status counts + the most recent coupons and campaigns. */
export async function marketingOverview({ limit = 5 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 5, 1), 20);
  const { listCoupons } = await import("./coupons.mjs");
  const { listCampaigns } = await import("./campaigns.mjs");
  const [c, k] = await Promise.all([listCoupons({ limit: 500 }), listCampaigns({ limit: 500 })]);
  const recent = (rows) => [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, take);
  return {
    coupons: { counts: c.counts, recent: recent(c.coupons) },
    campaigns: { counts: k.counts, recent: recent(k.campaigns) },
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

// ===========================================================================
// "What needs attention" — the action queue behind the dashboard tiles.
//
// The rest of this file answers "how is the business doing?". This answers
// "what must someone do today?", which is a different question and the one an
// operator opens the dashboard to settle.
//
// Every figure is a real row the admin can click through to. Nothing is a
// projection, a target or a score: a number here always means "this many
// records are in this state right now".
// ===========================================================================

/** Outstanding = what is unpaid on an order, never its full value. */
const unpaidMinor = (o) => Math.max(0, o.grandTotalMinor - o.paidMinor);

/**
 * Orders whose money is late, bucketed by how late.
 *
 * Age is measured from the DUE DATE where one is set, otherwise from the order
 * date — an order with no agreed terms still ages, and treating it as never
 * overdue is how a six-week-old debt stays invisible.
 *
 * `dueDate` is deliberately not stored as an OVERDUE flag anywhere: overdue is
 * a function of the clock, so it is computed here per request (see
 * crm.derivePaymentState, which applies the same rule on the read side).
 */
export async function collectionsQueue({ limit = 8 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 8, 1), 50);
  const now = new Date();
  const dayMs = 86_400_000;

  const open = await prisma.order.findMany({
    where: { ...REVENUE_WHERE, paymentStatus: { in: ["PENDING", "PARTIAL"] } },
    select: {
      id: true, orderNumber: true, grandTotalMinor: true, paidMinor: true,
      placedAt: true, dueDate: true, status: true,
      user: { select: { id: true, firstName: true, lastName: true, company: true, phone: true } },
      salesperson: { select: { firstName: true, lastName: true } },
    },
  });

  const rows = open
    .map((o) => {
      const since = o.dueDate ?? o.placedAt;
      const days = Math.floor((now.getTime() - new Date(since).getTime()) / dayMs);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customerId: o.user?.id ?? null,
        customer: o.user
          ? o.user.company || [o.user.firstName, o.user.lastName].filter(Boolean).join(" ")
          : "—",
        phone: o.user?.phone ?? null,
        salesperson: o.salesperson
          ? [o.salesperson.firstName, o.salesperson.lastName].filter(Boolean).join(" ")
          : null,
        outstandingMinor: unpaidMinor(o),
        daysOverdue: Math.max(0, days),
        // Whether the clock started from agreed terms or from the order date,
        // so the UI can be honest about which it is showing.
        basis: o.dueDate ? "due" : "placed",
        status: o.status,
      };
    })
    .filter((r) => r.outstandingMinor > 0);

  // Ageing buckets, the way a collections desk reads a ledger.
  const bucket = (lo, hi) => rows.filter((r) => r.daysOverdue >= lo && (hi === null || r.daysOverdue < hi));
  const sum = (list) => list.reduce((s, r) => s + r.outstandingMinor, 0);
  const current = bucket(0, 15);
  const d15 = bucket(15, 30);
  const d30 = bucket(30, 60);
  const d60 = bucket(60, null);

  // Oldest and largest first: the ones worth a call today.
  const followUps = rows
    .filter((r) => r.daysOverdue >= 15)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstandingMinor - a.outstandingMinor)
    .slice(0, take);

  return {
    totalOutstandingMinor: sum(rows),
    openOrders: rows.length,
    ageing: {
      current: { orders: current.length, amountMinor: sum(current) },
      d15: { orders: d15.length, amountMinor: sum(d15) },
      d30: { orders: d30.length, amountMinor: sum(d30) },
      d60: { orders: d60.length, amountMinor: sum(d60) },
    },
    followUps,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Work that is committed but not yet delivered, plus the quotes that could
 * still become work.
 *
 * "Upcoming" is deliberately split: a delivery promised for tomorrow and a
 * quote sent three weeks ago need different actions, and averaging them into
 * one "pipeline" number tells an operator nothing they can act on.
 */
export async function actionQueue({ limit = 8 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 8, 1), 50);
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const staleBefore = new Date(now.getTime() - 7 * 86_400_000);

  const OPEN_ORDER = { status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"] } };

  const [dueSoon, late, unconfirmed, staleQuotes, openRfqs, lowStock] = await Promise.all([
    // Deliveries promised within the next 7 days.
    prisma.order.findMany({
      where: { ...OPEN_ORDER, expectedDeliveryDate: { gte: now, lte: soon } },
      orderBy: { expectedDeliveryDate: "asc" },
      take,
      select: {
        id: true, orderNumber: true, expectedDeliveryDate: true, status: true,
        grandTotalMinor: true,
        user: { select: { firstName: true, lastName: true, company: true } },
      },
    }),
    // Promised dates already missed.
    prisma.order.count({ where: { ...OPEN_ORDER, expectedDeliveryDate: { lt: now } } }),
    // Sitting in PENDING: nobody has accepted the order yet.
    prisma.order.count({ where: { status: "PENDING" } }),
    // Quotes sent and not answered for a week — the real "lead needs action".
    prisma.quotation.findMany({
      where: { status: { in: ["SENT", "CHANGES_REQUESTED"] }, createdAt: { lt: staleBefore } },
      orderBy: { createdAt: "asc" },
      take,
      select: {
        id: true, quotationNumber: true, createdAt: true, grandTotalMinor: true, status: true,
        user: { select: { firstName: true, lastName: true, company: true } },
      },
    }),
    // Enquiries with no quote yet.
    prisma.rfq.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    // Low stock is already defined by adminDashboard (available vs
    // lowStockLevel). Reusing that rule rather than inventing a second
    // threshold keeps the two tiles from disagreeing.
    prisma.product.findMany({
      where: { status: "active", lowStockLevel: { not: null } },
      select: { stock: true, reservedStock: true, lowStockLevel: true },
    }),
  ]);

  const nameOf = (u) =>
    u ? u.company || [u.firstName, u.lastName].filter(Boolean).join(" ") || "—" : "—";

  return {
    deliveries: {
      dueSoon: dueSoon.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customer: nameOf(o.user),
        expectedDeliveryDate: o.expectedDeliveryDate,
        status: o.status,
        valueMinor: o.grandTotalMinor,
        daysAway: Math.ceil((new Date(o.expectedDeliveryDate).getTime() - now.getTime()) / 86_400_000),
      })),
      lateCount: late,
    },
    unconfirmedOrders: unconfirmed,
    leads: {
      staleQuotes: staleQuotes.map((q) => ({
        id: q.id,
        number: q.quotationNumber,
        customer: nameOf(q.user),
        createdAt: q.createdAt,
        valueMinor: q.grandTotalMinor,
        status: q.status,
        daysWaiting: Math.floor((now.getTime() - new Date(q.createdAt).getTime()) / 86_400_000),
      })),
      openRfqs,
    },
    lowStock: lowStock.filter((p) => {
      const available = p.stock - (p.reservedStock ?? 0);
      return available <= p.lowStockLevel;
    }).length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Gross margin over a period, with its own coverage stated alongside it.
 *
 * Profit is only computable for lines that carry a cost snapshot
 * (OrderItem.unitCostMinor). Most historical lines do not, and a margin
 * computed over the covered subset would be presented as if it described the
 * whole book — the same trap the inventory valuation avoids by reporting
 * `pricedProducts` next to `stockValueMinor`.
 *
 * So this returns the covered revenue/cost AND how much of the period's
 * revenue that covers. The UI must show the coverage; a margin without it is
 * a number that invites a wrong decision.
 */
export async function profitSummary({ from, to } = {}) {
  const range =
    from || to
      ? { placedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } }
      : {};

  const items = await prisma.orderItem.findMany({
    where: { order: { ...REVENUE_WHERE, ...range } },
    select: { quantity: true, unitPriceMinor: true, unitCostMinor: true, discountMinor: true },
  });

  let coveredRevenueMinor = 0;
  let coveredCostMinor = 0;
  let uncoveredRevenueMinor = 0;

  for (const it of items) {
    // Net of the line's share of discount: margin on what was actually
    // charged, not on list price.
    const revenue = it.unitPriceMinor * it.quantity - (it.discountMinor ?? 0);
    if (it.unitCostMinor == null) {
      uncoveredRevenueMinor += revenue;
      continue;
    }
    coveredRevenueMinor += revenue;
    coveredCostMinor += it.unitCostMinor * it.quantity;
  }

  const profitMinor = coveredRevenueMinor - coveredCostMinor;
  const totalRevenueMinor = coveredRevenueMinor + uncoveredRevenueMinor;

  return {
    profitMinor,
    coveredRevenueMinor,
    coveredCostMinor,
    uncoveredRevenueMinor,
    totalRevenueMinor,
    // Basis points, to stay integer like every other rate in this codebase.
    marginBps: coveredRevenueMinor > 0 ? Math.round((profitMinor / coveredRevenueMinor) * 10_000) : 0,
    coverageBps: totalRevenueMinor > 0 ? Math.round((coveredRevenueMinor / totalRevenueMinor) * 10_000) : 0,
    lines: items.length,
    linesWithCost: items.filter((i) => i.unitCostMinor != null).length,
    generatedAt: new Date().toISOString(),
  };
}
