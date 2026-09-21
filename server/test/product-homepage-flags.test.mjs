// Homepage merchandising flags (Featured / Fresh on the Market) are chosen by
// the admin and stored in PostgreSQL:
//   POST/PUT/PATCH /products accept + persist them, GET /products returns them,
//   an order is only kept while its flag is on, and nothing is ever promoted
//   automatically.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerBuyer } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const created = [];
const sku = (t) => { const s = `ZOLO-TEST-HP-${t}-${rnd()}`; created.push(s); return s; };

let ADMIN; let CAT;
before(async () => {
  await startServer();
  ADMIN = await adminToken();
  await api("/categories", { method: "POST", token: ADMIN, body: { name: "Boxes" } });
  CAT = (await api("/categories")).body.data.tree.find((c) => c.name === "Boxes");
});
after(async () => {
  if (created.length) await prisma.product.deleteMany({ where: { sku: { in: created } } });
  await stopServer();
});

const make = (body) => api("/products", { method: "POST", token: ADMIN, body: { categoryId: CAT.id, basePriceMinor: 1000, moq: 1, status: "active", ...body } });

test("a product is in NEITHER rail unless the admin says so (no automatic promotion)", async () => {
  const res = await make({ name: "Plain Box", sku: sku("PLAIN") });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data.product;
  assert.equal(p.isFeatured, false); assert.equal(p.featuredOrder, null);
  assert.equal(p.isNewArrival, false); assert.equal(p.newArrivalOrder, null);
  const listed = (await api("/products")).body.data.products.find((x) => x.id === p.id);
  assert.equal(listed.isFeatured, false); assert.equal(listed.isNewArrival, false);
});

test("create with Featured ON persists the flag + order and GET /products returns them", async () => {
  const res = await make({ name: "Featured Box", sku: sku("FEAT"), isFeatured: true, featuredOrder: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data.product;
  const row = await prisma.product.findUnique({ where: { id: p.id } });
  assert.equal(row.isFeatured, true); assert.equal(row.featuredOrder, 1);
  assert.equal(row.isNewArrival, false); assert.equal(row.newArrivalOrder, null);
  const listed = (await api("/products")).body.data.products.find((x) => x.id === p.id);
  assert.equal(listed.isFeatured, true); assert.equal(listed.featuredOrder, 1);
});

test("edit moves a product between rails; turning a rail off clears its order", async () => {
  const p = (await make({ name: "Moving Box", sku: sku("MOVE"), isFeatured: true, featuredOrder: 3 })).body.data.product;
  const upd = await api(`/products/${p.id}`, { method: "PUT", token: ADMIN, body: { isFeatured: false, isNewArrival: true, newArrivalOrder: 1 } });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const row = await prisma.product.findUnique({ where: { id: p.id } });
  assert.equal(row.isFeatured, false); assert.equal(row.featuredOrder, null, "order cleared with the flag");
  assert.equal(row.isNewArrival, true); assert.equal(row.newArrivalOrder, 1);

  // Quick toggle (row menu) = a PATCH of just the flag.
  const off = await api(`/products/${p.id}`, { method: "PATCH", token: ADMIN, body: { isNewArrival: false } });
  assert.equal(off.body.data.product.isNewArrival, false);
  assert.equal(off.body.data.product.newArrivalOrder, null);

  // An order sent while the flag is off must not stick.
  const stray = await api(`/products/${p.id}`, { method: "PATCH", token: ADMIN, body: { featuredOrder: 5 } });
  assert.equal(stray.body.data.product.featuredOrder, null);
});

test("both rails are independent: one product may be in both with separate orders", async () => {
  const p = (await make({ name: "Both Box", sku: sku("BOTH"), isFeatured: true, featuredOrder: 2, isNewArrival: true, newArrivalOrder: 7 })).body.data.product;
  assert.equal(p.isFeatured, true); assert.equal(p.featuredOrder, 2);
  assert.equal(p.isNewArrival, true); assert.equal(p.newArrivalOrder, 7);
  // An unrelated edit leaves the placement alone.
  const upd = await api(`/products/${p.id}`, { method: "PATCH", token: ADMIN, body: { stock: 9 } });
  assert.equal(upd.body.data.product.featuredOrder, 2); assert.equal(upd.body.data.product.newArrivalOrder, 7);
  // Flag on with no order is valid (sorted after ordered picks by the storefront).
  const noOrder = await make({ name: "Unordered Featured", sku: sku("NOORD"), isFeatured: true });
  assert.equal(noOrder.status, 201); assert.equal(noOrder.body.data.product.featuredOrder, null);
});

test("order must be a positive integer; the flags are admin-only", async () => {
  for (const bad of [0, -1, 1.5, "2"]) {
    const res = await make({ name: "Bad Order", sku: sku("BAD"), isFeatured: true, featuredOrder: bad });
    assert.equal(res.status, 400, `featuredOrder=${JSON.stringify(bad)} should be rejected`);
    assert.ok(res.body.issues.some((i) => i.path === "featuredOrder"));
  }
  const notBool = await make({ name: "Bad Flag", sku: sku("BADF"), isNewArrival: "yes" });
  assert.equal(notBool.status, 400);
  const target = (await make({ name: "Guarded", sku: sku("GUARD") })).body.data.product;
  const buyer = await registerBuyer();
  assert.equal((await api(`/products/${target.id}`, { method: "PATCH", token: buyer.token, body: { isFeatured: true } })).status, 403);
  assert.equal((await api(`/products/${target.id}`, { method: "PATCH", body: { isFeatured: true } })).status, 401);
  assert.equal((await prisma.product.findUnique({ where: { id: target.id } })).isFeatured, false);
});
