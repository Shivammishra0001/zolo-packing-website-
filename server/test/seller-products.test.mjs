// Supplier-owned catalog listings: ownership cannot be forged, a supplier
// cannot publish, and nothing unapproved reaches the storefront.
// See docs/adr/ADR-001-supplier-owned-products.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerSeller, completeMinimum } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8);
let ADMIN;

before(async () => { await startServer(); ADMIN = await adminToken(); });
after(async () => {
  await prisma.product.deleteMany({ where: { sku: { startsWith: "ZOLO-SP-" } } });
  await stopServer();
});

const admin = (p, o = {}) => api(p, { token: ADMIN, ...o });

/** An approved supplier, ready to list products. */
async function approvedSeller() {
  const s = await registerSeller();
  await completeMinimum(s.token);
  await api("/sellers/me/onboarding/submit", { method: "POST", token: s.token });
  const res = await admin(`/admin/sellers/${s.supplierId}/approve`, { method: "POST" });
  assert.equal(res.body.data.status, "APPROVED", "fixture seller must be approved");
  return s;
}

const draft = (over = {}) => ({
  name: `Supplier Box ${rnd()}`,
  sku: `ZOLO-SP-${rnd().toUpperCase()}`,
  category: "Boxes",
  basePriceMinor: 5000,
  moq: 100,
  stock: 250,
  ...over,
});

// ---------------------------------------------------------------------------

test("an unapproved supplier cannot list products at all", async () => {
  const s = await registerSeller(); // DRAFT — never submitted
  const res = await api("/sellers/me/products", { method: "POST", token: s.token, body: draft() });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test("a submitted listing lands in pending_review, owned by the supplier, and is NOT on the storefront", async () => {
  const s = await approvedSeller();
  const body = draft();
  const res = await api("/sellers/me/products", { method: "POST", token: s.token, body });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const row = await prisma.product.findUnique({ where: { id: res.body.data.id } });
  assert.equal(row.status, "pending_review", "a supplier cannot publish");
  assert.equal(row.supplierProfileId, s.supplierId, "owned by the approved company");
  assert.ok(row.sellerId, "submitting user recorded for attribution");

  // The storefront only ever shows `active`.
  const pub = await api(`/products?limit=200`);
  const skus = (pub.body.data.products ?? []).map((p) => p.sku);
  assert.ok(!skus.includes(body.sku), "pending listing must not be buyer-visible");
});

test("ownership cannot be forged: supplierProfileId/sellerId/status/commission in the body are ignored", async () => {
  const victim = await approvedSeller();
  const attacker = await approvedSeller();

  const res = await api("/sellers/me/products", {
    method: "POST",
    token: attacker.token,
    body: draft({
      supplierProfileId: victim.supplierId, // try to list AS the victim
      sellerId: "some-other-user",
      status: "active",                      // try to self-publish
      commissionBps: 0,                      // try to zero the commission
    }),
  });
  assert.equal(res.status, 201);

  const row = await prisma.product.findUnique({ where: { id: res.body.data.id } });
  assert.equal(row.supplierProfileId, attacker.supplierId, "ownership comes from the session, not the body");
  assert.notEqual(row.supplierProfileId, victim.supplierId);
  assert.equal(row.status, "pending_review", "status comes from the service, not the body");
  assert.notEqual(row.commissionBps, 0, "commission is admin-only");
});

test("a supplier sees only their own listings", async () => {
  const a = await approvedSeller();
  const b = await approvedSeller();
  const mine = draft();
  await api("/sellers/me/products", { method: "POST", token: a.token, body: mine });
  await api("/sellers/me/products", { method: "POST", token: b.token, body: draft() });

  const listA = await api("/sellers/me/products", { token: a.token });
  assert.equal(listA.status, 200);
  const skus = listA.body.data.products.map((p) => p.sku);
  assert.ok(skus.includes(mine.sku));
  assert.equal(listA.body.data.products.every((p) => p.sku.startsWith("ZOLO-SP-")), true);
  assert.equal(listA.body.data.total, 1, "only this supplier's own listing");
});

test("a supplier cannot edit or withdraw another supplier's listing (404, never 403)", async () => {
  const owner = await approvedSeller();
  const other = await approvedSeller();
  const created = await api("/sellers/me/products", { method: "POST", token: owner.token, body: draft() });
  const id = created.body.data.id;

  const edit = await api(`/sellers/me/products/${id}`, { method: "PATCH", token: other.token, body: { name: "Hijacked" } });
  assert.equal(edit.status, 404, "never confirm someone else's record exists");

  const pull = await api(`/sellers/me/products/${id}/withdraw`, { method: "POST", token: other.token });
  assert.equal(pull.status, 404);

  const row = await prisma.product.findUnique({ where: { id } });
  assert.notEqual(row.name, "Hijacked");
});

test("admin approves a listing: it goes live and commission is set by the admin", async () => {
  const s = await approvedSeller();
  const created = await api("/sellers/me/products", { method: "POST", token: s.token, body: draft() });
  const id = created.body.data.id;

  const queue = await admin("/admin/product-listings/pending");
  assert.equal(queue.status, 200);
  assert.ok(queue.body.data.products.some((p) => p.id === id), "listing is in the review queue");

  const ok = await admin(`/admin/product-listings/${id}/approve`, { method: "POST", body: { commissionBps: 800 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const row = await prisma.product.findUnique({ where: { id } });
  assert.equal(row.status, "active");
  assert.equal(row.commissionBps, 800);
  assert.equal(row.rejectionNote, null);
});

test("admin rejects with a reason; a reason is required", async () => {
  const s = await approvedSeller();
  const created = await api("/sellers/me/products", { method: "POST", token: s.token, body: draft() });
  const id = created.body.data.id;

  const noReason = await admin(`/admin/product-listings/${id}/reject`, { method: "POST", body: {} });
  assert.equal(noReason.status, 400, "the supplier needs something to act on");

  const res = await admin(`/admin/product-listings/${id}/reject`, { method: "POST", body: { reason: "Images are too low-resolution" } });
  assert.equal(res.status, 200);

  const row = await prisma.product.findUnique({ where: { id } });
  assert.equal(row.status, "draft", "back to the supplier, not archived");
  assert.equal(row.rejectionNote, "Images are too low-resolution");
});

test("EVERY edit to a live listing returns it to review and off the storefront", async () => {
  const s = await approvedSeller();
  const body = draft();
  const created = await api("/sellers/me/products", { method: "POST", token: s.token, body });
  const id = created.body.data.id;
  await admin(`/admin/product-listings/${id}/approve`, { method: "POST" });
  assert.equal((await prisma.product.findUnique({ where: { id } })).status, "active");

  // Even a harmless-looking description change re-enters review (the decided rule).
  const edit = await api(`/sellers/me/products/${id}`, { method: "PATCH", token: s.token, body: { description: "Now with a nicer description" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));

  const row = await prisma.product.findUnique({ where: { id } });
  assert.equal(row.status, "pending_review", "an edit cannot stay live unreviewed");

  const pub = await api(`/products?limit=200`);
  assert.ok(!(pub.body.data.products ?? []).map((p) => p.sku).includes(body.sku), "edited listing leaves the storefront");
});

test("withdrawing archives the listing; order history is never deleted", async () => {
  const s = await approvedSeller();
  const created = await api("/sellers/me/products", { method: "POST", token: s.token, body: draft() });
  const id = created.body.data.id;
  await admin(`/admin/product-listings/${id}/approve`, { method: "POST" });

  const res = await api(`/sellers/me/products/${id}/withdraw`, { method: "POST", token: s.token });
  assert.equal(res.status, 200);
  const row = await prisma.product.findUnique({ where: { id } });
  assert.equal(row.status, "archived");
  assert.equal(row.deletedAt, null, "soft only — snapshots and history must hold");
});

test("the admin supplier page lists that supplier's products with status counts", async () => {
  const s = await approvedSeller();
  const a = await api("/sellers/me/products", { method: "POST", token: s.token, body: draft() });
  await api("/sellers/me/products", { method: "POST", token: s.token, body: draft() });
  await admin(`/admin/product-listings/${a.body.data.id}/approve`, { method: "POST" });

  const res = await admin(`/admin/sellers/${s.supplierId}/products`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 2);
  assert.equal(res.body.data.byStatus.active, 1);
  assert.equal(res.body.data.byStatus.pending_review, 1);
});

test("house-catalog products are not supplier listings and cannot be moderated", async () => {
  const house = await admin("/products", { method: "POST", body: draft({ name: `House Box ${rnd()}` }) });
  assert.equal(house.status, 201, JSON.stringify(house.body));
  const id = house.body.data.product.id;

  const row = await prisma.product.findUnique({ where: { id } });
  assert.equal(row.supplierProfileId, null, "admin-created products stay house catalog");

  const res = await admin(`/admin/product-listings/${id}/approve`, { method: "POST" });
  assert.equal(res.status, 400, "a house product is not a listing awaiting review");
});

test("GET /products hides unpublished rows from the public but not from an admin", async () => {
  // Regression: this PUBLIC route had no status filter at all, so drafts —
  // and later supplier listings awaiting moderation — were served to anyone
  // who called the API directly. The storefront only looked safe because it
  // filtered again in the browser.
  const sku = `ZOLO-SP-${rnd().toUpperCase()}`;
  const created = await admin("/products", { method: "POST", body: draft({ sku, status: "draft" }) });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const anon = await api("/products?limit=500");
  const anonSkus = (anon.body.data.products ?? []).map((p) => p.sku);
  assert.ok(!anonSkus.includes(sku), "a draft must not be served to the public");
  assert.equal((anon.body.data.products ?? []).every((p) => p.status === "active"), true, "public sees only live products");

  // The admin still sees everything without asking for a special scope.
  const asAdmin = await admin("/products?limit=500");
  assert.ok((asAdmin.body.data.products ?? []).map((p) => p.sku).includes(sku), "an admin sees drafts");

  // ...and a public caller cannot opt back in by naming the status.
  const forced = await api(`/products?status=draft&limit=500`);
  assert.equal((forced.body.data.products ?? []).some((p) => p.sku === sku), false, "?status=draft must not leak drafts");
});

test("a non-admin cannot reach the moderation routes", async () => {
  const s = await approvedSeller();
  for (const path of ["/admin/product-listings/pending", `/admin/sellers/${s.supplierId}/products`]) {
    const res = await api(path, { token: s.token });
    assert.ok([401, 403].includes(res.status), `${path} -> ${res.status}`);
  }
});
