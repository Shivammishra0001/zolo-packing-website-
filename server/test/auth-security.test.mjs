// Authentication & authorization security tests.
// Covers privilege escalation, JWT tampering, IDOR, refresh rotation,
// session revocation and account status. Run: npm test (from server/)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startServer, stopServer, api, unique } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { env } from "../src/lib/env.mjs";

async function newBuyer() {
  const email = unique.email();
  const { body } = await api("/auth/register", {
    method: "POST",
    body: { email, password: "Passw0rd1", firstName: "Sec", accountType: "buyer" },
  });
  return { email, ...body.data };
}

before(startServer);
// Match the suite's existing convention: `after(stopServer)` only. Test users
// are left in place deliberately — deleting them here would cascade into the
// orders/sessions other tests in the same process are still using.
after(stopServer);

// ---- Privilege escalation -------------------------------------------------

test("a client-supplied role is ignored at registration", async () => {
  const email = unique.email();
  const { body } = await api("/auth/register", {
    method: "POST",
    // Attempt to self-provision as admin.
    body: { email, password: "Passw0rd1", firstName: "Esc", accountType: "buyer", role: "admin" },
  });
  assert.equal(body.data.user.role, "buyer", "role comes from the server, never the client");

  const row = await prisma.user.findUnique({ where: { email } });
  assert.equal(row.role, "buyer");
});

test("accountType cannot be an arbitrary privileged value", async () => {
  const { status } = await api("/auth/register", {
    method: "POST",
    body: { email: unique.email(), password: "Passw0rd1", firstName: "X", accountType: "admin" },
  });
  assert.equal(status, 400, "the enum rejects anything outside buyer/seller");
});

// ---- Token integrity ------------------------------------------------------

test("a tampered JWT payload (role → admin) is rejected", async () => {
  const buyer = await newBuyer();
  const [h, p, s] = buyer.accessToken.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  payload.role = "admin";
  const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;

  const { status } = await api("/admin/orders", { token: forged });
  assert.equal(status, 401, "signature no longer matches the payload");
});

test("a token signed with the wrong secret is rejected", async () => {
  const forged = jwt.sign({ sub: "anyone", role: "admin" }, "attacker-secret", { expiresIn: "1h" });
  const { status } = await api("/admin/orders", { token: forged });
  assert.equal(status, 401);
});

test("an alg=none token is rejected", async () => {
  const none = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIn0.";
  const { status } = await api("/admin/orders", { token: none });
  assert.equal(status, 401);
});

test("an expired access token is rejected", async () => {
  const expired = jwt.sign({ sub: "x", role: "admin" }, env.jwtSecret, { expiresIn: "-1h" });
  const { status } = await api("/auth/me", { token: expired });
  assert.equal(status, 401);
});

test("garbage and missing tokens are rejected", async () => {
  assert.equal((await api("/admin/orders", { token: "not-a-jwt" })).status, 401);
  assert.equal((await api("/admin/orders")).status, 401);
});

// ---- Role-based access ----------------------------------------------------

test("a buyer gets 403 (not 401) on admin routes — authenticated but unauthorized", async () => {
  const buyer = await newBuyer();
  const { status } = await api("/admin/orders", { token: buyer.accessToken });
  assert.equal(status, 403);
});

test("a buyer cannot reach seller routes", async () => {
  const buyer = await newBuyer();
  const { status } = await api("/sellers/me", { token: buyer.accessToken });
  assert.ok(status === 403 || status === 404, `expected 403/404, got ${status}`);
});

// ---- Object-level authorization (IDOR) ------------------------------------

test("a buyer cannot read another buyer's order", async () => {
  const a = await newBuyer();
  const b = await newBuyer();

  const product = await prisma.product.findFirst({
    where: { status: "active", deletedAt: null, basePriceMinor: { gt: 0 }, stock: { gt: 0 } },
  });
  if (!product) return; // no purchasable product seeded; covered by orders.test.mjs

  await api("/cart/items", { method: "POST", token: a.accessToken, body: { productId: product.id, quantity: product.moq } });
  const addr = await api("/addresses", { method: "POST", token: a.accessToken, body: {
    kind: "shipping", name: "A Person", phone: "9876543210",
    line1: "1 Test St", city: "Bengaluru", state: "Karnataka", postalCode: "560001" } });
  const placed = await api("/checkout/place", { method: "POST", token: a.accessToken, body: {
    shippingAddressId: addr.body.data.id, paymentMethod: "cod", idempotencyKey: `sec-${Math.random()}` } });
  const orderId = placed.body.data?.id;
  assert.ok(orderId, "order was placed");

  const stolen = await api(`/orders/${orderId}`, { token: b.accessToken });
  assert.ok(stolen.status === 403 || stolen.status === 404, `B must not read A's order (got ${stolen.status})`);
  assert.equal((await api(`/orders/${orderId}`, { token: a.accessToken })).status, 200, "A still reads their own");
});

// ---- Refresh token rotation & revocation ----------------------------------

test("refreshing rotates the token and kills the old one", async () => {
  const u = await newBuyer();
  const first = await api("/auth/refresh", { method: "POST", body: { refreshToken: u.refreshToken } });
  assert.equal(first.status, 200);
  const rotated = first.body.data.refreshToken;
  assert.ok(rotated && rotated !== u.refreshToken, "a NEW refresh token is issued");

  const replay = await api("/auth/refresh", { method: "POST", body: { refreshToken: u.refreshToken } });
  assert.equal(replay.status, 401, "the presented token is revoked after use");
});

test("reusing a revoked refresh token revokes the whole session family", async () => {
  const u = await newBuyer();
  const rotated = (await api("/auth/refresh", { method: "POST", body: { refreshToken: u.refreshToken } })).body.data.refreshToken;
  // Replay the original → treated as compromise.
  await api("/auth/refresh", { method: "POST", body: { refreshToken: u.refreshToken } });
  const after = await api("/auth/refresh", { method: "POST", body: { refreshToken: rotated } });
  assert.equal(after.status, 401, "the legitimate rotated token is also revoked");
});

test("logout revokes the refresh token server-side", async () => {
  const u = await newBuyer();
  await api("/auth/logout", { method: "POST", body: { refreshToken: u.refreshToken } });
  const after = await api("/auth/refresh", { method: "POST", body: { refreshToken: u.refreshToken } });
  assert.equal(after.status, 401, "a logged-out session cannot be resurrected");
});

test("logout-all revokes every session and requires authentication", async () => {
  const u = await newBuyer();
  const second = await api("/auth/login", { method: "POST", body: { identifier: u.email, password: "Passw0rd1" } });

  assert.equal((await api("/auth/logout-all", { method: "POST" })).status, 401, "needs a token");

  const res = await api("/auth/logout-all", { method: "POST", token: second.body.data.accessToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.revoked >= 2);

  for (const rt of [u.refreshToken, second.body.data.refreshToken]) {
    assert.equal((await api("/auth/refresh", { method: "POST", body: { refreshToken: rt } })).status, 401);
  }
});

// ---- Account status -------------------------------------------------------

test("deactivating an account invalidates its live access token immediately", async () => {
  const u = await newBuyer();
  assert.equal((await api("/auth/me", { token: u.accessToken })).status, 200);

  await prisma.user.update({ where: { id: u.user.id }, data: { isActive: false } });

  // Same, still-unexpired token — rejected because the middleware re-checks the DB.
  assert.equal((await api("/auth/me", { token: u.accessToken })).status, 401);
  assert.equal((await api("/auth/refresh", { method: "POST", body: { refreshToken: u.refreshToken } })).status, 401);
  assert.equal((await api("/auth/login", { method: "POST", body: { identifier: u.email, password: "Passw0rd1" } })).status, 401);
});

// ---- Data exposure --------------------------------------------------------

test("no auth response ever exposes a password hash", async () => {
  const u = await newBuyer();
  for (const res of [
    await api("/auth/me", { token: u.accessToken }),
    await api("/auth/login", { method: "POST", body: { identifier: u.email, password: "Passw0rd1" } }),
  ]) {
    assert.ok(!/passwordHash|\$2[aby]\$/.test(JSON.stringify(res.body)), "no hash in the payload");
  }
});

test("login errors do not reveal whether an account exists", async () => {
  const u = await newBuyer();
  const wrongPassword = await api("/auth/login", { method: "POST", body: { identifier: u.email, password: "WrongPass9" } });
  const noSuchUser = await api("/auth/login", { method: "POST", body: { identifier: unique.email(), password: "WrongPass9" } });
  assert.equal(wrongPassword.status, noSuchUser.status);
  assert.equal(wrongPassword.body.error, noSuchUser.body.error, "identical message — no user enumeration");
});
