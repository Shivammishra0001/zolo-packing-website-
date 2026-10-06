// Field sales: order capture, attribution, scoping and the permission
// boundaries a salesperson must never cross.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerBuyer, adminToken, makeProduct } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { resetRateLimits } from "../src/middleware/rate-limit.mjs";

before(startServer);
beforeEach(resetRateLimits);
after(stopServer);

const rnd = () => Math.random().toString(36).slice(2, 8);

/** Admin creates a rep (they can never self-register) and we sign in as them. */
async function makeRep(admin) {
  const email = `rep_${rnd()}@zolo.com`;
  const password = "RepPassw0rd!1";
  const created = await api("/admin/sales/salespeople", {
    method: "POST", token: admin,
    body: { name: "Rahul Field", email, password, employeeId: `EMP-${rnd().toUpperCase()}`, territory: "Delhi" },
  });
  assert.equal(created.status, 201, `rep created: ${JSON.stringify(created.body).slice(0, 160)}`);
  const login = await api("/auth/login", { method: "POST", body: { email, password } });
  return { token: login.body.data.accessToken, userId: login.body.data.user.id, profile: created.body.data, email };
}

async function makeCustomer(repToken) {
  const res = await api("/sales/customers", {
    method: "POST", token: repToken,
    body: { name: `Acme ${rnd()}`, email: `cust_${rnd()}@example.com`, phone: `98${Math.floor(10000000 + Math.random() * 89999999)}`, company: "Acme Packaging" },
  });
  assert.equal(res.status, 201, `customer created: ${JSON.stringify(res.body).slice(0, 160)}`);
  return res.body.data.id ?? res.body.data.customer?.id;
}

test("only an admin can create a salesperson — a rep cannot self-register", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);

  const attempt = await api("/admin/sales/salespeople", {
    method: "POST", token: rep.token,
    body: { name: "Sneaky", email: `x_${rnd()}@zolo.com`, password: "Passw0rd!1", employeeId: `EMP-${rnd()}` },
  });
  assert.equal(attempt.status, 403, "a rep must not reach admin salesperson management");

  const buyer = await registerBuyer();
  assert.equal((await api("/admin/sales/salespeople", { token: buyer.token })).status, 403);
});

test("a weak password or duplicate employee ID is refused", async () => {
  const admin = await adminToken();
  const weak = await api("/admin/sales/salespeople", {
    method: "POST", token: admin,
    body: { name: "X", email: `w_${rnd()}@zolo.com`, password: "short", employeeId: `EMP-${rnd()}` },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, "PASSWORD_WEAK");

  const rep = await makeRep(admin);
  const dupe = await api("/admin/sales/salespeople", {
    method: "POST", token: admin,
    body: { name: "Y", email: `d_${rnd()}@zolo.com`, password: "RepPassw0rd!1", employeeId: rep.profile.employeeId },
  });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.code, "EMPLOYEE_ID_TAKEN");
});

test("a captured order is an ordinary Order stamped with the rep", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);
  const customerId = await makeCustomer(rep.token);
  const product = await makeProduct({ priceMinor: 1250, stock: 100000, name: "Corrugated Box" });

  const res = await api("/sales/orders", {
    method: "POST", token: rep.token,
    body: { customerId, items: [{ productId: product.id, quantity: 5000, unitPriceMinor: 1250 }] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));

  const order = await prisma.order.findUnique({ where: { id: res.body.data.id } });
  assert.equal(order.salespersonId, rep.userId, "attribution is recorded");
  assert.equal(order.userId, customerId, "the order still belongs to the CUSTOMER");
  assert.equal(order.grandTotalMinor, 1250 * 5000, "totals computed server-side");

  // It must be visible to the existing admin order screens, not a parallel store.
  const adminView = await api("/admin/orders", { token: admin });
  assert.ok(adminView.body.data.orders.some((o) => o.id === order.id), "admin sees salesperson orders");
});

test("a custom (non-catalog) item can be captured — packaging is bespoke", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);
  const customerId = await makeCustomer(rep.token);

  const res = await api("/sales/orders", {
    method: "POST", token: rep.token,
    body: {
      customerId,
      items: [{ itemName: "Custom Printed Mailer", quantity: 2000, unitPriceMinor: 1800,
                specs: { length: 12, width: 8, height: 4, unit: "inch", gsm: "not_known", material: "Kraft" } }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 200));
  const items = await prisma.orderItem.findMany({ where: { orderId: res.body.data.id } });
  assert.equal(items.length, 1);
  assert.equal(items[0].productId, null, "a custom line has no catalog product");
  assert.equal(items[0].specs.gsm, "not_known", "an unknown spec must not block capture");
});

test("a rep sees only their own orders", async () => {
  const admin = await adminToken();
  const [a, b] = [await makeRep(admin), await makeRep(admin)];
  const customerId = await makeCustomer(a.token);
  const product = await makeProduct({ priceMinor: 500, stock: 10000 });

  const mine = await api("/sales/orders", {
    method: "POST", token: a.token,
    body: { customerId, items: [{ productId: product.id, quantity: 10, unitPriceMinor: 500 }] },
  });
  assert.equal(mine.status, 201);

  const bList = await api("/sales/orders", { token: b.token });
  assert.ok(!bList.body.data.orders.some((o) => o.id === mine.body.data.id), "a rival rep's order is invisible");

  const peek = await api(`/sales/orders/${mine.body.data.id}`, { token: b.token });
  assert.equal(peek.status, 404, "404, not 403 — do not confirm it exists");
});

test("customers are SHARED across reps, with attribution", async () => {
  const admin = await adminToken();
  const [a, b] = [await makeRep(admin), await makeRep(admin)];
  const customerId = await makeCustomer(a.token);

  const captured = await prisma.user.findUnique({ where: { id: customerId }, select: { capturedById: true } });
  assert.equal(captured.capturedById, a.userId, "the creating rep is recorded");

  // Rep B can find and order for the same customer — no duplicate record.
  const found = await api(`/sales/customers/search?q=${encodeURIComponent("Acme")}`, { token: b.token });
  assert.equal(found.status, 200);
  assert.ok(found.body.data.customers.some((c) => c.id === customerId), "shared search finds it");
});

test("the customer snapshot carries history a rep can reorder from", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);
  const customerId = await makeCustomer(rep.token);
  const product = await makeProduct({ priceMinor: 1250, stock: 100000, name: "Kraft Mailer" });
  await api("/sales/orders", {
    method: "POST", token: rep.token,
    body: { customerId, items: [{ productId: product.id, quantity: 5000, unitPriceMinor: 1250 }] },
  });

  const snap = await api(`/sales/customers/${customerId}/snapshot`, { token: rep.token });
  assert.equal(snap.status, 200);
  const d = snap.body.data;
  assert.equal(d.orderCount, 1);
  assert.equal(d.lastOrderMinor, 1250 * 5000);
  assert.equal(d.totalBusinessMinor, 1250 * 5000);
  assert.ok(d.outstandingMinor > 0, "unpaid order shows as outstanding");
  assert.ok(d.recentItems.some((i) => i.productName.startsWith("Kraft Mailer") && i.quantity === 5000),
    "previous line items are returned so a repeat order needs no retyping");
});

test("samples attach to the rep's own order and are refused elsewhere", async () => {
  const admin = await adminToken();
  const [a, b] = [await makeRep(admin), await makeRep(admin)];
  const customerId = await makeCustomer(a.token);
  const product = await makeProduct({ priceMinor: 900, stock: 5000 });
  const order = await api("/sales/orders", {
    method: "POST", token: a.token, body: { customerId, items: [{ productId: product.id, quantity: 10, unitPriceMinor: 500 }] },
  });

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
  const added = await api(`/sales/orders/${order.body.data.id}/samples`, {
    method: "POST", token: a.token,
    body: { fileName: "box.png", mime: "image/png", dataBase64: png, caption: "customer reference" },
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.data.fileName, "box.png");

  // Another rep cannot attach to it.
  const foreign = await api(`/sales/orders/${order.body.data.id}/samples`, {
    method: "POST", token: b.token, body: { fileName: "x.png", mime: "image/png", dataBase64: png },
  });
  assert.equal(foreign.status, 404);
});

test("an unsupported or oversized sample is refused", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);
  const customerId = await makeCustomer(rep.token);
  const product = await makeProduct({ priceMinor: 900, stock: 5000 });
  const order = await api("/sales/orders", {
    method: "POST", token: rep.token, body: { customerId, items: [{ productId: product.id, quantity: 5, unitPriceMinor: 900 }] },
  });

  const bad = await api(`/sales/orders/${order.body.data.id}/samples`, {
    method: "POST", token: rep.token,
    body: { fileName: "virus.exe", mime: "application/x-msdownload", dataBase64: Buffer.from("MZ").toString("base64") },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "UNSUPPORTED_TYPE");

  const empty = await api(`/sales/orders/${order.body.data.id}/samples`, {
    method: "POST", token: rep.token, body: { fileName: "e.png", mime: "image/png", dataBase64: "" },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, "EMPTY_FILE");
});

test("KPIs are derived from orders, never stored", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);
  const customerId = await makeCustomer(rep.token);
  const product = await makeProduct({ priceMinor: 1000, stock: 100000 });
  await api("/sales/orders", {
    method: "POST", token: rep.token, body: { customerId, items: [{ productId: product.id, quantity: 100, unitPriceMinor: 1000 }] },
  });

  const kpi = await api("/sales/kpis", { token: rep.token });
  assert.equal(kpi.status, 200);
  assert.equal(kpi.body.data.orders, 1);
  assert.equal(kpi.body.data.salesMinor, 100 * 1000);
  assert.equal(kpi.body.data.averageOrderMinor, 100 * 1000);
  assert.equal(kpi.body.data.outstandingMinor, 100 * 1000, "nothing paid yet");
  assert.equal(kpi.body.data.collectionRateBps, 0);
  assert.equal(kpi.body.data.newCustomers, 1, "first-ever order makes this a new customer");
});

test("admin performance ranks reps and a rep cannot read it", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);

  const perf = await api("/admin/sales/performance", { token: admin });
  assert.equal(perf.status, 200);
  assert.ok(Array.isArray(perf.body.data.rows));
  assert.ok(perf.body.data.rows.some((r) => r.employeeId === rep.profile.employeeId));

  assert.equal((await api("/admin/sales/performance", { token: rep.token })).status, 403);
});

test("suspending a rep blocks the login as well as the portal", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);

  const suspended = await api(`/admin/sales/salespeople/${rep.profile.id}/status`, {
    method: "PATCH", token: admin, body: { status: "SUSPENDED" },
  });
  assert.equal(suspended.status, 200);

  const user = await prisma.user.findUnique({ where: { id: rep.userId }, select: { isActive: true } });
  assert.equal(user.isActive, false, "a suspended rep must not be able to sign in");

  const blocked = await api("/sales/me", { token: rep.token });
  assert.ok(blocked.status === 401 || blocked.status === 403, `expected a refusal, got ${blocked.status}`);
});

test("a salesperson cannot reach admin-only systems", async () => {
  const admin = await adminToken();
  const rep = await makeRep(admin);
  // The "Cannot" list: product masters, settings, payment verification.
  for (const path of ["/admin/dashboard", "/admin/crm/payments", "/admin/settings", "/admin/products"]) {
    const res = await api(path, { token: rep.token });
    assert.ok(res.status === 403 || res.status === 404, `${path} must not be readable by a rep (got ${res.status})`);
  }
});

test("a buyer cannot use the sales portal", async () => {
  const buyer = await registerBuyer();
  assert.equal((await api("/sales/orders", { token: buyer.token })).status, 403);
  assert.equal((await api("/sales/me", { token: buyer.token })).status, 403);
});
