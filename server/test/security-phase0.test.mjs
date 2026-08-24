// Phase 0 security hardening.
//
// Each test here corresponds to a vulnerability that was verified exploitable
// against the running server before the fix:
//
//   C1  KYC documents were downloadable with no authentication
//   C3  /auth/login accepted unlimited password attempts
//   0b  order stock changes bypassed the inventory ledger
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, api, apiRaw, unique, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { UPLOADS_PATH, PRIVATE_UPLOADS_PATH } from "../src/lib/storage.mjs";
import { resetRateLimits } from "../src/middleware/rate-limit.mjs";

let adminTok;
let product;

before(async () => {
  await startServer();
  adminTok = await adminToken();
  product = await prisma.product.upsert({
    where: { sku: "TST-SEC0-PRODUCT" },
    update: { stock: 200, reservedStock: 0, basePriceMinor: 15000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-SEC${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-SEC0-PRODUCT", slug: `tst-sec0-${Date.now()}`,
      name: "Phase 0 Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 15000, moq: 1, stock: 200, lowStockLevel: 5,
    },
  });
});

after(async () => {
  await prisma.stockMovement.deleteMany({ where: { productId: product.id } }).catch(() => {});
  await prisma.product.deleteMany({ where: { sku: "TST-SEC0-PRODUCT" } }).catch(() => {});
  await stopServer();
});

// ---------------------------------------------------------------------------
// C1 — private document storage
// ---------------------------------------------------------------------------

test("KYC documents are written to the private tree, never the public one", async () => {
  const docs = await prisma.supplierDocument.findMany({ select: { storageKey: true }, take: 20 });
  if (docs.length === 0) return; // nothing uploaded in this environment

  for (const d of docs) {
    assert.equal(
      existsSync(join(UPLOADS_PATH, d.storageKey)),
      false,
      `${d.storageKey} must NOT be in the statically-served public directory`,
    );
  }
  // At least one should be present in the private tree.
  assert.ok(
    docs.some((d) => existsSync(join(PRIVATE_UPLOADS_PATH, d.storageKey))),
    "documents live in the private tree",
  );
});

test("a KYC document is not reachable over the static /uploads mount", async () => {
  const doc = await prisma.supplierDocument.findFirst({ select: { storageKey: true } });
  if (!doc) return;

  // These all returned 200 with the PDF body before the fix.
  for (const path of [
    `/uploads/${doc.storageKey}`,
    `/uploads/private/${doc.storageKey}`,
  ]) {
    const res = await apiRaw(path);
    assert.notEqual(res.status, 200, `${path} must not serve a document`);
  }
});

test("reading a document requires authentication", async () => {
  const doc = await prisma.supplierDocument.findFirst({ select: { id: true } });
  if (!doc) return;

  // The endpoint streams bytes, so use the raw helper rather than the JSON one.
  const anon = await apiRaw(`/admin/documents/${doc.id}/file`);
  assert.equal(anon.status, 401, "no token — rejected");

  const authed = await apiRaw(`/admin/documents/${doc.id}/file`, { token: adminTok });
  assert.equal(authed.status, 200, "an admin may read it");
  assert.match(authed.contentType ?? "", /pdf|image/, "the document itself is returned");
});

test("a buyer cannot read supplier documents", async () => {
  const doc = await prisma.supplierDocument.findFirst({ select: { id: true } });
  if (!doc) return;

  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Nosy", accountType: "buyer" } });

  const res = await api(`/admin/documents/${doc.id}/file`, { token: reg.body.data.accessToken });
  assert.equal(res.status, 403, "role check blocks a buyer");
});

// ---------------------------------------------------------------------------
// C3 — login rate limiting
// ---------------------------------------------------------------------------

test("repeated failed logins are rate limited", async () => {
  resetRateLimits();
  const email = unique.email();
  await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Target", accountType: "buyer" } });

  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await api("/auth/login", { method: "POST", body: { identifier: email, password: "wrong-password" } });
    statuses.push(res.status);
  }

  assert.ok(statuses.slice(0, 10).every((s) => s === 401), "the first ten attempts fail normally");
  assert.ok(statuses.slice(10).every((s) => s === 429), "further attempts are throttled");
});

test("throttling one account does not lock out other accounts", async () => {
  resetRateLimits();
  const victim = unique.email();
  const other = unique.email();
  for (const email of [victim, other]) {
    await api("/auth/register", { method: "POST", body: {
      email, password: "Passw0rd1", firstName: "User", accountType: "buyer" } });
  }

  for (let i = 0; i < 11; i += 1) {
    await api("/auth/login", { method: "POST", body: { identifier: victim, password: "nope" } });
  }
  const blocked = await api("/auth/login", { method: "POST", body: { identifier: victim, password: "nope" } });
  assert.equal(blocked.status, 429);

  // Same IP, different identifier — must still be able to sign in.
  const ok = await api("/auth/login", { method: "POST", body: { identifier: other, password: "Passw0rd1" } });
  assert.equal(ok.status, 200, "an unrelated account is not collateral damage");
  resetRateLimits();
});

// ---------------------------------------------------------------------------
// 0b — order stock changes go through the ledger
// ---------------------------------------------------------------------------

async function buyerWithAddress() {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Ledger", lastName: "Buyer", accountType: "buyer" } });
  const token = reg.body.data.accessToken;
  const addr = await api("/addresses", { method: "POST", token, body: {
    kind: "shipping", name: "Ledger Buyer", phone: "9876543210",
    line1: "1 Ledger St", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });
  return { token, addressId: addr.body.data.id };
}

test("placing an order writes a DISPATCH movement linked to that order", async () => {
  const { token, addressId } = await buyerWithAddress();
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 4 } });

  const before = await prisma.product.findUnique({ where: { id: product.id }, select: { stock: true } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addressId, paymentMethod: "cod", idempotencyKey: `sec0-${Math.random()}` } });
  assert.equal(placed.status, 201);
  const order = placed.body.data;

  const movement = await prisma.stockMovement.findFirst({
    where: { productId: product.id, type: "DISPATCH", refId: order.id },
  });
  assert.ok(movement, "the dispatch is recorded and linked to its order");
  assert.equal(movement.quantity, -4);
  assert.equal(movement.refType, "Order");

  const after = await prisma.product.findUnique({ where: { id: product.id }, select: { stock: true } });
  assert.equal(after.stock, before.stock - 4);
  assert.equal(movement.balance, after.stock, "the recorded balance matches on-hand stock");
});

test("cancelling an order writes a RETURN movement", async () => {
  const { token, addressId } = await buyerWithAddress();
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 3 } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addressId, paymentMethod: "cod", idempotencyKey: `sec0c-${Math.random()}` } });
  const order = placed.body.data;

  const cancelled = await api(`/orders/${order.id}/cancel`, { method: "POST", token, body: { reason: "changed mind" } });
  assert.equal(cancelled.status, 200);

  const ret = await prisma.stockMovement.findFirst({
    where: { productId: product.id, type: "RETURN", refId: order.id },
  });
  assert.ok(ret, "the restock is recorded");
  assert.equal(ret.quantity, 3);
});

test("after a full order lifecycle the ledger reconciles to zero drift", async () => {
  const { token, addressId } = await buyerWithAddress();
  await api("/cart/items", { method: "POST", token, body: { productId: product.id, quantity: 2 } });
  const placed = await api("/checkout/place", { method: "POST", token, body: {
    shippingAddressId: addressId, paymentMethod: "cod", idempotencyKey: `sec0r-${Math.random()}` } });
  await api(`/orders/${placed.body.data.id}/cancel`, { method: "POST", token, body: { reason: "test" } });

  // The invariant: on-hand stock equals the sum of the ledger.
  const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
  const sum = movements.reduce((s, m) => s + m.quantity, 0);
  const fresh = await prisma.product.findUnique({ where: { id: product.id }, select: { stock: true } });
  assert.equal(sum, fresh.stock, "ledger sums to on-hand stock");

  const res = await api("/admin/inventory/reconcile", { token: adminTok });
  assert.equal(res.status, 200);
  assert.ok(
    !res.body.data.drift.some((d) => d.id === product.id),
    "the ordered product shows no drift",
  );
});
