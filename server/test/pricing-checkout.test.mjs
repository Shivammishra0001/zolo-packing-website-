// Tiered pricing and commission at checkout — the writes, not just the maths.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerBuyer, adminToken, makeProduct, makeAddress } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

before(startServer);
after(stopServer);

test("admin sets a ladder; checkout charges the tier price, not the base", async () => {
  const admin = await adminToken();
  const product = await makeProduct({ priceMinor: 1800, stock: 100_000, name: "Tiered Mailer" });

  const put = await api(`/admin/products/${product.id}/tiers`, {
    method: "PUT",
    token: admin,
    body: { tiers: [{ minQty: 500, unitPriceMinor: 1650 }, { minQty: 2000, unitPriceMinor: 1475 }] },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.data.tiers.length, 2);

  // 3000 units sits above the top tier, so 1475 applies — not the 1800 base.
  const buyer = await registerBuyer();
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 3000 } });
  const address = await makeAddress(buyer.token);
  const placed = await api("/checkout/place", {
    method: "POST",
    token: buyer.token,
    body: { shippingAddressId: address, paymentMethod: "cod", idempotencyKey: `tier-${Math.random()}` },
  });
  assert.equal(placed.status, 201);

  const line = placed.body.data.items.find((i) => i.productId === product.id);
  assert.equal(line.unitPriceMinor, 1475, "the ladder must beat the base price");
  assert.equal(line.lineTotalMinor, 1475 * 3000);
});

test("commission is snapshotted per line and rolled up on the order", async () => {
  const admin = await adminToken();
  const product = await makeProduct({ priceMinor: 2000, stock: 10_000, name: "Commission Box" });
  await api(`/admin/products/${product.id}/commission`, {
    method: "PATCH", token: admin, body: { commissionBps: 1250 }, // 12.5%
  });

  const buyer = await registerBuyer();
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 10 } });
  const address = await makeAddress(buyer.token);
  const placed = await api("/checkout/place", {
    method: "POST", token: buyer.token,
    body: { shippingAddressId: address, paymentMethod: "cod", idempotencyKey: `c-${Math.random()}` },
  });
  assert.equal(placed.status, 201);

  const orderId = placed.body.data.id;
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  const line = items.find((i) => i.productId === product.id);
  assert.equal(line.commissionBps, 1250, "the rate is frozen on the line");
  assert.equal(line.commissionMinor, Math.round((line.lineTotalMinor * 1250) / 10_000));

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { commissionMinor: true } });
  assert.equal(
    order.commissionMinor,
    items.reduce((n, i) => n + i.commissionMinor, 0),
    "the order roll-up equals the sum of its lines",
  );
});

test("changing a product's rate does not restate past orders", async () => {
  const admin = await adminToken();
  const product = await makeProduct({ priceMinor: 5000, stock: 1000, name: "Rate Change Box" });
  await api(`/admin/products/${product.id}/commission`, { method: "PATCH", token: admin, body: { commissionBps: 500 } });

  const buyer = await registerBuyer();
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 4 } });
  const address = await makeAddress(buyer.token);
  const placed = await api("/checkout/place", {
    method: "POST", token: buyer.token,
    body: { shippingAddressId: address, paymentMethod: "cod", idempotencyKey: `c-${Math.random()}` },
  });
  const before = await prisma.order.findUnique({
    where: { id: placed.body.data.id },
    select: { commissionMinor: true },
  });

  // Triple the rate AFTER the order exists.
  await api(`/admin/products/${product.id}/commission`, { method: "PATCH", token: admin, body: { commissionBps: 1500 } });

  const after = await prisma.order.findUnique({
    where: { id: placed.body.data.id },
    select: { commissionMinor: true },
  });
  assert.equal(after.commissionMinor, before.commissionMinor, "a historical payout must not move");
});

test("a duplicate tier quantity is refused", async () => {
  const admin = await adminToken();
  const product = await makeProduct();
  const res = await api(`/admin/products/${product.id}/tiers`, {
    method: "PUT", token: admin,
    body: { tiers: [{ minQty: 500, unitPriceMinor: 1000 }, { minQty: 500, unitPriceMinor: 900 }] },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "DUPLICATE_TIER");
});

test("an out-of-range commission rate is refused", async () => {
  const admin = await adminToken();
  const product = await makeProduct();
  for (const bps of [-1, 10_001, 12.5]) {
    const res = await api(`/admin/products/${product.id}/commission`, { method: "PATCH", token: admin, body: { commissionBps: bps } });
    assert.equal(res.status, 400, `${bps} bps must be refused`);
  }
});

test("only an admin can set tiers or commission", async () => {
  const buyer = await registerBuyer();
  const product = await makeProduct();
  const tiers = await api(`/admin/products/${product.id}/tiers`, {
    method: "PUT", token: buyer.token, body: { tiers: [] },
  });
  assert.equal(tiers.status, 403);
  const rate = await api(`/admin/products/${product.id}/commission`, {
    method: "PATCH", token: buyer.token, body: { commissionBps: 100 },
  });
  assert.equal(rate.status, 403);
});
