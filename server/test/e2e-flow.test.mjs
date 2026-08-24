// End-to-end: one customer journey, checked at every hand-off.
//
// CUSTOMER ACTION → API → POSTGRESQL → EVENT → ADMIN DASHBOARD → CUSTOMER
// DASHBOARD → NOTIFICATION → AUDIT LOG
//
// This is the test that fails if any link in that chain is quietly broken.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, unique, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

let adminTok;
let product;

before(async () => {
  await startServer();
  // Self-provisioning: never depend on a seeded account existing.
  adminTok = await adminToken();

  product = await prisma.product.upsert({
    where: { sku: "TST-E2E-PRODUCT" },
    update: { stock: 500, reservedStock: 0, basePriceMinor: 40000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-E2E${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-E2E-PRODUCT", slug: `tst-e2e-product-${Date.now()}`,
      name: "E2E Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 40000, moq: 1, stock: 500, lowStockLevel: 10,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-E2E-PRODUCT" } }).catch(() => {});
  await stopServer();
});

test("a full customer journey lands in every admin module without a manual refresh", async () => {
  // --- 1. Register -----------------------------------------------------------
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Journey", lastName: "Customer", accountType: "buyer" } });
  assert.equal(reg.status, 201);
  const token = reg.body.data.accessToken;
  const userId = reg.body.data.user.id;

  // Admin sees the customer immediately.
  const customers = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminTok });
  assert.ok(customers.body.data.customers.some((c) => c.id === userId), "→ Customers module");

  // --- 2. Browse + cart ------------------------------------------------------
  const cartAdd = await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 3 } });
  assert.ok([200, 201].includes(cartAdd.status), JSON.stringify(cartAdd.body).slice(0, 160));

  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Journey Customer", phone: "9876543210",
    line1: "42 Journey Rd", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });

  // --- 3. Place the order ----------------------------------------------------
  const before = await api("/admin/dashboard", { token: adminTok });
  const ordersBefore = before.body.data.orders.total;

  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod: "neft", idempotencyKey: `e2e-${Math.random()}` } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body).slice(0, 200));
  const order = placed.body.data;

  // POSTGRESQL: order + items + payment + invoice + history, all in one write.
  const row = await prisma.order.findUnique({
    where: { id: order.id },
    include: { items: true, payments: true, invoice: true, statusHistory: true },
  });
  assert.equal(row.items.length, 1, "order_items written");
  assert.equal(row.payments.length, 1, "payment record written");
  assert.ok(row.invoice, "invoice written");
  assert.ok(row.statusHistory.length >= 1, "status history written");

  // EVENT + AUDIT LOG
  const placedEvent = await prisma.auditLog.findFirst({ where: { eventType: "order.placed", entityId: order.id } });
  assert.ok(placedEvent, "order.placed audit entry");

  // ADMIN DASHBOARD — the KPI moved.
  const afterPlace = await api("/admin/dashboard", { token: adminTok });
  assert.ok(afterPlace.body.data.orders.total > ordersBefore, "dashboard order count advanced");
  assert.ok(
    afterPlace.body.data.recentOrders.some((o) => o.id === order.id),
    "→ dashboard recent orders",
  );

  // ADMIN ORDERS module
  const adminOrders = await api(`/admin/orders?search=${order.orderNumber}`, { token: adminTok });
  assert.ok(adminOrders.body.data.orders.some((o) => o.id === order.id), "→ Orders module");

  // CUSTOMER DASHBOARD
  const mine = await api("/orders", { token });
  assert.ok(mine.body.data.some((o) => o.id === order.id), "→ customer's My Orders");

  // NOTIFICATION — both sides.
  assert.ok(await prisma.notification.count({ where: { userId, type: "order.placed" } }), "customer notified");

  // --- 4. Confirm the payment ------------------------------------------------
  const payRes = await api(`/admin/payments/${row.payments[0].id}`, {
    method: "PATCH", token: adminTok, body: { status: "PAID", reference: "NEFT-E2E-1" } });
  assert.equal(payRes.status, 200);

  const paid = await prisma.order.findUnique({ where: { id: order.id }, include: { invoice: true } });
  assert.equal(paid.paymentStatus, "PAID", "order payment status follows the payment");
  assert.equal(paid.invoice.status, "paid", "invoice follows the payment");

  const finance = await api("/admin/finance", { token: adminTok });
  assert.ok(finance.body.data.payments.some((p) => p.orderNumber === order.orderNumber), "→ Finance module");

  // --- 5. Fulfil -------------------------------------------------------------
  await api(`/admin/orders/${order.id}/status`, { method: "PATCH", token: adminTok, body: { status: "CONFIRMED" } });
  await api(`/admin/orders/${order.id}/status`, { method: "PATCH", token: adminTok, body: { status: "PROCESSING" } });
  await api(`/admin/orders/${order.id}/status`, { method: "PATCH", token: adminTok, body: { status: "PACKED" } });

  const shipRes = await api(`/admin/orders/${order.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "BlueDart", trackingNumber: "BD-E2E-1" } });
  assert.equal(shipRes.status, 201);
  const shipmentId = shipRes.body.data.shipment.id;

  for (const status of ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    const r = await api(`/admin/shipments/${shipmentId}/events`, {
      method: "POST", token: adminTok, body: { status, location: "Bengaluru" } });
    assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.body).slice(0, 160)}`);
  }

  // --- 6. Everything reconciles ---------------------------------------------
  const done = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(done.status, "DELIVERED", "order reached DELIVERED");

  const shipping = await api("/admin/shipping", { token: adminTok });
  assert.ok(shipping.body.data.shipments.some((s) => s.orderNumber === order.orderNumber), "→ Shipping module");

  // The customer reads the same fulfilment the admin wrote.
  const custView = await api(`/orders/${order.id}`, { token });
  assert.equal(custView.body.data.status, "DELIVERED", "customer sees the same status");

  // ACTIVITY FEED carries the whole journey.
  const feed = await api("/admin/activity?limit=100", { token: adminTok });
  const kinds = new Set(feed.body.data.activity.map((e) => e.eventType));
  for (const kind of ["user.registered", "order.placed", "payment.updated", "shipment.created", "shipment.status_changed"]) {
    assert.ok(kinds.has(kind), `activity feed carries ${kind}`);
  }

  // NOTIFICATIONS across the journey.
  const notified = await prisma.notification.count({ where: { userId } });
  assert.ok(notified >= 5, `customer notified at each step (got ${notified})`);
});
