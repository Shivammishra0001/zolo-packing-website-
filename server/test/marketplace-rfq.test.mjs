// Marketplace RFQ: auto-matching, competing seller quotes, versioned
// negotiation history, and per-pair message isolation.
import { test as baseTest, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerBuyer, registerSeller, adminToken, makeProduct } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import * as marketplace from "../src/services/marketplace.mjs";
// This suite creates many sellers and buyers; without this the register
// limiter (20/hr per IP) exhausts partway through and later tests fail on a
// missing token rather than on what they actually assert.
import { resetRateLimits } from "../src/middleware/rate-limit.mjs";

// Serial within this file: these tests share one database with the other RFQ
// suites, and auto-matching can invite the same sellers across them.
const test = (name, fn) => baseTest(name, { concurrency: 1 }, fn);

before(startServer);
beforeEach(resetRateLimits);
after(stopServer);

// An approved supplier is the only kind eligible for matching.
async function approvedSeller() {
  const s = await registerSeller();
  await prisma.supplierProfile.update({ where: { id: s.supplierId }, data: { status: "APPROVED" } });
  return s;
}

async function buyerRfq() {
  const buyer = await registerBuyer();
  const p = await makeProduct({ name: "Match Box" });
  const res = await api("/rfqs", {
    method: "POST",
    token: buyer.token,
    body: { items: [{ productId: p.id, quantity: 5000 }], ship: { city: "Bengaluru", state: "Karnataka" } },
  });
  assert.equal(res.status, 201);
  return { buyer, rfq: res.body.data, product: p };
}

test("an invited seller sees the lead with its score and reasons", async () => {
  const seller = await approvedSeller();
  const { rfq } = await buyerRfq();
  // Invite explicitly so the test does not depend on how many other approved
  // suppliers happen to exist in the shared test database.
  await marketplace.matchRfqToSuppliers(rfq.id);
  await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } },
    update: {},
    create: { rfqId: rfq.id, supplierId: seller.supplierId, score: 70, reasons: ["category match"] },
  });

  const leads = await api("/sellers/rfqs", { token: seller.token });
  assert.equal(leads.status, 200);
  const lead = leads.body.data.leads.find((l) => l.rfq.id === rfq.id);
  assert.ok(lead, "the invited seller sees the lead");
  assert.equal(lead.status, "INVITED");
  assert.ok(Array.isArray(lead.reasons), "the shortlist reason is surfaced");
  assert.equal(lead.rfq.totalQuantity, 5000);
});

test("a seller who was not invited cannot quote", async () => {
  const outsider = await approvedSeller();
  const { rfq } = await buyerRfq();
  const res = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST",
    token: outsider.token,
    body: { items: [{ unitPriceMinor: 100, quantity: 10 }] },
  });
  assert.equal(res.status, 403);
  // forbidden() in lib/http.mjs always codes FORBIDDEN; the message carries
  // the specific reason.
  assert.match(res.body.error, /not invited/i);
});

test("two sellers compete on one RFQ, each seeing only their own quote", async () => {
  const [s1, s2] = [await approvedSeller(), await approvedSeller()];
  const { buyer, rfq } = await buyerRfq();
  for (const s of [s1, s2]) {
    await prisma.rfqMatch.upsert({
      where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: s.supplierId } },
      update: {}, create: { rfqId: rfq.id, supplierId: s.supplierId },
    });
  }
  const item = rfq.items[0];

  const q1 = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: s1.token,
    body: { items: [{ rfqItemId: item.id, unitPriceMinor: 1200 }], leadTimeDays: 20 },
  });
  const q2 = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: s2.token,
    body: { items: [{ rfqItemId: item.id, unitPriceMinor: 1100 }], leadTimeDays: 25 },
  });
  assert.equal(q1.status, 201);
  assert.equal(q2.status, 201);
  assert.notEqual(q1.body.data.id, q2.body.data.id, "each seller gets their own quotation");
  assert.equal(q1.body.data.subtotalMinor, 1200 * 5000);
  assert.equal(q2.body.data.subtotalMinor, 1100 * 5000);

  // The buyer sees both and can compare.
  const mine = await api(`/rfqs/${rfq.id}`, { token: buyer.token });
  assert.equal(mine.body.data.quotations.length, 2, "buyer compares both quotes");
});

test("re-quoting bumps the version and preserves the ladder", async () => {
  const seller = await approvedSeller();
  const { rfq } = await buyerRfq();
  await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: seller.supplierId },
  });
  const item = rfq.items[0];

  const v1 = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: seller.token, body: { items: [{ rfqItemId: item.id, unitPriceMinor: 1500 }] },
  });
  const v2 = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: seller.token, body: { items: [{ rfqItemId: item.id, unitPriceMinor: 1300 }] },
  });
  assert.equal(v1.body.data.version, 1);
  assert.equal(v2.body.data.version, 2);
  assert.equal(v1.body.data.id, v2.body.data.id, "the live quotation row is updated, not duplicated");

  const history = await api(`/quotations/${v2.body.data.id}/history`, { token: seller.token });
  assert.equal(history.body.data.versions.length, 2, "both versions survive");
  assert.equal(history.body.data.versions[0].grandTotalMinor, 1500 * 5000, "v1 price is still readable");
  assert.equal(history.body.data.versions[1].grandTotalMinor, 1300 * 5000);
});

test("quoting marks the lead QUOTED; declining marks it DECLINED", async () => {
  const seller = await approvedSeller();
  const { rfq } = await buyerRfq();
  await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: seller.supplierId },
  });

  await api(`/sellers/rfqs/${rfq.id}/view`, { method: "POST", token: seller.token });
  let m = await prisma.rfqMatch.findUnique({ where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } } });
  assert.equal(m.status, "VIEWED");
  assert.ok(m.viewedAt);

  const q = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: seller.token, body: { items: [{ rfqItemId: rfq.items[0].id, unitPriceMinor: 900 }] },
  });
  assert.equal(q.status, 201, `quote must succeed first: ${JSON.stringify(q.body).slice(0, 160)}`);
  m = await prisma.rfqMatch.findUnique({ where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } } });
  assert.equal(m.status, "QUOTED");

  // A different seller declines instead.
  const other = await approvedSeller();
  const second = await buyerRfq();
  await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: second.rfq.id, supplierId: other.supplierId } },
    update: {}, create: { rfqId: second.rfq.id, supplierId: other.supplierId },
  });
  const dec = await api(`/sellers/rfqs/${second.rfq.id}/decline`, { method: "POST", token: other.token });
  assert.equal(dec.status, 200);
  assert.equal(dec.body.data.status, "DECLINED");
});

test("a seller cannot decline after quoting", async () => {
  const seller = await approvedSeller();
  const { rfq } = await buyerRfq();
  await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: seller.supplierId },
  });
  const quoted = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: seller.token, body: { items: [{ rfqItemId: rfq.items[0].id, unitPriceMinor: 800 }] },
  });
  assert.equal(quoted.status, 201, `quote must succeed first: ${JSON.stringify(quoted.body).slice(0, 160)}`);
  const res = await api(`/sellers/rfqs/${rfq.id}/decline`, { method: "POST", token: seller.token });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "ALREADY_QUOTED");
});

test("message threads are private to each buyer/seller pair", async () => {
  const [s1, s2] = [await approvedSeller(), await approvedSeller()];
  const { buyer, rfq } = await buyerRfq();
  for (const s of [s1, s2]) {
    await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: s.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: s.supplierId },
  });
  }

  const sent = await api(`/rfqs/${rfq.id}/messages`, {
    method: "POST", token: buyer.token,
    body: { supplierId: s1.supplierId, body: "Can you do 18 days?" },
  });
  assert.equal(sent.status, 201);

  // Seller 1 sees it.
  const forS1 = await api(`/rfqs/${rfq.id}/messages`, { token: s1.token });
  assert.equal(forS1.body.data.messages.length, 1);

  // Seller 2 must NOT — they are pinned to their own empty thread.
  const forS2 = await api(`/rfqs/${rfq.id}/messages`, { token: s2.token });
  assert.equal(forS2.body.data.messages.length, 0, "a rival's conversation is invisible");
});

test("a seller cannot read a thread by naming another supplier's id", async () => {
  const [s1, s2] = [await approvedSeller(), await approvedSeller()];
  const { buyer, rfq } = await buyerRfq();
  for (const s of [s1, s2]) {
    await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: s.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: s.supplierId },
  });
  }
  await api(`/rfqs/${rfq.id}/messages`, {
    method: "POST", token: buyer.token, body: { supplierId: s1.supplierId, body: "private" },
  });

  // s2 explicitly asks for s1's thread — the server pins them to their own.
  const peek = await api(`/rfqs/${rfq.id}/messages?supplierId=${s1.supplierId}`, { token: s2.token });
  assert.equal(peek.status, 200);
  assert.equal(peek.body.data.messages.length, 0, "supplierId from the query must not be trusted");
});

test("an empty message is refused", async () => {
  const seller = await approvedSeller();
  const { buyer, rfq } = await buyerRfq();
  await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: seller.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: seller.supplierId },
  });
  const res = await api(`/rfqs/${rfq.id}/messages`, {
    method: "POST", token: buyer.token, body: { supplierId: seller.supplierId, body: "   " },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "EMPTY_MESSAGE");
});

test("accepting a seller's quote creates an order and withdraws rivals", async () => {
  const [s1, s2] = [await approvedSeller(), await approvedSeller()];
  const { buyer, rfq } = await buyerRfq();
  for (const s of [s1, s2]) {
    await prisma.rfqMatch.upsert({
    where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: s.supplierId } },
    update: {}, create: { rfqId: rfq.id, supplierId: s.supplierId },
  });
  }
  const item = rfq.items[0];
  const q1 = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: s1.token, body: { items: [{ rfqItemId: item.id, unitPriceMinor: 1200 }] },
  });
  const q2 = await api(`/sellers/rfqs/${rfq.id}/quote`, {
    method: "POST", token: s2.token, body: { items: [{ rfqItemId: item.id, unitPriceMinor: 1100 }] },
  });

  const accepted = await api(`/quotations/${q2.body.data.id}/accept`, { method: "POST", token: buyer.token });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.data.order.grandTotalMinor, q2.body.data.grandTotalMinor);

  const loser = await prisma.quotation.findUnique({ where: { id: q1.body.data.id }, select: { status: true } });
  assert.equal(loser.status, "WITHDRAWN", "the losing quote is withdrawn, not left open");
});

test("admin can re-run matching, and it does not duplicate invitations", async () => {
  const admin = await adminToken();
  const { rfq } = await buyerRfq();
  const first = await api(`/admin/rfqs/${rfq.id}/match`, { method: "POST", token: admin });
  assert.equal(first.status, 200);
  const before = await prisma.rfqMatch.count({ where: { rfqId: rfq.id } });
  await api(`/admin/rfqs/${rfq.id}/match`, { method: "POST", token: admin });
  assert.equal(await prisma.rfqMatch.count({ where: { rfqId: rfq.id } }), before, "re-matching is idempotent");
});
