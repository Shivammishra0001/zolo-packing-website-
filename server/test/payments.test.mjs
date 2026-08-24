// Payment & refund chain: an admin recording a payment outcome must ripple
// through the Payment row, the Order's denormalised payment fields, the
// invoice, the Finance module, the activity feed and the customer's inbox.
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
    where: { sku: "TST-PAY-PRODUCT" },
    update: { stock: 1000, reservedStock: 0, basePriceMinor: 25000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-PAY${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-PAY-PRODUCT", slug: `tst-pay-product-${Date.now()}`,
      name: "Payment Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 25000, moq: 1, stock: 1000, lowStockLevel: 10,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-PAY-PRODUCT" } }).catch(() => {});
  await stopServer();
});

async function orderWithPayment() {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Payer", accountType: "buyer" } });
  const token = reg.body.data.accessToken;
  const userId = reg.body.data.user.id;
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 2 } });
  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Payer", phone: "9876543210",
    line1: "1 Pay St", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod: "neft", idempotencyKey: `pay-${Math.random()}` } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body).slice(0, 200));
  const order = await prisma.order.findUnique({ where: { id: placed.body.data.id }, include: { payments: true } });
  return { order, payment: order.payments[0], token, userId };
}

test("admin marking a payment PAID updates order, invoice, feed and notifies the customer", async () => {
  const { order, payment, userId } = await orderWithPayment();
  assert.equal(order.paymentStatus, "PENDING");

  const res = await api(`/admin/payments/${payment.id}`, {
    method: "PATCH", token: adminTok, body: { status: "PAID", reference: "UTR-TEST-001" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));

  const after = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(after.paymentStatus, "PAID");
  assert.equal(after.paidMinor, order.grandTotalMinor);

  const invoice = await prisma.invoice.findFirst({ where: { orderId: order.id } });
  assert.equal(invoice.status, "paid");

  const event = await prisma.auditLog.findFirst({ where: { eventType: "payment.updated", entityId: payment.id } });
  assert.ok(event, "payment.updated event recorded");
  assert.equal(event.metadata.to, "PAID");

  const notif = await prisma.notification.findFirst({ where: { userId, type: "payment.updated" } });
  assert.ok(notif, "customer notified of the payment");
});

test("a partial refund moves the order to PARTIALLY_REFUNDED and shows in Finance", async () => {
  const { order, payment } = await orderWithPayment();
  await api(`/admin/payments/${payment.id}`, { method: "PATCH", token: adminTok, body: { status: "PAID" } });

  const half = Math.floor(payment.amountMinor / 2);
  const res = await api(`/admin/payments/${payment.id}/refund`, {
    method: "POST", token: adminTok, body: { amountMinor: half, reason: "Damaged in transit" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));

  const after = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED");
  const pay = await prisma.payment.findUnique({ where: { id: payment.id } });
  assert.equal(pay.status, "PARTIALLY_REFUNDED");

  const fin = await api("/admin/finance", { token: adminTok });
  assert.equal(fin.status, 200);
  // The Refund ledger — not payment statuses — is the source for this figure.
  assert.ok(fin.body.data.summary.refundedMinor >= half, "refund total reflects the ledger");
  assert.ok(fin.body.data.refunds.some((r) => r.orderNumber === order.orderNumber), "refund appears in the Finance module");
});

test("a refund cannot exceed the captured amount, and an uncaptured payment cannot be refunded", async () => {
  const { payment } = await orderWithPayment();

  const early = await api(`/admin/payments/${payment.id}/refund`, {
    method: "POST", token: adminTok, body: { amountMinor: 100 },
  });
  assert.equal(early.status, 400, "refund before capture is rejected");

  await api(`/admin/payments/${payment.id}`, { method: "PATCH", token: adminTok, body: { status: "PAID" } });
  const tooMuch = await api(`/admin/payments/${payment.id}/refund`, {
    method: "POST", token: adminTok, body: { amountMinor: payment.amountMinor + 1 },
  });
  assert.equal(tooMuch.status, 400, "over-refund is rejected");
});

test("an unknown payment status is rejected", async () => {
  const { payment } = await orderWithPayment();
  const res = await api(`/admin/payments/${payment.id}`, { method: "PATCH", token: adminTok, body: { status: "TOTALLY_PAID" } });
  assert.equal(res.status, 400);
});

test("registration records a user.registered event and reaches the activity feed", async () => {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Feed", lastName: "Probe", accountType: "buyer" } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body).slice(0, 200));
  const userId = reg.body.data.user.id;

  const event = await prisma.auditLog.findFirst({ where: { eventType: "user.registered", entityId: userId } });
  assert.ok(event, "user.registered recorded");

  const feed = await api("/admin/activity?limit=50", { token: adminTok });
  assert.equal(feed.status, 200);
  assert.ok(feed.body.data.activity.some((e) => e.entityId === userId), "new customer appears in the admin activity feed");

  const customers = await api(`/admin/customers?search=${encodeURIComponent(email)}`, { token: adminTok });
  assert.equal(customers.status, 200);
  assert.ok(customers.body.data.customers.some((c) => c.email === email), "new customer appears in the Customers module");
});
