import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, unique } from "./helpers.mjs";

before(startServer);
after(stopServer);

test("register creates a buyer with tokens", async () => {
  const r = await api("/auth/register", { method: "POST", body: { email: unique.email(), password: "Passw0rd1", firstName: "Bob" } });
  assert.equal(r.status, 201);
  assert.ok(r.body.data.accessToken);
  assert.equal(r.body.data.organizationId, null); // buyers get no supplier org
});

test("register as seller provisions org + supplier profile", async () => {
  const r = await api("/auth/register", { method: "POST", body: { email: unique.email(), password: "Passw0rd1", firstName: "Sam", accountType: "seller", companyName: unique.company() } });
  assert.equal(r.status, 201);
  assert.ok(r.body.data.organizationId);
  const me = await api("/auth/me", { token: r.body.data.accessToken });
  assert.equal(me.body.data.supplier.status, "DRAFT");
});

test("duplicate email is rejected", async () => {
  const email = unique.email();
  await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "A" } });
  const dup = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "A" } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "EMAIL_TAKEN");
});

test("weak password is rejected by validation", async () => {
  const r = await api("/auth/register", { method: "POST", body: { email: unique.email(), password: "short", firstName: "A" } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "VALIDATION");
});

test("login with wrong password gives generic 401", async () => {
  const email = unique.email();
  await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "A" } });
  const r = await api("/auth/login", { method: "POST", body: { email, password: "WrongPass9" } });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Invalid email or password/);
});

test("protected route rejects missing token", async () => {
  const r = await api("/auth/me");
  assert.equal(r.status, 401);
});

test("refresh returns a fresh access token; logout revokes it", async () => {
  const reg = await api("/auth/register", { method: "POST", body: { email: unique.email(), password: "Passw0rd1", firstName: "A" } });
  const refreshToken = reg.body.data.refreshToken;
  const refreshed = await api("/auth/refresh", { method: "POST", body: { refreshToken } });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.data.accessToken);
  await api("/auth/logout", { method: "POST", body: { refreshToken } });
  const after = await api("/auth/refresh", { method: "POST", body: { refreshToken } });
  assert.equal(after.status, 401);
});
