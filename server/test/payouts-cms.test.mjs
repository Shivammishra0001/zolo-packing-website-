// Phase 3: settlement ledger, saved requirement profiles, CMS blocks.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerBuyer, registerSeller, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { resetRateLimits } from "../src/middleware/rate-limit.mjs";
import { previewPayout, COMMISSION_TAX_BPS } from "../src/services/payouts.mjs";

before(startServer);
beforeEach(resetRateLimits);
after(stopServer);

const period = () => ({
  periodStart: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
});

test("the settlement chain is gross - commission - GST - refunds", async () => {
  const seller = await registerSeller();
  const preview = await previewPayout(seller.supplierId, period());

  // Whatever the figures, the identity must hold exactly.
  const expected =
    preview.grossMinor - preview.commissionMinor - preview.taxOnCommissionMinor - preview.refundsMinor;
  assert.equal(preview.netPayableMinor, expected);
  assert.equal(
    preview.taxOnCommissionMinor,
    Math.round((preview.commissionMinor * COMMISSION_TAX_BPS) / 10_000),
    "GST is charged on the commission, not the goods",
  );
  assert.ok(Number.isInteger(preview.netPayableMinor), "settlement stays in whole paise");
});

test("an invalid period is refused", async () => {
  const seller = await registerSeller();
  const admin = await adminToken();
  for (const body of [
    { periodStart: "not-a-date", periodEnd: new Date().toISOString() },
    // end before start
    { periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() - 86_400_000).toISOString() },
  ]) {
    const res = await api("/admin/payouts", {
      method: "POST", token: admin, body: { supplierId: seller.supplierId, ...body },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "BAD_PERIOD");
  }
});

test("a payout row freezes the figures and is unique per period", async () => {
  const seller = await registerSeller();
  const admin = await adminToken();
  const p = period();

  const created = await api("/admin/payouts", {
    method: "POST", token: admin, body: { supplierId: seller.supplierId, ...p },
  });
  assert.equal(created.status, 201);
  assert.match(created.body.data.payoutNumber, /^PO-[A-Z0-9]+$/);
  assert.equal(created.body.data.status, "PENDING");

  // The same cycle cannot be settled twice.
  const again = await api("/admin/payouts", {
    method: "POST", token: admin, body: { supplierId: seller.supplierId, ...p },
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "PAYOUT_EXISTS");
});

test("marking a payout paid REQUIRES a bank reference", async () => {
  const seller = await registerSeller();
  const admin = await adminToken();
  const created = await api("/admin/payouts", {
    method: "POST", token: admin, body: { supplierId: seller.supplierId, ...period() },
  });

  const noUtr = await api(`/admin/payouts/${created.body.data.id}/pay`, {
    method: "POST", token: admin, body: {},
  });
  assert.equal(noUtr.status, 400);
  assert.equal(noUtr.body.code, "UTR_REQUIRED", "a settlement without a reference is unanswerable in a dispute");

  const paid = await api(`/admin/payouts/${created.body.data.id}/pay`, {
    method: "POST", token: admin, body: { utr: "UTR123456789" },
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.status, "PAID");
  assert.equal(paid.body.data.utr, "UTR123456789");
  assert.ok(paid.body.data.paidAt);
});

test("a paid payout is terminal — it cannot be re-paid or reverted", async () => {
  const seller = await registerSeller();
  const admin = await adminToken();
  const created = await api("/admin/payouts", {
    method: "POST", token: admin, body: { supplierId: seller.supplierId, ...period() },
  });
  await api(`/admin/payouts/${created.body.data.id}/pay`, {
    method: "POST", token: admin, body: { utr: "UTR-ONCE" },
  });

  const twice = await api(`/admin/payouts/${created.body.data.id}/pay`, {
    method: "POST", token: admin, body: { utr: "UTR-AGAIN" },
  });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.code, "ALREADY_PAID");

  const revert = await api(`/admin/payouts/${created.body.data.id}/status`, {
    method: "PATCH", token: admin, body: { status: "PENDING" },
  });
  assert.equal(revert.status, 409, "reverting would erase a recorded transfer");
});

test("paying a payout writes an audit event carrying the UTR", async () => {
  const seller = await registerSeller();
  const admin = await adminToken();
  const created = await api("/admin/payouts", {
    method: "POST", token: admin, body: { supplierId: seller.supplierId, ...period() },
  });
  await api(`/admin/payouts/${created.body.data.id}/pay`, {
    method: "POST", token: admin, body: { utr: "UTR-AUDIT-1" },
  });
  const event = await prisma.auditLog.findFirst({
    where: { eventType: "payout.paid", entityId: created.body.data.id },
  });
  assert.ok(event, "payout.paid recorded");
  assert.equal(event.metadata.utr, "UTR-AUDIT-1");
});

test("a seller sees their own payouts; a buyer cannot reach the ledger", async () => {
  const seller = await registerSeller();
  const admin = await adminToken();
  await api("/admin/payouts", { method: "POST", token: admin, body: { supplierId: seller.supplierId, ...period() } });

  const mine = await api("/sellers/me/payouts", { token: seller.token });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.data.payouts.every((p) => p.supplierId === seller.supplierId), "scoped to their own");

  const buyer = await registerBuyer();
  assert.equal((await api("/admin/payouts", { token: buyer.token })).status, 403);
});

// ---- Saved requirements --------------------------------------------------

test("a buyer saves, lists and deletes a requirement profile", async () => {
  const buyer = await registerBuyer();
  const created = await api("/rfqs/saved", {
    method: "POST", token: buyer.token,
    body: { name: "Monthly mailers", items: [{ productName: "Kraft Mailer", quantity: 5000 }] },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.name, "Monthly mailers");

  const list = await api("/rfqs/saved/list", { token: buyer.token });
  assert.ok(list.body.data.requirements.some((r) => r.id === created.body.data.id));

  const del = await api(`/rfqs/saved/${created.body.data.id}`, { method: "DELETE", token: buyer.token });
  assert.equal(del.status, 200);
});

test("a nameless or empty requirement is refused", async () => {
  const buyer = await registerBuyer();
  const noName = await api("/rfqs/saved", {
    method: "POST", token: buyer.token, body: { name: "  ", items: [{ quantity: 1 }] },
  });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, "NAME_REQUIRED");

  const noItems = await api("/rfqs/saved", {
    method: "POST", token: buyer.token, body: { name: "Empty", items: [] },
  });
  assert.equal(noItems.status, 400);
  assert.equal(noItems.body.code, "ITEMS_REQUIRED");
});

test("a buyer cannot delete another buyer's saved requirement", async () => {
  const [a, b] = [await registerBuyer(), await registerBuyer()];
  const created = await api("/rfqs/saved", {
    method: "POST", token: a.token, body: { name: "Mine", items: [{ quantity: 1 }] },
  });
  const attempt = await api(`/rfqs/saved/${created.body.data.id}`, { method: "DELETE", token: b.token });
  assert.equal(attempt.status, 404, "404, not 403 — do not confirm it exists");
  assert.ok(await prisma.savedRequirement.findUnique({ where: { id: created.body.data.id } }), "still there");
});

// ---- CMS -----------------------------------------------------------------

test("admin saves a CMS block; the public endpoint serves only active ones", async () => {
  const admin = await adminToken();
  const key = `hero-${Math.random().toString(36).slice(2, 8)}`;

  const saved = await api("/admin/cms", {
    method: "PUT", token: admin,
    body: { key, title: "Packaging that ships", payload: { cta: "/shop" }, sortOrder: 1 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.key, key);

  const pub = await api("/public/cms");
  assert.equal(pub.status, 200, "the storefront reads CMS without authentication");
  assert.ok(pub.body.data.blocks.some((b) => b.key === key));

  // Deactivate — it must vanish from the public list but stay for admin.
  await api("/admin/cms", { method: "PUT", token: admin, body: { key, isActive: false } });
  const after = await api("/public/cms");
  assert.ok(!after.body.data.blocks.some((b) => b.key === key), "inactive blocks are not public");
  const adminList = await api("/admin/cms", { token: admin });
  assert.ok(adminList.body.data.blocks.some((b) => b.key === key), "admin still sees it");
});

test("saving the same key updates rather than duplicating", async () => {
  const admin = await adminToken();
  const key = `banner-${Math.random().toString(36).slice(2, 8)}`;
  await api("/admin/cms", { method: "PUT", token: admin, body: { key, title: "First" } });
  await api("/admin/cms", { method: "PUT", token: admin, body: { key, title: "Second" } });
  const rows = await prisma.cmsBlock.findMany({ where: { key } });
  assert.equal(rows.length, 1, "the key is the stable handle");
  assert.equal(rows[0].title, "Second");
});

test("a CMS block needs a key, and only an admin may write one", async () => {
  const admin = await adminToken();
  const noKey = await api("/admin/cms", { method: "PUT", token: admin, body: { title: "Orphan" } });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.code, "KEY_REQUIRED");

  const buyer = await registerBuyer();
  const forbidden = await api("/admin/cms", { method: "PUT", token: buyer.token, body: { key: "x" } });
  assert.equal(forbidden.status, 403);
});
