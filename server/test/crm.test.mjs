// Admin CRM: create customer → raise an order with multiple items → record an
// advance → record further payments → pending/status derive themselves.
// Mirrors the acceptance flows in docs/CRM-AUDIT.md (brief TEST 1–6).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8);
const MADE_USERS = [];
const MADE_ORDERS = [];
let ADMIN;

before(async () => { await startServer(); ADMIN = await adminToken(); });
after(async () => {
  // Children first — payments/refunds/items reference the orders.
  if (MADE_ORDERS.length) {
    const ids = MADE_ORDERS;
    const payments = await prisma.payment.findMany({ where: { orderId: { in: ids } }, select: { id: true } });
    await prisma.refund.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  }
  if (MADE_USERS.length) {
    await prisma.address.deleteMany({ where: { userId: { in: MADE_USERS } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: MADE_USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: MADE_USERS } } });
  }
  await stopServer();
});

const admin = (path, opt = {}) => api(path, { token: ADMIN, ...opt });

async function makeCustomer(over = {}) {
  const tag = rnd();
  const res = await admin("/admin/crm/customers", {
    method: "POST",
    body: {
      name: `Test Buyer ${tag}`,
      email: `crm-${tag}@zolo-test.local`,
      phone: `9${String(Date.now()).slice(-9)}`,
      company: `Test Co ${tag}`,
      gstin: "27AAPFU0939F1ZV",
      customerType: "business",
      address: { line1: "12 Industrial Estate", city: "Pune", state: "Maharashtra", postalCode: "411001" },
      ...over,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  MADE_USERS.push(res.body.data.customer.id);
  return res.body.data.customer;
}

async function makeOrder(customerId, body = {}) {
  const res = await admin("/admin/crm/orders", {
    method: "POST",
    body: {
      customerId,
      items: [
        { itemName: "5 Ply Corrugated Box", quantity: 100, unitPriceMinor: 3000 },
        { itemName: "Kraft Paper Bag", quantity: 200, unitPriceMinor: 1000 },
      ],
      ...body,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  MADE_ORDERS.push(res.body.data.order.id);
  return res.body.data.order;
}

// ---------------------------------------------------------------------------

test("TEST 1 — admin creates a customer; it appears in the list with derived totals", async () => {
  const c = await makeCustomer();
  assert.equal(c.role, "buyer");
  assert.ok(c.company);

  const list = await admin(`/admin/crm/customers?q=${encodeURIComponent(c.email)}`);
  assert.equal(list.status, 200);
  const found = list.body.data.customers.find((x) => x.id === c.id);
  assert.ok(found, "new customer is in the list");
  assert.equal(found.orderCount, 0);
  assert.equal(found.pendingMinor, 0);
  assert.equal(found.financialStatus, "CLEAR", "no orders ⇒ CLEAR");
  // Server-side pagination envelope.
  for (const k of ["total", "page", "limit", "pages"]) assert.ok(k in list.body.data, `envelope has ${k}`);
});

test("customer validation: duplicate email/phone refused, bad input refused", async () => {
  const c = await makeCustomer();
  const dupEmail = await admin("/admin/crm/customers", {
    method: "POST",
    body: { name: "Dup", email: c.email, phone: `9${String(Date.now() + 5).slice(-9)}` },
  });
  assert.equal(dupEmail.status, 409);
  assert.equal(dupEmail.body.code, "EMAIL_TAKEN");

  const badPhone = await admin("/admin/crm/customers", {
    method: "POST",
    body: { name: "Bad", email: `x-${rnd()}@zolo-test.local`, phone: "123" },
  });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.body.code, "PHONE_INVALID");

  const noName = await admin("/admin/crm/customers", {
    method: "POST",
    body: { name: "  ", email: `y-${rnd()}@zolo-test.local`, phone: "9876500011" },
  });
  assert.equal(noName.status, 400);
});

test("a customer can be created with NO email; the placeholder is never mailable", async () => {
  const { hasEmail } = await import("../src/services/crm.mjs");
  const phone = `9${String(Date.now() + 77).slice(-9)}`;

  // Most walk-in trade customers have only a phone number. Refusing the record
  // until someone invents an address is what pushed three separate screens
  // into each synthesising their own fake one.
  const res = await admin("/admin/crm/customers", {
    method: "POST",
    body: { name: "Walk In", phone },
  });
  assert.equal(res.status, 201, "a customer with no email is accepted");
  const created = res.body.data.customer ?? res.body.data;
  MADE_USERS.push(created.id);

  // A row still needs a unique address, but it must be undeliverable by
  // construction: .invalid is reserved by RFC 2606 and can never resolve.
  assert.ok(created.email.endsWith(".invalid"), `placeholder is .invalid, got ${created.email}`);
  assert.ok(created.email.includes(phone), "placeholder is derived from the phone number");
  assert.equal(hasEmail(created.email), false, "placeholder is not treated as contactable");

  // The single chokepoint every mail path goes through must refuse it, so a
  // walk-in customer can never become a permanent bounce.
  const { sendMail } = await import("../src/services/email.mjs");
  const sent = await sendMail({ to: created.email, subject: "x", text: "x", messageType: "test" });
  assert.equal(sent.status, "SKIPPED", "mail to a placeholder is skipped, not attempted");

  // A second walk-in on the same number is still a duplicate, and the error
  // must name the phone rather than an email the admin never typed.
  const dup = await admin("/admin/crm/customers", { method: "POST", body: { name: "Walk In Again", phone } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "PHONE_TAKEN");
});

test("a real email is stored as given and stays contactable", async () => {
  const { hasEmail } = await import("../src/services/crm.mjs");
  const email = `real-${rnd()}@zolo-test.local`;
  const res = await admin("/admin/crm/customers", {
    method: "POST",
    body: { name: "Has Email", phone: `9${String(Date.now() + 88).slice(-9)}`, email },
  });
  assert.equal(res.status, 201);
  const created = res.body.data.customer ?? res.body.data;
  MADE_USERS.push(created.id);
  assert.equal(created.email, email);
  assert.equal(hasEmail(created.email), true);

  // A malformed address is still rejected — optional does not mean unvalidated.
  const bad = await admin("/admin/crm/customers", {
    method: "POST",
    body: { name: "Bad Email", phone: `9${String(Date.now() + 99).slice(-9)}`, email: "not-an-email" },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "EMAIL_INVALID");
});

test("an account manager can be assigned, cleared, and cannot be a non-rep", async () => {
  const c = await makeCustomer();

  // capturedById was written by the field-capture flow and then never read,
  // so the business could not see who owned an account or hand one over.
  const rep = await prisma.user.findFirst({ where: { role: "salesperson" } });
  assert.ok(rep, "a salesperson exists to assign");

  const assigned = await admin(`/admin/crm/customers/${c.id}`, {
    method: "PATCH",
    body: { salespersonId: rep.id },
  });
  assert.equal(assigned.status, 200);

  const list = await admin(`/admin/crm/customers?q=${encodeURIComponent(c.email)}`);
  const row = list.body.data.customers.find((x) => x.id === c.id);
  assert.equal(row.salesperson?.id, rep.id, "the list shows who owns the account");

  // Assigning a buyer would silently corrupt every report grouped by this
  // column, so the role is checked server-side rather than trusted.
  const bad = await admin(`/admin/crm/customers/${c.id}`, {
    method: "PATCH",
    body: { salespersonId: c.id },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "NOT_A_SALESPERSON");

  // "" clears it: an account can be unassigned, not just reassigned.
  const cleared = await admin(`/admin/crm/customers/${c.id}`, {
    method: "PATCH",
    body: { salespersonId: "" },
  });
  assert.equal(cleared.status, 200);
  const after = await admin(`/admin/crm/customers?q=${encodeURIComponent(c.email)}`);
  assert.equal(after.body.data.customers.find((x) => x.id === c.id).salesperson, null);
});

test("two simultaneous full payments cannot overpay an order", async () => {
  const c = await makeCustomer();
  const o = await makeOrder(c.id);
  const full = o.grandTotalMinor;

  // Reproduces an admin double-clicking "Mark full payment". Before the row
  // lock in addPaymentInTx, both requests read the same outstanding balance,
  // both passed the overpayment check and both inserted: a 1,000 order
  // recorded 2,000 paid and still reported PAID.
  const [a, b] = await Promise.allSettled([
    admin(`/admin/crm/orders/${o.id}/payments`, { method: "POST", body: { amountMinor: full, method: "cash" } }),
    admin(`/admin/crm/orders/${o.id}/payments`, { method: "POST", body: { amountMinor: full, method: "cash" } }),
  ]);

  const statuses = [a, b].map((r) => (r.status === "fulfilled" ? r.value.status : 500));
  assert.ok(statuses.includes(201), "one payment is accepted");
  assert.ok(
    statuses.some((st) => st >= 400),
    `the second must be refused, got ${statuses.join(" and ")}`,
  );

  const after = await prisma.order.findUnique({
    where: { id: o.id },
    include: { payments: true },
  });
  assert.equal(after.payments.length, 1, "exactly one payment row exists");
  assert.equal(after.paidMinor, full, "paid equals the order total, never more");
  assert.ok(after.paidMinor <= after.grandTotalMinor, "the order is never overpaid");
});

test("a refund restates paidMinor, not just the status", async () => {
  const c = await makeCustomer();
  const o = await makeOrder(c.id);

  const pay = await admin(`/admin/crm/orders/${o.id}/payments`, {
    method: "POST",
    body: { amountMinor: o.grandTotalMinor, method: "cash" },
  });
  assert.equal(pay.status, 201);
  const paymentId = pay.body.data.payment.id;

  const half = Math.floor(o.grandTotalMinor / 2);
  const ref = await admin(`/admin/crm/payments/${paymentId}/refund`, {
    method: "POST",
    body: { amountMinor: half, reason: "test" },
  });
  assert.equal(ref.status, 200, JSON.stringify(ref.body));

  // The bug this guards: two refund paths wrote paymentStatus and left
  // paidMinor claiming the money was still held, so every report built on
  // paidMinor counted refunded cash as collected. 20 live orders had drifted.
  const after = await prisma.order.findUnique({ where: { id: o.id } });
  assert.equal(
    after.paidMinor,
    o.grandTotalMinor - half,
    "paidMinor drops by the refunded amount",
  );
  assert.equal(after.paymentStatus, "PARTIALLY_REFUNDED");
});

test("Mark full payment settles exactly the balance and cannot be repeated", async () => {
  const c = await makeCustomer();
  const o = await makeOrder(c.id);
  await admin(`/admin/crm/orders/${o.id}/payments`, {
    method: "POST",
    body: { amountMinor: 30000, method: "upi" },
  });

  // The client sends NO amount: a balance read seconds ago may be stale, so
  // the server recomputes it under a row lock.
  const res = await admin(`/admin/crm/orders/${o.id}/payments/full`, { method: "POST", body: { method: "cash" } });
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
  assert.equal(res.body.data.settledMinor, o.grandTotalMinor - 30000, "settles exactly what was left");
  assert.equal(res.body.data.totals.paidMinor, o.grandTotalMinor);
  assert.equal(res.body.data.totals.paymentStatus, "PAID");

  // A second click must not write a zero-value row or overpay.
  const again = await admin(`/admin/crm/orders/${o.id}/payments/full`, { method: "POST", body: {} });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "ALREADY_SETTLED");

  const after = await prisma.order.findUnique({ where: { id: o.id }, include: { payments: true } });
  assert.equal(after.payments.length, 2, "no extra payment row was written");
  assert.equal(after.paidMinor, o.grandTotalMinor, "never overpaid");
});

test("a write-off needs a reason and is recorded as an adjustment, not a status flip", async () => {
  const c = await makeCustomer();
  const o = await makeOrder(c.id);

  const noReason = await admin(`/admin/crm/orders/${o.id}/payments/write-off`, { method: "POST", body: {} });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, "REASON_REQUIRED");

  const res = await admin(`/admin/crm/orders/${o.id}/payments/write-off`, {
    method: "POST",
    body: { reason: "customer ceased trading" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
  assert.equal(res.body.data.writtenOffMinor, o.grandTotalMinor);

  // The order reads settled, but the ledger still explains that no money came
  // in — which is the whole difference between this and flipping a status.
  const after = await prisma.order.findUnique({ where: { id: o.id }, include: { payments: true } });
  assert.equal(after.paymentStatus, "PAID");
  const adj = after.payments.find((p) => p.kind === "ADJUSTMENT");
  assert.ok(adj, "an ADJUSTMENT payment records the write-off");
  assert.match(adj.notes, /ceased trading/, "the reason is kept on the ledger");

  const event = await prisma.auditLog.findFirst({
    where: { eventType: "payment.written_off", entityId: o.id },
  });
  assert.ok(event, "the write-off is audited");
  assert.equal(event.metadata.amountMinor, o.grandTotalMinor);
});

test("TEST 2 — order with 3 items + advance ⇒ totals computed, status PARTIAL", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [
      { itemName: "5 Ply Box", quantity: 100, unitPriceMinor: 30000 },   // 30,00,000
      { itemName: "Kraft Bag", quantity: 100, unitPriceMinor: 10000 },   // 10,00,000
      { itemName: "Printed Tape", quantity: 100, unitPriceMinor: 10000 },// 10,00,000
    ],
    advanceMinor: 2_000_000,
    advanceMethod: "bank_transfer",
  });

  assert.equal(order.items.length, 3);
  assert.equal(order.subtotalMinor, 5_000_000);
  assert.equal(order.grandTotalMinor, 5_000_000);
  assert.equal(order.paidMinor, 2_000_000, "advance counted");
  assert.equal(order.paymentStatus, "PARTIAL");
  assert.equal(order.source, "admin");
  assert.equal(order.payments.length, 1);
  assert.equal(order.payments[0].kind, "ADVANCE");
  // Custom items carry no productId but keep their snapshot name.
  assert.ok(order.items.every((i) => i.isCustomItem && i.productId === null));
});

test("TEST 3+4 — further payments accumulate; final payment ⇒ PAID, pending 0", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 10, unitPriceMinor: 10_000 }], // 1,00,000
    advanceMinor: 20_000,
  });
  assert.equal(order.grandTotalMinor, 100_000);
  assert.equal(order.paidMinor, 20_000);

  const second = await admin(`/admin/crm/orders/${order.id}/payments`, {
    method: "POST",
    body: { amountMinor: 30_000, method: "upi", reference: `UPI-${rnd()}`, kind: "PARTIAL" },
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.data.totals.paidMinor, 50_000);
  assert.equal(second.body.data.totals.pendingMinor, 50_000);
  assert.equal(second.body.data.totals.paymentStatus, "PARTIAL");

  const final = await admin(`/admin/crm/orders/${order.id}/payments`, {
    method: "POST",
    body: { amountMinor: 50_000, method: "cash", kind: "FINAL" },
  });
  assert.equal(final.status, 201);
  assert.equal(final.body.data.totals.paidMinor, 100_000);
  assert.equal(final.body.data.totals.pendingMinor, 0);
  assert.equal(final.body.data.totals.paymentStatus, "PAID");

  // Full ledger retained — three separate transactions, not one mutated total.
  assert.equal(final.body.data.order.payments.length, 3);
  const row = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(row.paidMinor, 100_000, "stored figure matches the ledger");
  assert.equal(row.paymentStatus, "PAID");
});

test("TEST 5 — order with no payment is UNPAID with the full amount pending", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, { items: [{ itemName: "Box", quantity: 5, unitPriceMinor: 2_000 }] });
  assert.equal(order.paidMinor, 0);
  assert.equal(order.paymentStatus, "PENDING");

  const out = await admin("/admin/crm/outstanding?bucket=all");
  const mine = out.body.data.orders.find((o) => o.id === order.id);
  assert.ok(mine, "appears in outstanding");
  assert.equal(mine.pendingMinor, 10_000);
  assert.equal(mine.paymentStatus, "UNPAID", "display label, derived");
});

test("TEST 6 — past due date + balance ⇒ OVERDUE, derived not stored", async () => {
  const c = await makeCustomer();
  const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 10, unitPriceMinor: 1_000 }],
    dueDate: past,
  });
  // The stored enum stays PENDING; OVERDUE is a read-time derivation.
  assert.equal(order.paymentStatus, "PENDING");

  const out = await admin("/admin/crm/outstanding?bucket=overdue");
  const mine = out.body.data.orders.find((o) => o.id === order.id);
  assert.ok(mine, "appears in the overdue bucket");
  assert.equal(mine.paymentStatus, "OVERDUE");
  assert.ok(mine.daysOverdue >= 4, `daysOverdue ${mine.daysOverdue}`);

  // And the customer's derived financial status follows.
  const list = await admin(`/admin/crm/customers?q=${encodeURIComponent(c.email)}`);
  const found = list.body.data.customers.find((x) => x.id === c.id);
  assert.equal(found.financialStatus, "OVERDUE");
  assert.ok(found.overdueMinor > 0);
});

test("payment validation: zero, negative, overpayment and duplicate reference refused", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, { items: [{ itemName: "Box", quantity: 1, unitPriceMinor: 10_000 }] });
  const post = (body) => admin(`/admin/crm/orders/${order.id}/payments`, { method: "POST", body });

  assert.equal((await post({ amountMinor: 0, method: "cash" })).status, 400);
  assert.equal((await post({ amountMinor: -500, method: "cash" })).status, 400);

  const over = await post({ amountMinor: 999_999, method: "cash" });
  assert.equal(over.status, 400);
  assert.equal(over.body.code, "OVERPAYMENT");

  const badMethod = await post({ amountMinor: 100, method: "bitcoin" });
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.body.code, "METHOD_INVALID");

  const ref = `REF-${rnd()}`;
  assert.equal((await post({ amountMinor: 1_000, method: "upi", reference: ref })).status, 201);
  const dup = await post({ amountMinor: 1_000, method: "upi", reference: ref });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "REFERENCE_DUPLICATE");

  // Overpayment is allowed when explicitly permitted.
  const allowed = await post({ amountMinor: 50_000, method: "cash", allowOverpayment: true });
  assert.equal(allowed.status, 201);
});

test("refund appends history and restates the order; the original payment survives", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 10, unitPriceMinor: 5_000 }],
    advanceMinor: 50_000,
  });
  assert.equal(order.paymentStatus, "PAID");
  const paymentId = order.payments[0].id;

  const refund = await admin(`/admin/crm/payments/${paymentId}/refund`, {
    method: "POST",
    body: { amountMinor: 10_000, reason: "Short shipment" },
  });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));

  // Original payment row still exists and still records the full amount.
  const original = await prisma.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
  assert.ok(original, "original payment NOT deleted");
  assert.equal(original.amountMinor, 50_000, "original amount unchanged");
  assert.equal(original.refunds.length, 1);
  assert.equal(original.refunds[0].amountMinor, 10_000);

  const tooMuch = await admin(`/admin/crm/payments/${paymentId}/refund`, {
    method: "POST",
    body: { amountMinor: 999_999 },
  });
  assert.equal(tooMuch.status, 400);
  assert.equal(tooMuch.body.code, "REFUND_TOO_LARGE");
});

test("PARTIAL refund reduces paid and flips the order to PARTIALLY_REFUNDED", async () => {
  // Regression: refunds were read from Payment.status, which only flips to
  // REFUNDED on a FULL refund — so a partial refund left the order showing
  // the full amount as still paid. Refunds must come from the Refund ledger.
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 10, unitPriceMinor: 5_000 }], // 50,000
    advanceMinor: 50_000,
  });
  assert.equal(order.paymentStatus, "PAID");

  const res = await admin(`/admin/crm/payments/${order.payments[0].id}/refund`, {
    method: "POST",
    body: { amountMinor: 5_000, reason: "Short shipment" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.totals.paidMinor, 45_000, "paid drops by the refund");
  assert.equal(res.body.data.totals.pendingMinor, 5_000);
  assert.equal(res.body.data.totals.paymentStatus, "PARTIALLY_REFUNDED");

  const row = await prisma.order.findUnique({ where: { id: order.id } });
  assert.equal(row.paidMinor, 45_000, "stored figure matches");

  // Refunding the remainder empties the order.
  const rest = await admin(`/admin/crm/payments/${order.payments[0].id}/refund`, {
    method: "POST",
    body: { amountMinor: 45_000 },
  });
  assert.equal(rest.status, 200);
  assert.equal(rest.body.data.totals.paidMinor, 0);
  assert.equal(rest.body.data.totals.paymentStatus, "REFUNDED");
});

test("order rejects empty items and bad quantities", async () => {
  const c = await makeCustomer();
  const noItems = await admin("/admin/crm/orders", { method: "POST", body: { customerId: c.id, items: [] } });
  assert.equal(noItems.status, 400);
  assert.equal(noItems.body.code, "ITEMS_REQUIRED");

  const badQty = await admin("/admin/crm/orders", {
    method: "POST",
    body: { customerId: c.id, items: [{ itemName: "Box", quantity: 0, unitPriceMinor: 100 }] },
  });
  assert.equal(badQty.status, 400);

  const noName = await admin("/admin/crm/orders", {
    method: "POST",
    body: { customerId: c.id, items: [{ quantity: 1, unitPriceMinor: 100 }] },
  });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, "ITEM_NAME_REQUIRED");
});

test("TEST 10 — dashboard totals agree with the database", async () => {
  const summary = (await admin("/admin/crm/payments/summary")).body.data;
  const live = await prisma.order.aggregate({
    where: { status: { not: "CANCELLED" } },
    _sum: { grandTotalMinor: true, paidMinor: true },
  });
  assert.equal(summary.totalValueMinor, live._sum.grandTotalMinor ?? 0);
  assert.equal(summary.receivedMinor, live._sum.paidMinor ?? 0);
  assert.equal(summary.pendingMinor, Math.max(0, (live._sum.grandTotalMinor ?? 0) - (live._sum.paidMinor ?? 0)));
});

test("audit trail records who created the customer, the order and each payment", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 1, unitPriceMinor: 5_000 }],
    advanceMinor: 1_000,
  });

  const events = await prisma.auditLog.findMany({
    where: { OR: [{ entityId: c.id }, { entityId: order.id }, { entityId: order.payments[0].id }] },
    select: { eventType: true, actorId: true },
  });
  const types = events.map((e) => e.eventType);
  assert.ok(types.includes("customer.created"), types.join(","));
  assert.ok(types.includes("order.created"), types.join(","));
  assert.ok(types.includes("payment.recorded"), types.join(","));
  assert.ok(events.every((e) => e.actorId), "every event names an actor");
});

test("payments list is server-side paginated and searchable by order number", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 1, unitPriceMinor: 9_000 }],
    advanceMinor: 9_000,
  });

  const res = await admin(`/admin/crm/payments?q=${order.orderNumber}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.payments.length >= 1);
  const row = res.body.data.payments.find((p) => p.orderNumber === order.orderNumber);
  assert.ok(row, "found by order number");
  assert.equal(row.customerId, c.id);
  assert.ok(row.customerName, "customer name resolved (not a placeholder)");
  assert.ok(row.receivedBy, "records who took the payment");

  const paged = await admin("/admin/crm/payments?limit=1&page=1");
  assert.equal(paged.body.data.payments.length, 1);
  assert.equal(paged.body.data.limit, 1);
});

test("notification uses a real template and reports delivery truthfully", async () => {
  const c = await makeCustomer();
  const order = await makeOrder(c.id, {
    items: [{ itemName: "Box", quantity: 10, unitPriceMinor: 5_000 }],
    advanceMinor: 10_000,
    dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });

  const res = await admin(`/admin/crm/orders/${order.id}/notify`, {
    method: "POST",
    body: { template: "PAYMENT_DUE" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const result = res.body.data.result;
  // Every channel must report a real outcome — never a fabricated "sent".
  for (const ch of ["email", "whatsapp"]) {
    if (result[ch]) assert.ok(["SENT", "FAILED", "SKIPPED"].includes(result[ch].status), `${ch}: ${JSON.stringify(result[ch])}`);
  }

  const history = await admin(`/admin/crm/customers/${c.id}/notifications`);
  assert.equal(history.status, 200);
  assert.ok(history.body.data.notifications.length >= 1, "delivery logged");

  const unknown = await admin(`/admin/crm/orders/${order.id}/notify`, { method: "POST", body: { template: "NOPE" } });
  assert.equal(unknown.status, 404);
});

test("CRM endpoints reject non-admin callers", async () => {
  const res = await api("/admin/crm/customers");
  assert.ok([401, 403].includes(res.status), `got ${res.status}`);
});
