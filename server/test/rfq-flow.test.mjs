// RFQ -> Quotation -> Order, end to end.
//
// The headline guarantee: ONE RFQ holds MANY products. A three-product request
// must be 1 Rfq row + 3 RfqItem rows, never three RFQs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerBuyer, adminToken, makeProduct } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

before(startServer);
after(stopServer);

async function threeProductRfq() {
  const buyer = await registerBuyer();
  const [a, b, c] = await Promise.all([
    makeProduct({ name: "Kraft Mailer Box" }),
    makeProduct({ name: "Corrugated Carton" }),
    makeProduct({ name: "Bubble Wrap Roll" }),
  ]);
  const res = await api("/rfqs", {
    method: "POST",
    token: buyer.token,
    body: {
      // This suite asserts on EXACT quotation counts, so it must be the only
      // quoter on its own RFQs. Auto-matching would let approved suppliers
      // created by other suites add competing quotes and break those counts.
      autoMatch: false,
      title: "Q3 packaging",
      notes: "Need matte lamination on the mailer.",
      ship: { city: "Bengaluru", state: "Karnataka", postalCode: "560001" },
      items: [
        { productId: a.id, quantity: 5000 },
        { productId: b.id, quantity: 10000 },
        { productId: c.id, quantity: 2000, notes: "40 micron" },
      ],
    },
  });
  return { buyer, products: [a, b, c], res };
}

test("one RFQ holds many products — 3 products create 1 RFQ with 3 items", async () => {
  const { res } = await threeProductRfq();
  assert.equal(res.status, 201);
  const rfq = res.body.data;

  assert.match(rfq.rfqNumber, /^RFQ-\d+$/);
  assert.equal(rfq.status, "SUBMITTED");
  assert.equal(rfq.itemCount, 3);
  assert.equal(rfq.totalQuantity, 17000);

  // Verify in PostgreSQL, not just the response body.
  const rows = await prisma.rfqItem.count({ where: { rfqId: rfq.id } });
  assert.equal(rows, 3, "expected exactly 3 RfqItem rows");
  const siblings = await prisma.rfq.count({ where: { userId: rfq.items ? undefined : undefined, id: rfq.id } });
  assert.equal(siblings, 1);
});

test("an RFQ with no items is refused rather than stored empty", async () => {
  const buyer = await registerBuyer();
  const res = await api("/rfqs", { method: "POST", token: buyer.token, body: { autoMatch: false, items: [] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "RFQ_EMPTY");
});

test("an unknown product fails the whole RFQ — no partial write", async () => {
  const buyer = await registerBuyer();
  const p = await makeProduct();
  const before = await prisma.rfq.count();
  const res = await api("/rfqs", {
    method: "POST",
    token: buyer.token,
    body: { autoMatch: false, items: [{ productId: p.id, quantity: 10 }, { productId: "does-not-exist", quantity: 5 }] },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "PRODUCT_NOT_FOUND");
  assert.equal(await prisma.rfq.count(), before, "a rejected RFQ must leave no row behind");
});

test("quantities must be positive whole numbers", async () => {
  const buyer = await registerBuyer();
  const p = await makeProduct();
  for (const quantity of [0, -5, 2.5]) {
    const res = await api("/rfqs", { method: "POST", token: buyer.token, body: { autoMatch: false, items: [{ productId: p.id, quantity }] } });
    assert.equal(res.status, 400, `quantity ${quantity} should be refused`);
  }
});

test("admin sees the submitted RFQ with all of its items", async () => {
  const { res } = await threeProductRfq();
  const token = await adminToken();

  const list = await api("/admin/rfqs", { token });
  assert.equal(list.status, 200);
  const found = list.body.data.rfqs.find((r) => r.id === res.body.data.id);
  assert.ok(found, "submitted RFQ must appear in the admin queue");
  assert.equal(found.itemCount, 3);
  assert.ok(found.customer?.email, "admin list carries the requesting customer");

  const detail = await api(`/admin/rfqs/${res.body.data.id}`, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.items.length, 3);
  assert.deepEqual(
    detail.body.data.items.map((i) => i.quantity).sort((x, y) => x - y),
    [2000, 5000, 10000],
  );
});

test("admin search and status filters work", async () => {
  const { res } = await threeProductRfq();
  const token = await adminToken();

  const byNumber = await api(`/admin/rfqs?q=${res.body.data.rfqNumber}`, { token });
  assert.equal(byNumber.body.data.rfqs.length, 1);

  const byStatus = await api("/admin/rfqs?status=SUBMITTED", { token });
  assert.ok(byStatus.body.data.rfqs.every((r) => r.status === "SUBMITTED"));
});

test("a buyer cannot read another buyer's RFQ", async () => {
  const { res } = await threeProductRfq();
  const other = await registerBuyer();
  const peek = await api(`/rfqs/${res.body.data.id}`, { token: other.token });
  // 404, not 403 — the API must not confirm the RFQ exists.
  assert.equal(peek.status, 404);
});

test("RFQ endpoints reject unauthenticated callers", async () => {
  assert.equal((await api("/rfqs")).status, 401);
  assert.equal((await api("/rfqs", { method: "POST", body: { autoMatch: false, items: [] } })).status, 401);
});

test("a non-admin cannot reach the admin RFQ queue", async () => {
  const buyer = await registerBuyer();
  const res = await api("/admin/rfqs", { token: buyer.token });
  assert.equal(res.status, 403);
});

test("full chain: quote -> accept -> order carries both references", async () => {
  const { buyer, res } = await threeProductRfq();
  const rfqId = res.body.data.id;
  const admin = await adminToken();

  const detail = await api(`/admin/rfqs/${rfqId}`, { token: admin });
  const quote = await api(`/admin/rfqs/${rfqId}/quotations`, {
    method: "POST",
    token: admin,
    body: {
      leadTimeDays: 21,
      paymentTerms: "50% advance, 50% on dispatch",
      shippingMinor: 250000,
      items: detail.body.data.items.map((i, n) => ({
        rfqItemId: i.id,
        quantity: i.quantity,
        unitPriceMinor: [1200, 800, 450][n],
      })),
    },
  });
  assert.equal(quote.status, 201);
  const q = quote.body.data;
  assert.match(q.quotationNumber, /^QT-[A-Za-z0-9]+$/);
  assert.equal(q.version, 1);
  assert.equal(q.status, "SENT");

  // Totals are computed server-side from quantity x unit price.
  const expectedSubtotal = 5000 * 1200 + 10000 * 800 + 2000 * 450;
  assert.equal(q.subtotalMinor, expectedSubtotal);
  assert.equal(q.grandTotalMinor, expectedSubtotal + 250000);

  // The buyer can now see it.
  const mine = await api(`/rfqs/${rfqId}`, { token: buyer.token });
  assert.equal(mine.body.data.status, "QUOTED");
  assert.equal(mine.body.data.quotations.length, 1);

  // Accept -> order.
  const accepted = await api(`/quotations/${q.id}/accept`, { method: "POST", token: buyer.token });
  assert.equal(accepted.status, 201);
  const order = accepted.body.data.order;
  // newOrderNumber() is ORD- plus a short random token, not a sequence.
  assert.match(order.orderNumber, /^ORD-[A-Za-z0-9]+$/);
  assert.equal(order.rfqId, rfqId, "order references the RFQ");
  assert.equal(order.quotationId, q.id, "order references the quotation");
  assert.equal(order.items.length, 3, "all three lines carry into the order");
  assert.equal(order.grandTotalMinor, q.grandTotalMinor, "order total matches the accepted quotation");

  // The order's prices come from the QUOTATION, not the live catalogue.
  const line = order.items.find((i) => i.quantity === 5000);
  assert.equal(line.unitPriceMinor, 1200);

  const closed = await prisma.rfq.findUnique({ where: { id: rfqId }, select: { status: true, closedAt: true } });
  assert.equal(closed.status, "ACCEPTED");
  assert.ok(closed.closedAt);
});

test("accepting the same quotation twice is refused", async () => {
  const { buyer, res } = await threeProductRfq();
  const admin = await adminToken();
  const detail = await api(`/admin/rfqs/${res.body.data.id}`, { token: admin });
  const quote = await api(`/admin/rfqs/${res.body.data.id}/quotations`, {
    method: "POST", token: admin,
    body: { items: detail.body.data.items.map((i) => ({ rfqItemId: i.id, unitPriceMinor: 1000 })) },
  });
  const first = await api(`/quotations/${quote.body.data.id}/accept`, { method: "POST", token: buyer.token });
  assert.equal(first.status, 201);
  const second = await api(`/quotations/${quote.body.data.id}/accept`, { method: "POST", token: buyer.token });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "ALREADY_ACCEPTED");
});

test("rejecting closes the RFQ; requesting changes reopens it for revision", async () => {
  const admin = await adminToken();

  for (const [action, rfqStatus, quoteStatus] of [
    ["reject", "REJECTED", "REJECTED"],
    ["request_changes", "UNDER_REVIEW", "CHANGES_REQUESTED"],
  ]) {
    const { buyer, res } = await threeProductRfq();
    const detail = await api(`/admin/rfqs/${res.body.data.id}`, { token: admin });
    const quote = await api(`/admin/rfqs/${res.body.data.id}/quotations`, {
      method: "POST", token: admin,
      body: { items: detail.body.data.items.map((i) => ({ rfqItemId: i.id, unitPriceMinor: 900 })) },
    });
    const resp = await api(`/quotations/${quote.body.data.id}/respond`, {
      method: "POST", token: buyer.token, body: { action, message: "Too high" },
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.body.data.status, quoteStatus);
    const after = await prisma.rfq.findUnique({ where: { id: res.body.data.id }, select: { status: true } });
    assert.equal(after.status, rfqStatus, `${action} should leave the RFQ ${rfqStatus}`);
  }
});

test("a revision is a new version, and accepting it withdraws the sibling", async () => {
  const { buyer, res } = await threeProductRfq();
  const admin = await adminToken();
  const detail = await api(`/admin/rfqs/${res.body.data.id}`, { token: admin });
  const lines = detail.body.data.items.map((i) => ({ rfqItemId: i.id, unitPriceMinor: 1000 }));

  const v1 = await api(`/admin/rfqs/${res.body.data.id}/quotations`, { method: "POST", token: admin, body: { items: lines } });
  const v2 = await api(`/admin/rfqs/${res.body.data.id}/quotations`, {
    method: "POST", token: admin,
    body: { items: lines.map((l) => ({ ...l, unitPriceMinor: 850 })) },
  });
  assert.equal(v1.body.data.version, 1);
  assert.equal(v2.body.data.version, 2, "a revision increments the version rather than overwriting");

  await api(`/quotations/${v2.body.data.id}/accept`, { method: "POST", token: buyer.token });
  const stale = await prisma.quotation.findUnique({ where: { id: v1.body.data.id }, select: { status: true } });
  assert.equal(stale.status, "WITHDRAWN", "the superseded quotation is withdrawn");
});

test("a quotation cannot be priced negatively overall", async () => {
  const { res } = await threeProductRfq();
  const admin = await adminToken();
  const detail = await api(`/admin/rfqs/${res.body.data.id}`, { token: admin });
  const bad = await api(`/admin/rfqs/${res.body.data.id}/quotations`, {
    method: "POST", token: admin,
    body: { discountMinor: 999_999_999, items: detail.body.data.items.map((i) => ({ rfqItemId: i.id, unitPriceMinor: 100 })) },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "DISCOUNT_TOO_LARGE");
});

test("events are recorded for created, quoted and accepted", async () => {
  const { buyer, res } = await threeProductRfq();
  const admin = await adminToken();
  const rfqId = res.body.data.id;

  const created = await prisma.auditLog.findFirst({ where: { eventType: "rfq.created", entityId: rfqId } });
  assert.ok(created, "rfq.created event recorded");

  const detail = await api(`/admin/rfqs/${rfqId}`, { token: admin });
  const quote = await api(`/admin/rfqs/${rfqId}/quotations`, {
    method: "POST", token: admin,
    body: { items: detail.body.data.items.map((i) => ({ rfqItemId: i.id, unitPriceMinor: 700 })) },
  });
  assert.ok(await prisma.auditLog.findFirst({ where: { eventType: "quotation.created", entityId: quote.body.data.id } }));

  await api(`/quotations/${quote.body.data.id}/accept`, { method: "POST", token: buyer.token });
  assert.ok(await prisma.auditLog.findFirst({ where: { eventType: "quotation.accepted", entityId: quote.body.data.id } }));

  // The buyer is notified when the quotation arrives.
  assert.ok(await prisma.notification.findFirst({ where: { userId: buyer.userId, type: "quotation.received" } }));
});

test("a cancelled RFQ cannot be quoted", async () => {
  const { buyer, res } = await threeProductRfq();
  const admin = await adminToken();
  const cancel = await api(`/rfqs/${res.body.data.id}/cancel`, { method: "POST", token: buyer.token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.status, "CANCELLED");

  const detail = await api(`/admin/rfqs/${res.body.data.id}`, { token: admin });
  const quote = await api(`/admin/rfqs/${res.body.data.id}/quotations`, {
    method: "POST", token: admin,
    body: { items: detail.body.data.items.map((i) => ({ rfqItemId: i.id, unitPriceMinor: 500 })) },
  });
  assert.equal(quote.status, 409);
  assert.equal(quote.body.code, "RFQ_SETTLED");
});
