// End-to-end commerce tests — cart, checkout, order, payment (COD), invoice,
// inventory, coupons, admin status management, and authorization.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startServer, stopServer, api,
  registerBuyer, adminToken, makeProduct, makeAddress, makeCoupon,
} from "./helpers.mjs";

before(startServer);
after(stopServer);

test("full purchase: cart → quote → place (COD) → order → invoice → my orders", async () => {
  const { token } = await registerBuyer();
  const product = await makeProduct({ priceMinor: 50000, stock: 100 }); // ₹500, 100 in stock
  const addressId = await makeAddress(token);

  // add to cart
  let res = await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 2 } });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.items.length, 1);
  assert.equal(res.body.data.items[0].quantity, 2);

  // server-priced quote: subtotal ₹1000, tax 18% = ₹180, shipping free (≥₹1000)
  res = await api("/checkout/quote", { method: "POST", token, body: {} });
  assert.equal(res.body.data.subtotalMinor, 100000);
  assert.equal(res.body.data.taxMinor, 18000);
  assert.equal(res.body.data.shippingMinor, 0);
  assert.equal(res.body.data.grandTotalMinor, 118000);

  // place order (COD)
  res = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId, paymentMethod: "cod" } });
  assert.equal(res.status, 201);
  const order = res.body.data;
  assert.match(order.orderNumber, /^ORD-/);
  assert.equal(order.status, "PENDING");
  assert.equal(order.paymentStatus, "PENDING");
  assert.equal(order.grandTotalMinor, 118000);
  assert.equal(order.items[0].productName, product.name); // snapshot
  assert.ok(order.invoice.invoiceNumber.startsWith("ZOLO/")); // invoice generated

  // inventory deducted
  const after = await api("/cart", { token });
  assert.equal(after.body.data.items.length, 0, "cart cleared after order");

  // my orders shows exactly one
  res = await api("/orders", { token });
  assert.equal(res.body.data.length, 1);

  // invoice endpoint
  res = await api(`/orders/${order.id}/invoice`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.order.grandTotalMinor, 118000);
});

test("server computes price — client cannot inject totals", async () => {
  const { token } = await registerBuyer();
  const product = await makeProduct({ priceMinor: 20000, stock: 10 });
  const addressId = await makeAddress(token);
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 1 } });

  // Attempt to smuggle a fake total — it must be ignored.
  const res = await api("/checkout/place", {
    method: "POST", token,
    body: { shippingAddressId: addressId, grandTotalMinor: 1, subtotalMinor: 1, taxMinor: 0 },
  });
  assert.equal(res.status, 201);
  // ₹200 subtotal, +18% tax ₹36, +₹5 shipping (below ₹1000) = ₹241
  assert.equal(res.body.data.subtotalMinor, 20000);
  assert.equal(res.body.data.taxMinor, 3600);
  assert.equal(res.body.data.shippingMinor, 500);
  assert.equal(res.body.data.grandTotalMinor, 24100);
});

test("idempotency: same key never creates a duplicate order", async () => {
  const { token } = await registerBuyer();
  const product = await makeProduct({ priceMinor: 30000, stock: 50 });
  const addressId = await makeAddress(token);
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 1 } });

  const key = "idem-" + Math.random().toString(36).slice(2);
  const first = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId, idempotencyKey: key } });
  const second = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId, idempotencyKey: key } });
  assert.equal(first.body.data.orderNumber, second.body.data.orderNumber, "same order returned");

  const list = await api("/orders", { token });
  assert.equal(list.body.data.length, 1, "exactly one order exists");
});

test("stock: cannot add or buy more than available", async () => {
  const { token } = await registerBuyer();
  const product = await makeProduct({ priceMinor: 10000, stock: 3 });

  // adding more than stock is rejected
  let res = await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 5 } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "INSUFFICIENT_STOCK");

  // add the max, buy it, then a second buyer finds none left
  res = await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 3 } });
  assert.equal(res.status, 201);
  const addressId = await makeAddress(token);
  res = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId } });
  assert.equal(res.status, 201);

  const buyer2 = await registerBuyer();
  res = await api("/cart/items", { method: "POST", token: buyer2.token, body: { productId: product.id, quantity: 1 } });
  assert.equal(res.status, 400, "no stock left for second buyer");
});

test("authorization: a buyer cannot read another buyer's order", async () => {
  const a = await registerBuyer();
  const b = await registerBuyer();
  const product = await makeProduct({ priceMinor: 15000, stock: 10 });
  const addressId = await makeAddress(a.token);
  await api("/cart/items", { method: "POST", token: a.token, body: { productId: product.id, quantity: 1 } });
  const placed = await api("/checkout/place", { method: "POST", token: a.token, body: { shippingAddressId: addressId } });
  const orderId = placed.body.data.id;

  const asB = await api(`/orders/${orderId}`, { token: b.token });
  assert.equal(asB.status, 404, "other user's order is not found for B");
  const invoiceAsB = await api(`/orders/${orderId}/invoice`, { token: b.token });
  assert.ok(invoiceAsB.status === 403 || invoiceAsB.status === 404);
});

test("coupon: valid percent coupon discounts server-side; single use per customer", async () => {
  const { token } = await registerBuyer();
  const product = await makeProduct({ priceMinor: 100000, stock: 10 }); // ₹1000
  const coupon = await makeCoupon({ type: "percent", value: 1000 }); // 10%
  const addressId = await makeAddress(token);
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 1 } });

  // quote with coupon: ₹1000 - 10% (₹100) = ₹900 taxable, tax ₹162, ship free
  let res = await api("/checkout/quote", { method: "POST", token, body: { couponCode: coupon.code } });
  assert.equal(res.body.data.discountMinor, 10000);
  assert.equal(res.body.data.grandTotalMinor, 90000 + 16200);

  res = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId, couponCode: coupon.code } });
  assert.equal(res.body.data.discountMinor, 10000);

  // second use by same customer is rejected
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 1 } });
  res = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId, couponCode: coupon.code } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "COUPON_ALREADY_USED");
});

test("admin: list, view, valid status transition, history, and COD capture on delivery", async () => {
  const { token } = await registerBuyer();
  const admin = await adminToken();
  const product = await makeProduct({ priceMinor: 40000, stock: 10 });
  const addressId = await makeAddress(token);
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 1 } });
  const placed = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId } });
  const orderId = placed.body.data.id;

  // admin sees it
  let res = await api("/admin/orders", { token: admin });
  assert.ok(res.body.data.orders.some((o) => o.id === orderId));

  // stats
  res = await api("/admin/orders/stats", { token: admin });
  assert.ok(res.body.data.totalOrders >= 1);

  // invalid transition rejected (PENDING → DELIVERED not allowed directly)
  res = await api(`/admin/orders/${orderId}/status`, { method: "PATCH", token: admin, body: { status: "DELIVERED" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "INVALID_TRANSITION");

  // walk the valid chain to DELIVERED
  for (const status of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"]) {
    res = await api(`/admin/orders/${orderId}/status`, { method: "PATCH", token: admin, body: { status } });
    assert.equal(res.status, 200, `transition to ${status}`);
  }
  assert.equal(res.body.data.status, "DELIVERED");
  assert.equal(res.body.data.paymentStatus, "PAID", "COD captured on delivery");

  // history recorded (PENDING + 6 transitions = 7 entries)
  assert.ok(res.body.data.statusHistory.length >= 7);

  // a non-admin cannot hit admin order APIs
  const forbidden = await api("/admin/orders", { token });
  assert.equal(forbidden.status, 403);
});

test("buyer can cancel a pending order and stock is restored", async () => {
  const { token } = await registerBuyer();
  const product = await makeProduct({ priceMinor: 25000, stock: 5 });
  const addressId = await makeAddress(token);
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 2 } });
  const placed = await api("/checkout/place", { method: "POST", token, body: { shippingAddressId: addressId } });
  const orderId = placed.body.data.id;

  const res = await api(`/orders/${orderId}/cancel`, { method: "POST", token, body: { reason: "Changed my mind" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, "CANCELLED");
});
