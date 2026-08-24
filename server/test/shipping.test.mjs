// Shipping chain: booking a shipment and posting tracking events must advance
// the shipment, the order, the status history, the activity feed, the Shipping
// module and the customer's notifications — one timeline, two audiences.
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
    where: { sku: "TST-SHIP-PRODUCT" },
    update: { stock: 1000, reservedStock: 0, basePriceMinor: 30000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-SHP${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-SHIP-PRODUCT", slug: `tst-ship-product-${Date.now()}`,
      name: "Shipping Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 30000, moq: 1, stock: 1000, lowStockLevel: 10,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-SHIP-PRODUCT" } }).catch(() => {});
  await stopServer();
});

async function placedOrder(paymentMethod = "cod") {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Shipper", accountType: "buyer" } });
  const token = reg.body.data.accessToken;
  const userId = reg.body.data.user.id;
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 1 } });
  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Shipper", phone: "9876543210",
    line1: "1 Ship St", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod, idempotencyKey: `ship-${Math.random()}` } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body).slice(0, 200));
  return { order: placed.body.data, token, userId };
}

test("booking a shipment records the event, notifies the customer and shows in Shipping", async () => {
  const { order, userId } = await placedOrder();

  const res = await api(`/admin/orders/${order.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "BlueDart", trackingNumber: "BD-TEST-1", note: "Picked for packing" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
  const shipment = res.body.data.shipment;
  assert.equal(shipment.status, "AWB_BOOKED", "a tracking number books the AWB");

  const event = await prisma.auditLog.findFirst({ where: { eventType: "shipment.created", entityId: shipment.id } });
  assert.ok(event, "shipment.created recorded");

  const notif = await prisma.notification.findFirst({ where: { userId, type: "shipment.created" } });
  assert.ok(notif, "customer notified");

  const shipping = await api("/admin/shipping", { token: adminTok });
  assert.equal(shipping.status, 200);
  assert.ok(shipping.body.data.shipments.some((s) => s.orderNumber === order.orderNumber), "shipment appears in the Shipping module");
});

test("tracking events advance the order and settle a COD payment on delivery", async () => {
  const { order, token, userId } = await placedOrder("cod");
  const booked = await api(`/admin/orders/${order.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "Delhivery", trackingNumber: "DL-TEST-1" },
  });
  const shipmentId = booked.body.data.shipment.id;

  for (const [status, location] of [["PICKED_UP", "Bengaluru Hub"], ["IN_TRANSIT", "Hosur"], ["OUT_FOR_DELIVERY", "Bengaluru"], ["DELIVERED", "Bengaluru"]]) {
    const r = await api(`/admin/shipments/${shipmentId}/events`, { method: "POST", token: adminTok, body: { status, location } });
    assert.equal(r.status, 200, `${status}: ${JSON.stringify(r.body).slice(0, 160)}`);
  }

  const after = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(after.status, "DELIVERED", "order followed the shipment to DELIVERED");
  assert.equal(after.paymentStatus, "PAID", "COD settled on delivery");
  assert.equal(after.paidMinor, order.grandTotalMinor);

  const invoice = await prisma.invoice.findFirst({ where: { orderId: order.id } });
  assert.equal(invoice.status, "paid");

  const events = await prisma.shipmentEvent.count({ where: { shipmentId } });
  assert.ok(events >= 5, `full tracking timeline retained (got ${events})`);

  const history = await prisma.orderStatusHistory.count({ where: { orderId: order.id } });
  assert.ok(history >= 3, "order status history captured each shipment-driven transition");

  // The customer reads the same timeline the admin wrote.
  const mine = await api(`/orders/${order.id}`, { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.data.status, "DELIVERED");

  const notifs = await prisma.notification.count({ where: { userId, type: "shipment.status" } });
  assert.ok(notifs >= 4, `customer notified of each leg (got ${notifs})`);
});

test("a shipment cannot move backwards, and an order cannot be double-shipped", async () => {
  const { order } = await placedOrder();
  const booked = await api(`/admin/orders/${order.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "FedEx", trackingNumber: "FX-TEST-1" },
  });
  const shipmentId = booked.body.data.shipment.id;

  const dup = await api(`/admin/orders/${order.id}/shipment`, {
    method: "POST", token: adminTok, body: { courier: "DHL" },
  });
  assert.equal(dup.status, 409, "second active shipment is rejected");

  await api(`/admin/shipments/${shipmentId}/events`, { method: "POST", token: adminTok, body: { status: "IN_TRANSIT" } });
  const back = await api(`/admin/shipments/${shipmentId}/events`, { method: "POST", token: adminTok, body: { status: "PACKING" } });
  assert.equal(back.status, 400, "backwards transition is rejected");

  const bogus = await api(`/admin/shipments/${shipmentId}/events`, { method: "POST", token: adminTok, body: { status: "TELEPORTED" } });
  assert.equal(bogus.status, 400, "unknown status is rejected");
});

test("a cancelled order cannot be shipped", async () => {
  const { order, token } = await placedOrder();
  const cancelled = await api(`/orders/${order.id}/cancel`, { method: "POST", token, body: { reason: "changed mind" } });
  assert.equal(cancelled.status, 200);

  const res = await api(`/admin/orders/${order.id}/shipment`, { method: "POST", token: adminTok, body: { courier: "BlueDart" } });
  assert.equal(res.status, 400);
});
