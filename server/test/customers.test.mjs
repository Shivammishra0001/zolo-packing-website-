// Customer module: the list must carry the columns the admin table renders
// (company / name / contact / segment / city / orders / order value), and the
// detail view must carry the full profile — addresses, order history and
// payment history — all from real rows.
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
    where: { sku: "TST-CUST-PRODUCT" },
    update: { stock: 500, reservedStock: 0, basePriceMinor: 20000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-CST${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-CUST-PRODUCT", slug: `tst-cust-product-${Date.now()}`,
      name: "Customer Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 20000, moq: 1, stock: 500, lowStockLevel: 10,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-CUST-PRODUCT" } }).catch(() => {});
  await stopServer();
});

/** A buyer with a saved address and one placed order. */
async function buyerWithOrder({ city = "Bengaluru", state = "Karnataka" } = {}) {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Cust", lastName: "Omer", accountType: "buyer" } });
  const token = reg.body.data.accessToken;
  const userId = reg.body.data.user.id;

  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 2 } });
  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Cust Omer", phone: "9876543210",
    line1: "9 Customer Rd", city, state, postalCode: "560001" } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod: "neft", idempotencyKey: `cust-${Math.random()}` } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body).slice(0, 200));

  return { userId, email, token, order: placed.body.data };
}

test("the customer list carries every column the admin table renders", async () => {
  const { userId, email, order } = await buyerWithOrder({ city: "Pune", state: "Maharashtra" });

  const res = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminTok });
  assert.equal(res.status, 200);
  const row = res.body.data.customers.find((c) => c.id === userId);
  assert.ok(row, "the customer is listed");

  // Every column the table renders must be present on the payload.
  for (const key of ["name", "email", "phone", "company", "city", "state", "segment", "totalOrders", "lifetimeValueMinor"]) {
    assert.ok(key in row, `list row exposes "${key}"`);
  }

  assert.equal(row.city, "Pune", "city comes from the buyer's address book");
  assert.equal(row.state, "Maharashtra");
  assert.equal(row.totalOrders, 1);
  assert.equal(row.lifetimeValueMinor, order.grandTotalMinor, "order value is the real order total");
  // A buyer with no organisation has no company — null, never a placeholder.
  assert.equal(row.company, null);
});

test("order value excludes cancelled orders", async () => {
  const { userId, email, token, order } = await buyerWithOrder();

  const before = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminTok });
  assert.equal(before.body.data.customers.find((c) => c.id === userId).lifetimeValueMinor, order.grandTotalMinor);

  const cancelled = await api(`/orders/${order.id}/cancel`, { method: "POST", token, body: { reason: "test" } });
  assert.equal(cancelled.status, 200);

  const after = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminTok });
  const row = after.body.data.customers.find((c) => c.id === userId);
  assert.equal(row.lifetimeValueMinor, 0, "a cancelled order stops counting toward order value");
  assert.equal(row.totalOrders, 0);
});

test("the detail view returns the full profile: addresses, orders and payment history", async () => {
  const { userId, order } = await buyerWithOrder({ city: "Chennai", state: "Tamil Nadu" });

  const res = await api(`/admin/customers/${userId}`, { token: adminTok });
  assert.equal(res.status, 200);
  const { customer, totals, orders, payments, addresses } = res.body.data;

  // Identity
  assert.equal(customer.name, "Cust Omer");
  assert.equal(customer.phone, null);
  assert.equal(customer.city, "Chennai");
  assert.equal(customer.addressCount, 1, "address count reflects the saved address book");
  assert.equal(addresses.length, 1);
  assert.equal(addresses[0].city, "Chennai");

  // Order history
  assert.equal(customer.totalOrders, 1);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderNumber, order.orderNumber);
  assert.equal(customer.lifetimeValueMinor, order.grandTotalMinor);
  assert.equal(customer.averageOrderMinor, order.grandTotalMinor);

  // Payment history — unpaid, so it is outstanding rather than paid.
  assert.equal(payments.length, 1, "the order's payment appears in payment history");
  assert.equal(payments[0].orderNumber, order.orderNumber);
  assert.equal(payments[0].status, "PENDING");
  assert.equal(totals.paidMinor, 0);
  assert.equal(totals.outstandingMinor, order.grandTotalMinor, "unpaid order is outstanding");
});

test("payment history follows capture and refund", async () => {
  const { userId, order } = await buyerWithOrder();
  const payment = await prisma.payment.findFirst({ where: { orderId: order.id } });

  await api(`/admin/payments/${payment.id}`, { method: "PATCH", token: adminTok, body: { status: "PAID", reference: "UTR-CUST-1" } });

  const paid = await api(`/admin/customers/${userId}`, { token: adminTok });
  assert.equal(paid.body.data.totals.paidMinor, order.grandTotalMinor, "captured payment shows as paid");
  assert.equal(paid.body.data.totals.outstandingMinor, 0, "nothing outstanding once paid");
  assert.equal(paid.body.data.payments[0].reference, "UTR-CUST-1");

  const half = Math.floor(payment.amountMinor / 2);
  await api(`/admin/payments/${payment.id}/refund`, { method: "POST", token: adminTok, body: { amountMinor: half, reason: "partial" } });

  const refunded = await api(`/admin/customers/${userId}`, { token: adminTok });
  assert.equal(refunded.body.data.totals.refundedMinor, half, "refund shows against the customer");
  assert.equal(refunded.body.data.payments[0].refundedMinor, half, "refund is attributed to its payment");
});

test("segment is derived from real spend, and a customer with no orders is listed at zero", async () => {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Fresh", accountType: "buyer" } });
  const userId = reg.body.data.user.id;

  const res = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminTok });
  const row = res.body.data.customers.find((c) => c.id === userId);
  assert.ok(row, "a customer with no orders still appears");
  assert.equal(row.totalOrders, 0);
  assert.equal(row.lifetimeValueMinor, 0);
  assert.equal(row.segment, "small_seller");
  assert.equal(row.city, null, "no address and no order means no city — not a fabricated one");

  // The detail view must not 404 for a customer who has never ordered.
  const detail = await api(`/admin/customers/${userId}`, { token: adminTok });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.orders.length, 0);
  assert.equal(detail.body.data.payments.length, 0);
  assert.equal(detail.body.data.addresses.length, 0);
  assert.equal(detail.body.data.totals.outstandingMinor, 0);
});

test("a non-admin cannot read customer profiles", async () => {
  const { userId, token } = await buyerWithOrder();
  const res = await api(`/admin/customers/${userId}`, { token });
  assert.ok(res.status === 401 || res.status === 403, `buyer blocked (got ${res.status})`);
});
