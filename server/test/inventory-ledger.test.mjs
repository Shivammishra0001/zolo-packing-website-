// Inventory ledger.
//
// The property that matters: Product.stock is always explainable by the sum of
// its StockMovement rows. If those two ever disagree, something wrote stock
// outside recordMovement — which is exactly what `reconcile` is for.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

let adminTok;

before(async () => {
  await startServer();
  adminTok = await adminToken();
});

after(async () => {
  await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: "TST-LEDGER" } } } }).catch(() => {});
  await prisma.product.deleteMany({ where: { sku: { startsWith: "TST-LEDGER" } } }).catch(() => {});
  await stopServer();
});

let seq = 0;
async function ledgerProduct(stock = 0) {
  seq += 1;
  const sku = `TST-LEDGER-${Date.now()}-${seq}`;
  return prisma.product.create({
    data: {
      id: `PRD-LDG${Date.now() % 100000}${seq}`,
      sku, slug: sku.toLowerCase(),
      name: "Ledger Test Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 10000, moq: 1, stock, lowStockLevel: 10,
    },
  });
}

const post = (body) => api("/admin/inventory/movements", { method: "POST", token: adminTok, body });

test("movement directions are derived server-side, not taken from the caller", async () => {
  const p = await ledgerProduct(0);

  const receipt = await post({ productId: p.id, type: "RECEIPT", quantity: 100, reason: "opening" });
  assert.equal(receipt.status, 201);
  assert.equal(receipt.body.data.movement.quantity, 100, "RECEIPT adds");
  assert.equal(receipt.body.data.movement.balance, 100);

  const dispatch = await post({ productId: p.id, type: "DISPATCH", quantity: 30 });
  assert.equal(dispatch.body.data.movement.quantity, -30, "DISPATCH subtracts even though 30 was sent positive");
  assert.equal(dispatch.body.data.movement.balance, 70);

  const damage = await post({ productId: p.id, type: "DAMAGE", quantity: 5 });
  assert.equal(damage.body.data.movement.quantity, -5);
  assert.equal(damage.body.data.movement.balance, 65);

  const fresh = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } });
  assert.equal(fresh.stock, 65, "Product.stock tracks the ledger");
});

test("stock can never be driven negative", async () => {
  const p = await ledgerProduct(0);
  await post({ productId: p.id, type: "RECEIPT", quantity: 10 });

  const res = await post({ productId: p.id, type: "DISPATCH", quantity: 999 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "INSUFFICIENT_STOCK");

  const fresh = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } });
  assert.equal(fresh.stock, 10, "the rejected movement left stock untouched");
  assert.equal(await prisma.stockMovement.count({ where: { productId: p.id } }), 1,
    "no ledger row is written for a rejected movement");
});

test("a product with pre-existing stock gets an opening balance on its first movement", async () => {
  // This is the case that would otherwise show permanent, unexplainable drift.
  const p = await ledgerProduct(500);

  await post({ productId: p.id, type: "DAMAGE", quantity: 20 });

  const rows = await prisma.stockMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 2, "the damage plus a back-posted opening balance");
  assert.equal(rows[0].type, "ADJUSTMENT");
  assert.equal(rows[0].quantity, 500, "opening balance equals the stock that predated the ledger");
  assert.equal(rows[0].refType, "opening");
  assert.equal(rows[1].quantity, -20);

  const sum = rows.reduce((s, r) => s + r.quantity, 0);
  const fresh = await prisma.product.findUnique({ where: { id: p.id }, select: { stock: true } });
  assert.equal(sum, fresh.stock, "ledger sums to on-hand stock");
});

test("ADJUSTMENT is the only signed type; directional types reject a negative magnitude", async () => {
  const p = await ledgerProduct(0);
  await post({ productId: p.id, type: "RECEIPT", quantity: 50 });

  const down = await post({ productId: p.id, type: "ADJUSTMENT", quantity: -8, reason: "stock take" });
  assert.equal(down.body.data.movement.quantity, -8);
  assert.equal(down.body.data.movement.balance, 42);

  const up = await post({ productId: p.id, type: "ADJUSTMENT", quantity: 3, reason: "found" });
  assert.equal(up.body.data.movement.balance, 45);

  const bad = await post({ productId: p.id, type: "DISPATCH", quantity: -5 });
  assert.equal(bad.status, 400, "a negative DISPATCH is a caller error, not a stock increase");
});

test("invalid input is rejected", async () => {
  const p = await ledgerProduct(10);
  assert.equal((await post({ productId: p.id, type: "TELEPORT", quantity: 1 })).status, 400);
  assert.equal((await post({ productId: p.id, type: "RECEIPT", quantity: 0 })).status, 400);
  assert.equal((await post({ productId: p.id, type: "RECEIPT", quantity: 1.5 })).status, 400);
  assert.equal((await post({ productId: "PRD-NOPE", type: "RECEIPT", quantity: 1 })).status, 404);
});

test("reconcile detects stock written outside the ledger", async () => {
  const p = await ledgerProduct(0);
  await post({ productId: p.id, type: "RECEIPT", quantity: 100 });

  const clean = await api("/admin/inventory/reconcile", { token: adminTok });
  assert.equal(clean.status, 200);
  assert.ok(!clean.body.data.drift.some((d) => d.id === p.id), "a ledger-only product shows no drift");

  // Simulate a rogue write that bypasses recordMovement.
  await prisma.product.update({ where: { id: p.id }, data: { stock: 999 } });

  const dirty = await api("/admin/inventory/reconcile", { token: adminTok });
  const row = dirty.body.data.drift.find((d) => d.id === p.id);
  assert.ok(row, "drift is reported when stock bypasses the ledger");
  assert.equal(row.stock, 999);
  assert.equal(row.ledger, 100);
});

test("the ledger records who made each movement and writes an audit event", async () => {
  const p = await ledgerProduct(0);
  await post({ productId: p.id, type: "RECEIPT", quantity: 25, reason: "supplier delivery" });

  const list = await api(`/admin/inventory/movements?productId=${p.id}`, { token: adminTok });
  assert.equal(list.status, 200);
  const m = list.body.data.movements[0];
  assert.equal(m.type, "RECEIPT");
  assert.equal(m.reason, "supplier delivery");
  assert.notEqual(m.actor, "System", "the acting admin is attributed");
  assert.equal(m.sku, p.sku);

  const event = await prisma.auditLog.findFirst({
    where: { eventType: "inventory.adjusted", entityId: p.id },
  });
  assert.ok(event, "an audit event is recorded");
  assert.equal(event.metadata.type, "RECEIPT");
});

test("only an admin can read or write the ledger", async () => {
  const p = await ledgerProduct(10);

  const anonRead = await api("/admin/inventory/movements");
  assert.equal(anonRead.status, 401);

  const anonWrite = await api("/admin/inventory/movements", {
    method: "POST", body: { productId: p.id, type: "RECEIPT", quantity: 1 } });
  assert.equal(anonWrite.status, 401);
});
