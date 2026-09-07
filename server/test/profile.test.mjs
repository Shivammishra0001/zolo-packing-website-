// Self-service profile + password + address-book integrity.
//
// The customer-side "save" used to be a toast with no API call, so nothing
// ever reached the database and the admin dashboard (which reads the DB) could
// never see an update. These tests pin the REAL chain:
//   customer PATCH /auth/me -> database -> GET /auth/me -> admin customer API
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerBuyer, adminToken, unique } from "./helpers.mjs";

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const uniquePhone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

test("profile update persists and is visible to the customer AND the admin", async () => {
  const buyer = await registerBuyer();
  const phone = uniquePhone();

  const res = await api("/auth/me", { method: "PATCH", token: buyer.token, body: {
    firstName: "Shivam", lastName: "Mishra", phone: `+91 ${phone}`,
  } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // The update returns the updated entity.
  assert.equal(res.body.data.user.firstName, "Shivam");
  assert.equal(res.body.data.user.phone, phone); // normalized to 10 digits

  // The customer's own /me reflects it (no logout/login needed).
  const me = await api("/auth/me", { token: buyer.token });
  assert.equal(me.body.data.user.firstName, "Shivam");
  assert.equal(me.body.data.user.lastName, "Mishra");

  // The ADMIN sees the same row — one source of truth, no separate copy.
  const admin = await adminToken();
  const detail = await api(`/admin/customers/${buyer.userId}`, { token: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.customer.name, "Shivam Mishra");
  assert.equal(detail.body.data.customer.phone, phone);
  assert.ok(detail.body.data.customer.updatedAt, "admin detail exposes last-updated");
});

test("duplicate email and phone answer 409 with the registration codes", async () => {
  const a = await registerBuyer();
  const b = await registerBuyer();
  const phone = uniquePhone();
  await api("/auth/me", { method: "PATCH", token: a.token, body: { phone } });

  const emailClash = await api("/auth/me", { method: "PATCH", token: b.token, body: { email: a.email } });
  assert.equal(emailClash.status, 409);
  assert.equal(emailClash.body.code, "EMAIL_TAKEN");

  const phoneClash = await api("/auth/me", { method: "PATCH", token: b.token, body: { phone } });
  assert.equal(phoneClash.status, 409);
  assert.equal(phoneClash.body.code, "PHONE_TAKEN");

  // Re-submitting your OWN current email is a no-op, not a conflict.
  const own = await api("/auth/me", { method: "PATCH", token: a.token, body: { email: a.email } });
  assert.equal(own.status, 200);
});

test("profile update validates input and requires authentication", async () => {
  const buyer = await registerBuyer();
  const badPhone = await api("/auth/me", { method: "PATCH", token: buyer.token, body: { phone: "12345" } });
  assert.equal(badPhone.status, 400);
  const empty = await api("/auth/me", { method: "PATCH", token: buyer.token, body: {} });
  assert.equal(empty.status, 400);
  const anon = await api("/auth/me", { method: "PATCH", body: { firstName: "X" } });
  assert.equal(anon.status, 401);
});

test("password change requires the current password, keeps this session, kills others", async () => {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "P", accountType: "buyer" } });
  const session1 = reg.body.data.accessToken;
  const login2 = await api("/auth/login", { method: "POST", body: { identifier: email, password: "Passw0rd1" } });
  const session2 = login2.body.data.accessToken;

  const wrong = await api("/auth/change-password", { method: "POST", token: session1, body: { currentPassword: "nope", newPassword: "NewPassw0rd" } });
  assert.equal(wrong.status, 401);

  const okRes = await api("/auth/change-password", { method: "POST", token: session1, body: { currentPassword: "Passw0rd1", newPassword: "NewPassw0rd" } });
  assert.equal(okRes.status, 200, JSON.stringify(okRes.body));

  // The calling session survives; the other device is signed out.
  assert.equal((await api("/auth/me", { token: session1 })).status, 200);
  assert.equal((await api("/auth/me", { token: session2 })).status, 401);

  // Old password no longer works; new one does.
  assert.equal((await api("/auth/login", { method: "POST", body: { identifier: email, password: "Passw0rd1" } })).status, 401);
  assert.equal((await api("/auth/login", { method: "POST", body: { identifier: email, password: "NewPassw0rd" } })).status, 200);
});

test("only one default address per kind, enforced server-side", async () => {
  const buyer = await registerBuyer();
  const base = { kind: "shipping", name: "Shivam Mishra", phone: "9811100001", line1: "12 MG Road",
    city: "New Delhi", state: "Delhi", postalCode: "110001", country: "India" };

  const a1 = await api("/addresses", { method: "POST", token: buyer.token, body: { ...base, isDefault: true } });
  const a2 = await api("/addresses", { method: "POST", token: buyer.token, body: { ...base, line1: "9 Ring Road", isDefault: true } });
  assert.equal(a1.status, 201);
  assert.equal(a2.status, 201);

  let list = (await api("/addresses", { token: buyer.token })).body.data;
  assert.equal(list.filter((a) => a.isDefault).length, 1, "exactly one default");
  assert.equal(list.find((a) => a.isDefault).id, a2.body.data.id);

  // Flip the default back via PATCH — swaps, never two defaults.
  const setDefault = await api(`/addresses/${a1.body.data.id}`, { method: "PATCH", token: buyer.token, body: { isDefault: true } });
  assert.equal(setDefault.status, 200);
  list = (await api("/addresses", { token: buyer.token })).body.data;
  assert.equal(list.filter((a) => a.isDefault).length, 1);
  assert.equal(list.find((a) => a.isDefault).id, a1.body.data.id);
});

test("customer A cannot touch customer B's addresses", async () => {
  const a = await registerBuyer();
  const b = await registerBuyer();
  const created = await api("/addresses", { method: "POST", token: a.token, body: {
    kind: "shipping", name: "Owner A", phone: "9811100002", line1: "1 Street",
    city: "Pune", state: "Maharashtra", postalCode: "411001", country: "India",
  } });
  const id = created.body.data.id;

  assert.equal((await api(`/addresses/${id}`, { method: "PATCH", token: b.token, body: { city: "Hacked" } })).status, 404);
  assert.equal((await api(`/addresses/${id}`, { method: "PATCH", token: b.token, body: { isDefault: true } })).status, 404);
  assert.equal((await api(`/addresses/${id}`, { method: "DELETE", token: b.token })).status, 404);
  // Still intact for the owner.
  const list = (await api("/addresses", { token: a.token })).body.data;
  assert.equal(list[0].city, "Pune");
});

test("a profile change does NOT rewrite historical order shipping snapshots", async () => {
  const buyer = await registerBuyer();
  // Address -> order (snapshot) via the real checkout path.
  const addr = await api("/addresses", { method: "POST", token: buyer.token, body: {
    kind: "shipping", name: "Before Rename", phone: "9811100003", line1: "42 Old Lane",
    city: "Jaipur", state: "Rajasthan", postalCode: "302001", country: "India", isDefault: true,
  } });
  const { prisma } = await import("../src/lib/prisma.mjs");
  const product = await prisma.product.create({ data: {
    id: `PRD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    slug: `test-box-snap-${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Box Snapshot", category: "Gift Boxes", status: "active",
    basePriceMinor: 10000, moq: 1, stock: 50,
  } });
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity: 2 } });
  const placed = await api("/checkout/place", { method: "POST", token: buyer.token, body: {
    shippingAddressId: addr.body.data.id, paymentMethod: "cod", idempotencyKey: `snap-${Date.now()}`,
  } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = placed.body.data.id;

  // Customer renames themselves and edits the address afterwards.
  await api("/auth/me", { method: "PATCH", token: buyer.token, body: { firstName: "After", lastName: "Rename" } });
  await api(`/addresses/${addr.body.data.id}`, { method: "PATCH", token: buyer.token, body: { name: "After Rename", city: "Mumbai" } });

  // The old order's shipping snapshot is untouched.
  const order = await api(`/orders/${orderId}`, { token: buyer.token });
  assert.equal(order.body.data.shippingAddress.name, "Before Rename");
  assert.equal(order.body.data.shippingAddress.city, "Jaipur");
});
