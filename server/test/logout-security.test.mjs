// Logout must actually end the session.
//
// Two defects made "log out" fail to log the user out:
//
//   1. Access tokens were free-standing bearer credentials. Logout revoked the
//      refresh token, but the already-issued access token kept working until it
//      expired — up to 15 minutes of authenticated access after signing out.
//
//   2. (frontend) Each portal cleared only its own localStorage keys, so
//      signing out of one left the other's refresh token behind and the app
//      restored that session on reload with no password.
//
// This file covers the server half. The fix binds every access token to the
// session that minted it (`sid`), so revoking the session kills the token.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, unique } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

before(startServer);
after(stopServer);

async function freshUser(accountType = "buyer") {
  const email = unique.email();
  const res = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Session", accountType,
    ...(accountType === "seller" ? { companyName: "Session Co" } : {}) } });
  assert.equal(res.status, 201, JSON.stringify(res.body).slice(0, 160));
  return { email, ...res.body.data };
}

test("the access token stops working the moment the user logs out", async () => {
  const { accessToken, refreshToken } = await freshUser();

  assert.equal((await api("/auth/me", { token: accessToken })).status, 200);

  const out = await api("/auth/logout", { method: "POST", body: { refreshToken } });
  assert.equal(out.status, 200);

  // This returned 200 before the fix — the token outlived the session.
  assert.equal((await api("/auth/me", { token: accessToken })).status, 401,
    "a logged-out access token must be rejected immediately");
  assert.equal((await api("/me/payments", { token: accessToken })).status, 401,
    "every authenticated route rejects it, not just /auth/me");
  assert.equal((await api("/auth/refresh", { method: "POST", body: { refreshToken } })).status, 401,
    "the refresh token is revoked too");
});

test("logging out one session leaves the user's other sessions alone", async () => {
  // Two devices: signing out of a phone must not sign out a laptop.
  const { email, refreshToken: phoneRefresh } = await freshUser();
  const laptop = await api("/auth/login", { method: "POST", body: { identifier: email, password: "Passw0rd1" } });
  const laptopAccess = laptop.body.data.accessToken;

  await api("/auth/logout", { method: "POST", body: { refreshToken: phoneRefresh } });

  assert.equal((await api("/auth/me", { token: laptopAccess })).status, 200,
    "the other device stays signed in");
});

test("logout-all ends every session for the user", async () => {
  const { email, accessToken, refreshToken } = await freshUser();
  const second = await api("/auth/login", { method: "POST", body: { identifier: email, password: "Passw0rd1" } });
  const secondAccess = second.body.data.accessToken;

  const res = await api("/auth/logout-all", { method: "POST", token: accessToken });
  assert.equal(res.status, 200);

  assert.equal((await api("/auth/me", { token: accessToken })).status, 401);
  assert.equal((await api("/auth/me", { token: secondAccess })).status, 401,
    "the other session dies too");
  assert.equal((await api("/auth/refresh", { method: "POST", body: { refreshToken } })).status, 401);
});

test("a rotated refresh token issues an access token bound to the NEW session", async () => {
  const { refreshToken } = await freshUser();

  const rotated = await api("/auth/refresh", { method: "POST", body: { refreshToken } });
  assert.equal(rotated.status, 200);
  const { accessToken: newAccess, refreshToken: newRefresh } = rotated.body.data;

  assert.equal((await api("/auth/me", { token: newAccess })).status, 200);

  // Logging out with the NEW refresh token must invalidate the NEW access
  // token — if rotation bound the token to the old session, this would pass 200.
  await api("/auth/logout", { method: "POST", body: { refreshToken: newRefresh } });
  assert.equal((await api("/auth/me", { token: newAccess })).status, 401,
    "the rotated access token is bound to the rotated session");
});

test("a token whose session row is gone is rejected", async () => {
  const { accessToken, refreshToken } = await freshUser();
  assert.equal((await api("/auth/me", { token: accessToken })).status, 200);

  // Simulate session cleanup / pruning.
  const { hashToken } = await import("../src/lib/crypto.mjs");
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(refreshToken) } });

  assert.equal((await api("/auth/me", { token: accessToken })).status, 401,
    "no session row means no access, even with a validly signed token");
});

test("an expired session rejects its access token", async () => {
  const { accessToken, refreshToken } = await freshUser();
  const { hashToken } = await import("../src/lib/crypto.mjs");

  await prisma.session.updateMany({
    where: { tokenHash: hashToken(refreshToken) },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  assert.equal((await api("/auth/me", { token: accessToken })).status, 401,
    "session expiry is enforced on every request, not only at refresh");
});

test("a seller logging out cannot keep using seller endpoints", async () => {
  const { accessToken, refreshToken } = await freshUser("seller");
  assert.equal((await api("/sellers/me/dashboard", { token: accessToken })).status, 200);

  await api("/auth/logout", { method: "POST", body: { refreshToken } });

  assert.equal((await api("/sellers/me/dashboard", { token: accessToken })).status, 401,
    "the seller console is closed the moment the session ends");
});
