// The complete authentication chain, end to end.
//
// Context: binding access tokens to sessions (so logout actually logs out)
// meant every token issued before that change lacks the `sid` claim and is
// rejected. Browsers holding one saw 401s on /auth/me and /cart.
//
// That rejection is correct. What matters is that the client can RECOVER:
// a 401 on an expired/stale access token must be repairable by refreshing,
// without the user re-entering a password — and must NOT be repairable once
// the session is genuinely revoked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startServer, stopServer, api, unique } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { env } from "../src/lib/env.mjs";

let product;

before(async () => {
  await startServer();
  product = await prisma.product.upsert({
    where: { sku: "TST-AUTHCHAIN-PRODUCT" },
    update: { stock: 100, reservedStock: 0, basePriceMinor: 10000, moq: 1, status: "active", deletedAt: null },
    create: {
      id: `PRD-AUTH${Math.floor(Math.random() * 900 + 100)}`,
      sku: "TST-AUTHCHAIN-PRODUCT", slug: `tst-authchain-${Date.now()}`,
      name: "Auth Chain Product", category: "Boxes", subcategory: "General",
      status: "active", basePriceMinor: 10000, moq: 1, stock: 100, lowStockLevel: 5,
    },
  });
});

after(async () => {
  await prisma.product.deleteMany({ where: { sku: "TST-AUTHCHAIN-PRODUCT" } }).catch(() => {});
  await stopServer();
});

async function newBuyer() {
  const email = unique.email();
  const res = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Chain", accountType: "buyer" } });
  assert.equal(res.status, 201);
  return { email, ...res.body.data };
}

test("the full login -> use -> refresh -> logout -> login loop works", async () => {
  const { email } = await newBuyer();

  const login = await api("/auth/login", { method: "POST", body: { identifier: email, password: "Passw0rd1" } });
  assert.equal(login.status, 200);
  let { accessToken, refreshToken } = login.body.data;

  // Every authenticated surface the app touches on load.
  for (const path of ["/auth/me", "/cart", "/orders", "/me/payments", "/me/shipments", "/me/dashboard"]) {
    assert.equal((await api(path, { token: accessToken })).status, 200, `${path} after login`);
  }

  // A page refresh rotates the token; the session must survive.
  const rotated = await api("/auth/refresh", { method: "POST", body: { refreshToken } });
  assert.equal(rotated.status, 200);
  accessToken = rotated.body.data.accessToken;
  refreshToken = rotated.body.data.refreshToken;
  assert.equal((await api("/auth/me", { token: accessToken })).status, 200, "/auth/me after refresh");
  assert.equal((await api("/cart", { token: accessToken })).status, 200, "/cart after refresh");

  // Logout ends it.
  await api("/auth/logout", { method: "POST", body: { refreshToken } });
  assert.equal((await api("/auth/me", { token: accessToken })).status, 401);
  assert.equal((await api("/cart", { token: accessToken })).status, 401);

  // And signing in again restores access.
  const again = await api("/auth/login", { method: "POST", body: { identifier: email, password: "Passw0rd1" } });
  assert.equal(again.status, 200);
  assert.equal((await api("/auth/me", { token: again.body.data.accessToken })).status, 200);
  assert.equal((await api("/cart", { token: again.body.data.accessToken })).status, 200);
});

test("a token minted before session-binding is rejected but the session is recoverable by refresh", async () => {
  const { user, refreshToken } = await newBuyer();

  // Exactly the shape of a pre-change token: valid signature, no `sid`.
  const legacyToken = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.jwtSecret,
    { expiresIn: "15m" },
  );

  assert.equal((await api("/auth/me", { token: legacyToken })).status, 401,
    "a token with no session claim cannot authenticate");
  assert.equal((await api("/cart", { token: legacyToken })).status, 401);

  // This is the recovery path the browser takes — no password required.
  const refreshed = await api("/auth/refresh", { method: "POST", body: { refreshToken } });
  assert.equal(refreshed.status, 200, "the refresh token still works");
  const fresh = refreshed.body.data.accessToken;

  assert.equal((await api("/auth/me", { token: fresh })).status, 200, "recovered without re-login");
  assert.equal((await api("/cart", { token: fresh })).status, 200);
});

test("once the session is revoked, refresh cannot resurrect it", async () => {
  const { accessToken, refreshToken } = await newBuyer();
  await api("/auth/logout", { method: "POST", body: { refreshToken } });

  assert.equal((await api("/auth/refresh", { method: "POST", body: { refreshToken } })).status, 401,
    "a revoked refresh token is not a recovery path");
  assert.equal((await api("/auth/me", { token: accessToken })).status, 401);
});

test("/cart is scoped to the authenticated buyer and never leaks", async () => {
  const alice = await newBuyer();
  const bob = await newBuyer();

  const added = await api("/cart/items", { method: "POST", token: alice.accessToken,
    body: { productId: product.id, quantity: 2 } });
  assert.ok([200, 201].includes(added.status));

  const aliceCart = await api("/cart", { token: alice.accessToken });
  const bobCart = await api("/cart", { token: bob.accessToken });

  assert.equal(aliceCart.body.data.items.length, 1);
  assert.equal(bobCart.body.data.items.length, 0, "bob sees his own empty cart, not alice's");
  assert.notEqual(aliceCart.body.data.cartId, bobCart.body.data.cartId, "separate carts");
});

test("unauthenticated and malformed credentials are rejected on both endpoints", async () => {
  for (const path of ["/auth/me", "/cart"]) {
    assert.equal((await api(path)).status, 401, `${path} with no token`);
    assert.equal((await api(path, { token: "not.a.jwt" })).status, 401, `${path} with a malformed token`);
    assert.equal(
      (await api(path, { token: jwt.sign({ sub: "nobody", sid: "nope" }, "wrong-secret") })).status,
      401,
      `${path} with a bad signature`,
    );
  }
});

test("a buyer cannot reach admin endpoints", async () => {
  const { accessToken } = await newBuyer();
  assert.equal((await api("/admin/dashboard", { token: accessToken })).status, 403);
});

test("refresh rate limiting is per-token, so shared-IP users are not locked out", async () => {
  // Everyone in an office shares one public IP. An IP-keyed refresh limit would
  // lock the whole building out of session recovery.
  const a = await newBuyer();
  const b = await newBuyer();

  // Burn through one session's refresh budget.
  let token = a.refreshToken;
  for (let i = 0; i < 25; i += 1) {
    const res = await api("/auth/refresh", { method: "POST", body: { refreshToken: token } });
    if (res.status === 200) token = res.body.data.refreshToken;
    if (res.status === 429) break;
  }

  // A different user (same test-client IP) must still be able to refresh.
  const other = await api("/auth/refresh", { method: "POST", body: { refreshToken: b.refreshToken } });
  assert.equal(other.status, 200, "another user on the same IP is unaffected");
});
