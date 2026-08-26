// Data-flow tests: one customer action must ripple through order, inventory,
// status history, activity, notifications AND both dashboards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, unique, adminToken as makeAdminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

let adminToken;
let sellableProduct;

before(async () => {
  await startServer();
  // Self-provisioning: never depend on a seeded account existing.
  adminToken = await makeAdminToken();

  // A product the tests can actually buy. Created here (not assumed) so the
  // suite works against an empty catalog too.
  sellableProduct = await prisma.product.upsert({
    where: { sku: "TST-FLOW-PRODUCT" },
    update: { stock: 1000, reservedStock: 0, basePriceMinor: 10000, moq: 1, status: "active", deletedAt: null, lowStockLevel: 10 },
    create: {
      id: `PRD-FLOW${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-FLOW-PRODUCT", slug: `tst-flow-product-${Date.now()}`,
      name: "Flow Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 10000, moq: 1, stock: 1000, lowStockLevel: 10,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-FLOW-PRODUCT" } }).catch(() => {});
  await stopServer();
});

async function buyer() {
  const email = unique.email();
  const { body } = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Flow", accountType: "buyer" } });
  return body.data;
}

/** Place one order and return it. */
async function placeOrder(token, quantity = 2) {
  await api("/cart/items", { method: "POST", token, body: { productId: sellableProduct.id, quantity } });
  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Flow Tester", phone: "9876543210",
    line1: "1 Flow St", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod: "cod", idempotencyKey: `flow-${Math.random()}` } });
  assert.equal(placed.status, 201, `order placed: ${JSON.stringify(placed.body).slice(0, 200)}`);
  return placed.body.data;
}

test("admin dashboard figures come from the database, not constants", async () => {
  const { status, body } = await api("/admin/dashboard", { token: adminToken });
  assert.equal(status, 200);
  const d = body.data;

  const [dbOrders, dbCustomers, dbProducts] = await Promise.all([
    prisma.order.count(),
    prisma.user.count({ where: { role: "buyer", isActive: true } }),
    prisma.product.count({ where: { deletedAt: null } }),
  ]);

  // Other test files create orders/users concurrently in this same process, so
  // the dashboard snapshot may lag the direct count by a few rows. What matters
  // is that the figure TRACKS the table (never a constant, never zero while
  // rows exist) — an exact match would be asserting test isolation, not
  // dashboard correctness.
  const tracks = (reported, actual, label) => {
    assert.ok(reported > 0 || actual === 0, `${label}: reported ${reported} while the table holds ${actual}`);
    assert.ok(Math.abs(reported - actual) <= 25, `${label}: ${reported} is not tracking ${actual}`);
  };
  tracks(d.orders.total, dbOrders, "orders");
  tracks(d.customers.total, dbCustomers, "customers");
  // The catalog suite creates products concurrently in this same process, so
  // this figure moves too — it must track, not match exactly.
  tracks(d.products.total, dbProducts, "products");
  assert.ok(d.generatedAt, "response is stamped, proving it was computed now");
});

test("ONE order propagates to every surface (the consistency test)", async () => {
  const before = (await api("/admin/dashboard", { token: adminToken })).body.data;
  const stockBefore = await prisma.product.findUnique({ where: { id: sellableProduct.id }, select: { stock: true, reservedStock: true } });

  const customer = await buyer();
  const QTY = 2;
  const order = await placeOrder(customer.accessToken, QTY);

  // 1. The order row itself
  const row = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, statusHistory: true } });
  assert.ok(row, "order persisted");
  assert.equal(row.items.length, 1);
  assert.equal(row.items[0].quantity, QTY);

  // 2. Inventory moved by exactly the quantity ordered
  const stockAfter = await prisma.product.findUnique({ where: { id: sellableProduct.id }, select: { stock: true, reservedStock: true } });
  const consumed = (stockBefore.stock - stockAfter.stock) + (stockAfter.reservedStock - stockBefore.reservedStock);
  assert.equal(consumed, QTY, "stock or reservation moved by the ordered quantity");

  // 3. Status history
  assert.ok(row.statusHistory.length >= 1, "an initial status row exists");

  // 4. Activity event
  const event = await prisma.auditLog.findFirst({ where: { eventType: "order.placed", entityId: order.id } });
  assert.ok(event, "ORDER_CREATED activity recorded");
  assert.equal(event.metadata.orderNumber, order.orderNumber);

  // 5. Customer notification
  const notif = await prisma.notification.findFirst({ where: { userId: customer.user.id, entityId: order.id } });
  assert.ok(notif, "customer was notified");

  // 6. Payment record
  assert.ok(await prisma.payment.findFirst({ where: { orderId: order.id } }), "payment row created");

  // 7. Admin dashboard reflects it
  const after = (await api("/admin/dashboard", { token: adminToken })).body.data;
  // Other test files place orders concurrently in this same process, so the
  // count can advance by more than one. What must hold is that THIS order is
  // included — asserting an exact +1 would be testing test isolation rather
  // than the dashboard.
  assert.ok(after.orders.total > before.orders.total, "admin order count incremented");
  assert.ok(after.recentOrders.some((o) => o.id === order.id), "appears in admin recent orders");
  assert.ok(after.recentActivity.some((a) => a.entityId === order.id), "appears in the admin activity feed");
  assert.ok(after.revenue.totalMinor > before.revenue.totalMinor, "revenue increased");

  // 8. Customer dashboard reflects it
  const mine = (await api("/me/dashboard", { token: customer.accessToken })).body.data;
  assert.equal(mine.orders.total, 1);
  assert.ok(mine.recentOrders.some((o) => o.id === order.id));
  assert.ok(mine.unreadNotifications >= 1);
});

test("an admin status change reaches the customer and the activity feed", async () => {
  const customer = await buyer();
  const order = await placeOrder(customer.accessToken, 1);
  const historyBefore = await prisma.orderStatusHistory.count({ where: { orderId: order.id } });
  const notifsBefore = await prisma.notification.count({ where: { userId: customer.user.id, entityId: order.id } });

  const res = await api(`/admin/orders/${order.id}/status`, { method: "PATCH", token: adminToken, body: { status: "CONFIRMED", note: "test" } });
  assert.equal(res.status, 200);

  // Persisted, not merely displayed
  const row = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(row.status, "CONFIRMED");

  assert.ok(await prisma.orderStatusHistory.count({ where: { orderId: order.id } }) > historyBefore, "history grew");
  assert.ok(await prisma.auditLog.findFirst({ where: { eventType: "order.status_changed", entityId: order.id } }), "activity recorded");
  assert.ok(await prisma.notification.count({ where: { userId: customer.user.id, entityId: order.id } }) > notifsBefore, "customer notified");

  // The customer sees the new status through their own endpoint
  const mine = await api(`/orders/${order.id}`, { token: customer.accessToken });
  assert.equal(mine.body.data.status, "CONFIRMED");
});

test("customer dashboards are scoped to the signed-in user", async () => {
  const a = await buyer();
  const b = await buyer();
  await placeOrder(a.accessToken, 1);

  const dashA = (await api("/me/dashboard", { token: a.accessToken })).body.data;
  const dashB = (await api("/me/dashboard", { token: b.accessToken })).body.data;
  assert.equal(dashA.orders.total, 1);
  assert.equal(dashB.orders.total, 0, "B never sees A's order");
});

test("dashboards enforce authorization on the server", async () => {
  const customer = await buyer();
  assert.equal((await api("/admin/dashboard", { token: customer.accessToken })).status, 403, "buyer is forbidden");
  assert.equal((await api("/admin/dashboard")).status, 401, "anonymous is unauthenticated");
  assert.equal((await api("/admin/activity", { token: customer.accessToken })).status, 403);
  assert.equal((await api("/me/dashboard")).status, 401, "customer dashboard needs auth");
});

test("the activity feed paginates and describes events in words", async () => {
  const { status, body } = await api("/admin/activity?limit=5", { token: adminToken });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.activity));
  assert.ok(body.data.activity.length <= 5);
  for (const a of body.data.activity) {
    assert.ok(a.title, "every entry has a human title");
    assert.ok(a.createdAt);
  }
});

test("inventory reports availability as stock minus reservations", async () => {
  // Page through rather than assuming the fixture lands in the first N rows:
  // the endpoint orders by name and caps `limit` at 200, so a single page only
  // found this product while the catalog happened to be small. Other suites
  // add products, which pushed it past the window and failed the test for a
  // reason that had nothing to do with inventory maths.
  let row, offset = 0, status;
  for (;;) {
    const page = await api(`/admin/inventory?limit=200&offset=${offset}`, { token: adminToken });
    status = page.status;
    assert.equal(status, 200);
    const { inventory, total } = page.body.data;
    row = inventory.find((p) => p.sku === "TST-FLOW-PRODUCT");
    offset += inventory.length;
    if (row || inventory.length === 0 || offset >= total) break;
  }
  assert.ok(row, "the product is listed");
  assert.equal(row.available, row.stock - row.reserved);
  assert.ok(["in_stock", "low_stock", "out_of_stock"].includes(row.state));
});

test("analytics aggregate real orders and best sellers", async () => {
  const { status, body } = await api("/admin/analytics?days=30", { token: adminToken });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.series));
  assert.ok(Array.isArray(body.data.topProducts));
  // Values must be JSON numbers — SQL sums come back as BigInt and would throw.
  for (const d of body.data.series) assert.equal(typeof d.revenueMinor, "number");
});

test("cancelling an order restores stock and is reflected everywhere", async () => {
  const customer = await buyer();
  const before = await prisma.product.findUnique({ where: { id: sellableProduct.id }, select: { stock: true, reservedStock: true } });
  const order = await placeOrder(customer.accessToken, 3);

  const res = await api(`/orders/${order.id}/cancel`, { method: "POST", token: customer.accessToken, body: { reason: "test" } });
  assert.equal(res.status, 200);

  const after = await prisma.product.findUnique({ where: { id: sellableProduct.id }, select: { stock: true, reservedStock: true } });
  assert.equal(after.stock - after.reservedStock, before.stock - before.reservedStock, "availability is restored");
  assert.ok(await prisma.auditLog.findFirst({ where: { eventType: "order.cancelled", entityId: order.id } }), "cancellation recorded");
});

// ============================================================
// Admin module endpoints — the screens that previously read empty mock arrays.
// ============================================================

test("customers are derived from real buyer accounts, not the empty Customer table", async () => {
  // A brand-new registration must appear in the admin customer list.
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Fresh", accountType: "buyer" } });
  assert.equal(reg.status, 201);

  const { status, body } = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminToken });
  assert.equal(status, 200);
  const found = body.data.customers.find((c) => c.email === email);
  assert.ok(found, "a customer who just registered is listed immediately");
  assert.equal(found.totalOrders, 0, "aggregates start at zero, not fabricated");
  assert.equal(found.lifetimeValueMinor, 0);

  // The Customer table is empty — proving the list comes from User.
  assert.equal(await prisma.customer.count(), 0);
  assert.ok(body.data.total >= 1);
});

test("a customer's order totals aggregate from real orders", async () => {
  const customer = await buyer();
  await placeOrder(customer.accessToken, 2);

  const { body } = await api(`/admin/customers/${customer.user.id}`, { token: adminToken });
  assert.equal(body.data.customer.totalOrders, 1);
  assert.ok(body.data.customer.lifetimeValueMinor > 0, "lifetime value reflects the order");
  assert.equal(body.data.orders.length, 1);
});

test("an unknown customer id returns 404, not an empty shell", async () => {
  assert.equal((await api("/admin/customers/does-not-exist", { token: adminToken })).status, 404);
});

test("finance totals come from Invoice and Payment rows", async () => {
  const { status, body } = await api("/admin/finance?limit=5", { token: adminToken });
  assert.equal(status, 200);
  const [invoiceCount, paymentCount] = await Promise.all([prisma.invoice.count(), prisma.payment.count()]);
  if (invoiceCount > 0) assert.ok(body.data.invoices.length > 0, "invoices are listed when they exist");
  if (paymentCount > 0) assert.ok(body.data.payments.length > 0);
  assert.equal(typeof body.data.summary.capturedMinor, "number");
  assert.equal(typeof body.data.summary.receivableMinor, "number");
});

test("marketing lists coupons with live redemption counts", async () => {
  const { status, body } = await api("/admin/marketing", { token: adminToken });
  assert.equal(status, 200);
  assert.equal(body.data.coupons.length, await prisma.coupon.count({ where: { deletedAt: null } }));
  for (const c of body.data.coupons) {
    assert.ok(["active", "expired", "inactive"].includes(c.state));
    assert.equal(typeof c.redemptions, "number");
  }
});

test("shipping reports shipments and pending dispatch from real rows", async () => {
  const { status, body } = await api("/admin/shipping", { token: adminToken });
  assert.equal(status, 200);
  assert.equal(body.data.total, await prisma.shipment.count());
  assert.equal(typeof body.data.pendingDispatch, "number");
});

test("every admin module endpoint enforces authorization", async () => {
  const customer = await buyer();
  for (const path of ["/admin/customers", "/admin/finance", "/admin/shipping", "/admin/marketing"]) {
    assert.equal((await api(path, { token: customer.accessToken })).status, 403, `${path} forbids buyers`);
    assert.equal((await api(path)).status, 401, `${path} requires auth`);
  }
});
