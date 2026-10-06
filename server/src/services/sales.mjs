// Field sales: order capture for the mobile salesperson portal.
//
// ARCHITECTURAL RULE: this is a CHANNEL, not a second order system. Customers
// and orders are created through the existing CRM service, so a
// salesperson-created order is an ordinary Order row that every admin screen,
// payment ledger, invoice and audit query already understands. The only thing
// this layer adds is attribution (salespersonId), samples, and the scoping
// rules that keep a rep inside their own data.
//
// Customer records are SHARED with attribution: any rep can find and order for
// any customer, and `capturedById` records who first created them. Partitioning
// customers per rep would produce duplicate records the moment two reps meet
// the same buyer, which is exactly what the existing CRM is meant to prevent.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";
import { put, supportedMime, remove } from "../lib/storage.mjs";
import * as crm from "./crm.mjs";

const MAX_SAMPLE_BYTES = 10 * 1024 * 1024; // 10 MB per file, phone-camera sized

/** The profile for the signed-in rep, or a 403 if they are not one. */
export async function requireProfile(user) {
  const profile = await prisma.salespersonProfile.findUnique({ where: { userId: user.id } });
  if (!profile) throw forbidden("No salesperson profile for this account");
  if (profile.status !== "ACTIVE") throw forbidden(`Your account is ${profile.status.toLowerCase()}`);
  return profile;
}

// ---- Admin: manage salespeople -------------------------------------------

/**
 * Admin creates a salesperson login. A rep can never self-register — the role
 * carries write access to customers and payments.
 */
export async function adminCreateSalesperson(adminUser, input = {}) {
  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const employeeId = String(input.employeeId ?? "").trim();
  const password = String(input.password ?? "");
  if (!name) throw badRequest("Name is required", "NAME_REQUIRED");
  if (!email) throw badRequest("Email is required", "EMAIL_REQUIRED");
  if (!employeeId) throw badRequest("Employee ID is required", "EMPLOYEE_ID_REQUIRED");
  if (password.length < 8) throw badRequest("Password must be at least 8 characters", "PASSWORD_WEAK");

  const { hashPassword } = await import("../lib/crypto.mjs");
  const [first, ...rest] = name.split(/\s+/);

  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) {
      throw conflict("An account with this email already exists", "EMAIL_TAKEN");
    }
    if (await tx.salespersonProfile.findUnique({ where: { employeeId } })) {
      throw conflict("That employee ID is already in use", "EMPLOYEE_ID_TAKEN");
    }
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        firstName: first,
        lastName: rest.join(" ") || null,
        phone: input.phone ? String(input.phone).replace(/\D/g, "").slice(-10) : null,
        role: "salesperson",
        isActive: true,
      },
    });
    const profile = await tx.salespersonProfile.create({
      data: {
        userId: user.id,
        employeeId,
        territory: input.territory ?? null,
        branch: input.branch ?? null,
        managerId: input.managerId ?? null,
        joinedAt: input.joinedAt ? new Date(input.joinedAt) : new Date(),
      },
    });
    await recordEvent(
      {
        eventType: "salesperson.created",
        actorId: adminUser.id,
        entityType: "SalespersonProfile",
        entityId: profile.id,
        // Never log the password or its hash.
        metadata: { employeeId, email, territory: profile.territory },
      },
      tx,
    );
    return { ...profile, user: { id: user.id, email: user.email, name } };
  });
}

export async function adminListSalespeople({ status } = {}) {
  const rows = await prisma.salespersonProfile.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true } } },
  });
  return rows.map(shapeProfile);
}

/** Suspend or reactivate. Deliberately no delete: orders must keep their author. */
export async function adminSetStatus(adminUser, profileId, status) {
  if (!["ACTIVE", "SUSPENDED", "LEFT"].includes(status)) throw badRequest("Unknown status", "BAD_STATUS");
  const profile = await prisma.salespersonProfile.findUnique({ where: { id: profileId } });
  if (!profile) return null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.salespersonProfile.update({ where: { id: profileId }, data: { status } });
    // Suspending must also block the login, or the rep keeps their session.
    await tx.user.update({ where: { id: profile.userId }, data: { isActive: status === "ACTIVE" } });
    await recordEvent(
      { eventType: "salesperson.status_changed", actorId: adminUser.id, entityType: "SalespersonProfile", entityId: profileId, metadata: { from: profile.status, to: status } },
      tx,
    );
    return updated;
  });
}

// ---- Rep: customers -------------------------------------------------------

/**
 * Search customers by name, phone or company — the three things a rep knows
 * standing in front of someone. Shared across reps by design.
 */
export async function searchCustomers(query, { take = 20 } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const users = await prisma.user.findMany({
    where: {
      role: "buyer",
      isActive: true,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    take: Math.min(Number(take) || 20, 50),
    orderBy: { updatedAt: "desc" },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true },
  });
  return users.map((u) => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
    phone: u.phone,
    company: u.company,
    email: u.email,
  }));
}

/** Create a customer through the CRM service, recording which rep captured them. */
export async function createCustomer(user, input = {}) {
  const created = await crm.createCustomer(user, input);
  const id = created?.id ?? created?.customer?.id;
  if (id) await prisma.user.update({ where: { id }, data: { capturedById: user.id } });
  return created;
}

/**
 * The card a rep sees after picking a customer: enough history to answer
 * "wahi pichli baar wala box chahiye" without asking anything again.
 */
export async function customerSnapshot(customerId) {
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, company: true },
  });
  if (!customer) return null;

  const orders = await prisma.order.findMany({
    where: { userId: customerId },
    orderBy: { placedAt: "desc" },
    select: {
      id: true, orderNumber: true, grandTotalMinor: true, paidMinor: true,
      status: true, paymentStatus: true, placedAt: true,
      items: { select: { productName: true, quantity: true, unitPriceMinor: true, specs: true } },
    },
  });

  const totalBusinessMinor = orders.reduce((n, o) => n + o.grandTotalMinor, 0);
  const outstandingMinor = orders.reduce((n, o) => n + Math.max(0, o.grandTotalMinor - o.paidMinor), 0);

  return {
    customer: {
      id: customer.id,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email,
      phone: customer.phone,
      company: customer.company,
      email: customer.email,
    },
    orderCount: orders.length,
    lastOrderMinor: orders[0]?.grandTotalMinor ?? 0,
    totalBusinessMinor,
    outstandingMinor,
    // Previous lines are what makes a repeat order a two-tap job.
    recentItems: orders.slice(0, 5).flatMap((o) =>
      o.items.map((i) => ({
        orderNumber: o.orderNumber,
        productName: i.productName,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
        specs: i.specs,
        orderedAt: o.placedAt,
      })),
    ),
    recentOrders: orders.slice(0, 10).map((o) => ({
      id: o.id, orderNumber: o.orderNumber, grandTotalMinor: o.grandTotalMinor,
      paidMinor: o.paidMinor, status: o.status, paymentStatus: o.paymentStatus, placedAt: o.placedAt,
    })),
  };
}

// ---- Rep: orders ----------------------------------------------------------

/**
 * Capture an order. Delegates to crm.createOrder so pricing, payment status
 * and audit behave exactly as an admin-raised order, then stamps attribution.
 */
export async function createOrder(user, input = {}) {
  const profile = await requireProfile(user);
  const order = await crm.createOrder(user, { ...input, source: "offline" });
  const orderId = order?.id ?? order?.order?.id;
  if (!orderId) return order;

  await prisma.order.update({ where: { id: orderId }, data: { salespersonId: user.id } });
  await recordEvent({
    eventType: "sales.order_captured",
    actorId: user.id,
    entityType: "Order",
    entityId: orderId,
    metadata: { employeeId: profile.employeeId, customerId: input.customerId },
  });
  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true, samples: true } });
}

/** A rep sees their own captured orders only. */
export async function listMyOrders(user, { from, to, paymentStatus, take = 50 } = {}) {
  const where = {
    salespersonId: user.id,
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(from || to
      ? { placedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } }
      : {}),
  };
  const orders = await prisma.order.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: Math.min(Number(take) || 50, 200),
    include: {
      items: { select: { productName: true, quantity: true } },
      user: { select: { firstName: true, lastName: true, company: true } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customer: o.user?.company || [o.user?.firstName, o.user?.lastName].filter(Boolean).join(" ") || "—",
    grandTotalMinor: o.grandTotalMinor,
    paidMinor: o.paidMinor,
    balanceMinor: Math.max(0, o.grandTotalMinor - o.paidMinor),
    status: o.status,
    paymentStatus: o.paymentStatus,
    itemCount: o.items.length,
    placedAt: o.placedAt,
  }));
}

/** One of the rep's own orders; someone else's returns null so the route 404s. */
export async function getMyOrder(user, orderId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, salespersonId: user.id },
    include: { items: true, samples: true, payments: true, user: { select: { firstName: true, lastName: true, phone: true, company: true } } },
  });
  return order ?? null;
}

// ---- Samples --------------------------------------------------------------

/**
 * Attach a customer sample (photo/PDF) to a captured order.
 *
 * Goes through storage.mjs, so in production these land in Spaces and survive
 * a deploy — a reference photo the rep took in front of the customer must not
 * disappear on the next release.
 */
export async function addSample(user, orderId, input = {}) {
  await requireProfile(user);
  const order = await prisma.order.findFirst({ where: { id: orderId, salespersonId: user.id }, select: { id: true } });
  if (!order) return null;

  const mime = String(input.mime ?? "");
  if (!supportedMime(mime)) throw badRequest("Sample must be a JPG, PNG, WEBP or PDF", "UNSUPPORTED_TYPE");
  let buffer;
  try {
    buffer = Buffer.from(String(input.dataBase64 ?? ""), "base64");
  } catch {
    throw badRequest("Sample data is not valid base64", "BAD_DATA");
  }
  if (buffer.length === 0) throw badRequest("Sample file is empty", "EMPTY_FILE");
  if (buffer.length > MAX_SAMPLE_BYTES) throw badRequest("Sample must be under 10 MB", "FILE_TOO_LARGE");

  const fileName = String(input.fileName ?? "sample").slice(0, 120);
  const storageKey = await put({ name: fileName, mime, buffer });

  return prisma.salesOrderSample.create({
    data: { orderId, storageKey, fileName, mimeType: mime, sizeBytes: buffer.length, caption: input.caption ?? null, uploadedById: user.id },
  });
}

export async function removeSample(user, orderId, sampleId) {
  const sample = await prisma.salesOrderSample.findFirst({
    where: { id: sampleId, orderId, order: { salespersonId: user.id } },
  });
  if (!sample) return null;
  await prisma.salesOrderSample.delete({ where: { id: sample.id } });
  // Best-effort: an orphaned object costs storage, not correctness.
  await remove(sample.storageKey).catch(() => {});
  return sample;
}

// ---- KPIs -----------------------------------------------------------------

/**
 * One rep's numbers for a window. Money is summed from the orders themselves
 * rather than stored, so it can never drift from the ledger.
 */
export async function salespersonKpis(salespersonId, { from, to } = {}) {
  const range = from || to
    ? { placedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) } }
    : {};
  const orders = await prisma.order.findMany({
    where: { salespersonId, ...range },
    select: { grandTotalMinor: true, paidMinor: true, status: true, userId: true, placedAt: true },
  });

  const salesMinor = orders.reduce((n, o) => n + o.grandTotalMinor, 0);
  const collectedMinor = orders.reduce((n, o) => n + o.paidMinor, 0);
  const outstandingMinor = orders.reduce((n, o) => n + Math.max(0, o.grandTotalMinor - o.paidMinor), 0);
  const cancelled = orders.filter((o) => o.status === "CANCELLED").length;

  // A customer is "new" when their first order anywhere is one of these.
  const customerIds = [...new Set(orders.map((o) => o.userId))];
  const firstOrders = customerIds.length
    ? await prisma.order.groupBy({ by: ["userId"], where: { userId: { in: customerIds } }, _min: { placedAt: true } })
    : [];
  const firstById = new Map(firstOrders.map((f) => [f.userId, f._min.placedAt?.getTime()]));
  const newCustomers = orders.filter((o) => firstById.get(o.userId) === o.placedAt.getTime()).length;

  return {
    orders: orders.length,
    salesMinor,
    collectedMinor,
    outstandingMinor,
    averageOrderMinor: orders.length ? Math.round(salesMinor / orders.length) : 0,
    collectionRateBps: salesMinor > 0 ? Math.round((collectedMinor / salesMinor) * 10_000) : 0,
    newCustomers,
    repeatCustomers: Math.max(0, customerIds.length - newCustomers),
    cancelled,
  };
}

/** Leaderboard across every rep, for the admin Sales dashboard. */
export async function adminSalesPerformance({ from, to } = {}) {
  const profiles = await prisma.salespersonProfile.findMany({
    include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });
  const rows = await Promise.all(
    profiles.map(async (p) => ({
      salespersonId: p.userId,
      employeeId: p.employeeId,
      name: [p.user.firstName, p.user.lastName].filter(Boolean).join(" ") || p.user.email,
      territory: p.territory,
      status: p.status,
      ...(await salespersonKpis(p.userId, { from, to })),
    })),
  );
  return rows.sort((a, b) => b.salesMinor - a.salesMinor);
}

function shapeProfile(p) {
  return {
    id: p.id,
    userId: p.userId,
    employeeId: p.employeeId,
    name: [p.user?.firstName, p.user?.lastName].filter(Boolean).join(" ") || p.user?.email,
    email: p.user?.email,
    phone: p.user?.phone,
    territory: p.territory,
    branch: p.branch,
    status: p.status,
    isActive: p.user?.isActive,
    joinedAt: p.joinedAt,
  };
}
