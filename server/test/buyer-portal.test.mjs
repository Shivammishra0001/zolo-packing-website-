// Buyer-scoped reads: dashboard, payment history and shipment tracking.
//
// The security half of this file matters as much as the functional half: a
// buyer must never reach another buyer's payments or tracking, and the failure
// must be a 404 so ownership can't be probed by comparing status codes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, unique, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

let adminTok;
let product;

before(async () => {
  await startServer();
  adminTok = await adminToken();

  product = await prisma.product.upsert({
    where: { sku: "TST-BUYER-PRODUCT" },
    update: { stock: 500, reservedStock: 0, basePriceMinor: 25000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-BUY${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-BUYER-PRODUCT", slug: `tst-buyer-product-${Date.now()}`,
      name: "Buyer Portal Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 25000, moq: 1, stock: 500, lowStockLevel: 10,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-BUYER-PRODUCT" } }).catch(() => {});
  await stopServer();
});

async function buyer() {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Buy", lastName: "Er", accountType: "buyer" } });
  return { token: reg.body.data.accessToken, userId: reg.body.data.user.id, email };
}

async function orderFor(token, paymentMethod = "neft") {
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 2 } });
  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Buy Er", phone: "9876543210",
    line1: "5 Buyer Ln", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod, idempotencyKey: `buy-${Math.random()}` } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body).slice(0, 200));
  return placed.body.data;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test("buyer dashboard reports the buyer's own orders and spend", async () => {
  const { token } = await buyer();

  const empty = await api("/me/dashboard", { token });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.data.orders.total, 0, "a new buyer starts at zero, not at a mock figure");
  assert.equal(empty.body.data.totalSpendMinor, 0);

  const order = await orderFor(token);

  const after = await api("/me/dashboard", { token });
  assert.equal(after.body.data.orders.total, 1);
  assert.equal(after.body.data.orders.active, 1, "a pending order counts as active");
  assert.equal(after.body.data.totalSpendMinor, order.grandTotalMinor);
  assert.ok(after.body.data.recentOrders.some((o) => o.id === order.id));
  assert.equal(after.body.data.addresses, 1);
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

test("payment history shows the order's payment and tracks capture", async () => {
  const { token } = await buyer();
  const order = await orderFor(token);

  const before = await api("/me/payments", { token });
  assert.equal(before.status, 200);
  assert.equal(before.body.data.payments.length, 1);
  assert.equal(before.body.data.payments[0].orderNumber, order.orderNumber);
  assert.equal(before.body.data.payments[0].status, "PENDING");
  assert.equal(before.body.data.summary.paidMinor, 0);
  assert.equal(before.body.data.summary.outstandingMinor, order.grandTotalMinor,
    "an unpaid order is outstanding for the buyer");

  // Admin captures the payment; the buyer's view must follow.
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } });
  await api(`/admin/payments/${payment.id}`, {
    method: "PATCH", token: adminTok, body: { status: "PAID", reference: "UTR-BUY-1" } });

  const paid = await api("/me/payments", { token });
  assert.equal(paid.body.data.summary.paidMinor, order.grandTotalMinor);
  assert.equal(paid.body.data.summary.outstandingMinor, 0);
  assert.equal(paid.body.data.payments[0].reference, "UTR-BUY-1");
});

test("a refund appears in the buyer's payment history", async () => {
  const { token } = await buyer();
  const order = await orderFor(token);
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } });

  await api(`/admin/payments/${payment.id}`, { method: "PATCH", token: adminTok, body: { status: "PAID" } });
  const half = Math.floor(payment.amountMinor / 2);
  await api(`/admin/payments/${payment.id}/refund`, {
    method: "POST", token: adminTok, body: { amountMinor: half, reason: "damaged" } });

  const res = await api("/me/payments", { token });
  assert.equal(res.body.data.summary.refundedMinor, half);
  assert.equal(res.body.data.payments[0].refundedMinor, half);
  assert.equal(res.body.data.payments[0].refunds.length, 1);
});

test("a buyer's payment history contains ONLY their own payments", async () => {
  const alice = await buyer();
  const bob = await buyer();
  const aliceOrder = await orderFor(alice.token);
  await orderFor(bob.token);

  const res = await api("/me/payments", { token: bob.token });
  assert.equal(res.body.data.payments.length, 1, "bob sees exactly one payment — his own");
  assert.notEqual(res.body.data.payments[0].orderNumber, aliceOrder.orderNumber);
  assert.ok(
    !res.body.data.payments.some((p) => p.orderNumber === aliceOrder.orderNumber),
    "alice's payment never appears in bob's history",
  );
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

test("tracking returns the shipment timeline the admin wrote", async () => {
  const { token } = await buyer();
  const order = await orderFor(token, "cod");

  const none = await api(`/me/orders/${order.id}/tracking`, { token });
  assert.equal(none.status, 200);
  assert.equal(none.body.data.shipments.length, 0, "no shipment yet — empty, not fabricated");
  assert.ok(none.body.data.statusHistory.length >= 1, "status history exists from placement");

  const booked = await api(`/admin/orders/${order.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "BlueDart", trackingNumber: "BD-BUY-1" } });
  const shipmentId = booked.body.data.shipment.id;
  await api(`/admin/shipments/${shipmentId}/events`, {
    method: "POST", token: adminTok, body: { status: "PICKED_UP", location: "Bengaluru Hub" } });
  await api(`/admin/shipments/${shipmentId}/events`, {
    method: "POST", token: adminTok, body: { status: "IN_TRANSIT", location: "Hosur" } });

  const res = await api(`/me/orders/${order.id}/tracking`, { token });
  assert.equal(res.body.data.shipments.length, 1);
  const s = res.body.data.shipments[0];
  assert.equal(s.courier, "BlueDart");
  assert.equal(s.trackingNumber, "BD-BUY-1");
  assert.equal(s.status, "IN_TRANSIT");
  assert.ok(s.events.length >= 3, `the full event trail is returned (got ${s.events.length})`);
  assert.equal(s.events[0].location, "Hosur", "newest event first");
  assert.equal(res.body.data.order.destination, "Bengaluru, Karnataka, 560001");
});

test("the shipments list is scoped to the buyer and counts what is in transit", async () => {
  const alice = await buyer();
  const bob = await buyer();
  const aliceOrder = await orderFor(alice.token);
  await orderFor(bob.token);

  const booked = await api(`/admin/orders/${aliceOrder.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "Delhivery", trackingNumber: "DL-BUY-1" } });
  await api(`/admin/shipments/${booked.body.data.shipment.id}/events`, {
    method: "POST", token: adminTok, body: { status: "IN_TRANSIT" } });

  const mine = await api("/me/shipments", { token: alice.token });
  assert.equal(mine.body.data.total, 1);
  assert.equal(mine.body.data.inTransit, 1);
  assert.equal(mine.body.data.shipments[0].orderNumber, aliceOrder.orderNumber);

  const bobs = await api("/me/shipments", { token: bob.token });
  assert.equal(bobs.body.data.total, 0, "bob has no shipment and sees none of alice's");
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test("a buyer cannot track another buyer's order — and gets 404, not 403", async () => {
  const alice = await buyer();
  const bob = await buyer();
  const aliceOrder = await orderFor(alice.token);

  const res = await api(`/me/orders/${aliceOrder.id}/tracking`, { token: bob.token });
  assert.equal(res.status, 404, "ownership failure looks identical to a missing record");

  const bogus = await api("/me/orders/definitely-not-an-id/tracking", { token: bob.token });
  assert.equal(bogus.status, 404, "an unknown id returns the same 404 — no oracle");
});

test("buyer endpoints reject unauthenticated callers", async () => {
  for (const path of ["/me/dashboard", "/me/payments", "/me/shipments"]) {
    const res = await api(path);
    assert.equal(res.status, 401, `${path} requires authentication`);
  }
});

test("/me routes stay self-scoped even for an admin caller", async () => {
  // requireBuyer deliberately admits any authenticated user so an admin can
  // exercise checkout (see middleware/auth.mjs). That is safe ONLY because the
  // query scopes to the caller's own id — this test is what keeps it safe.
  const { token } = await buyer();
  const order = await orderFor(token);

  const res = await api("/me/payments", { token: adminTok });
  assert.equal(res.status, 200, "an admin may shop, so the route admits them");
  assert.ok(
    !res.body.data.payments.some((p) => p.orderNumber === order.orderNumber),
    "but they see only their OWN payments — never the buyer's",
  );
});
