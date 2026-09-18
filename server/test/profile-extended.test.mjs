// Complete customer profile: business fields, preferences, profile photo,
// address labels / per-kind defaults, and admin visibility.
//
// Pins the REAL chain for every field the customer can now edit:
//   register / PATCH /auth/me / POST /auth/me/photo -> PostgreSQL
//     -> GET /auth/me (customer) -> GET /admin/customers/:id (admin)
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, apiRaw, registerBuyer, adminToken, unique, fetchUpload } from "./helpers.mjs";

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

// 1x1 PNG — small but a genuine image (passes the magic-byte check).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("buyer registration keeps the company name (it used to be dropped)", async () => {
  const email = unique.email();
  const company = unique.company();
  const reg = await api("/auth/register", { method: "POST", body: {
    email, password: "Passw0rd1", firstName: "Reg", accountType: "buyer", companyName: company,
  } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.data.user.company, company);
  const me = await api("/auth/me", { token: reg.body.data.accessToken });
  assert.equal(me.body.data.user.company, company);
});

test("all business/contact fields + preferences persist and the admin sees the same row", async () => {
  const buyer = await registerBuyer();
  const gstin = unique.gst();
  const pan = unique.pan();

  const res = await api("/auth/me", { method: "PATCH", token: buyer.token, body: {
    company: "Acme Packaging",
    businessType: "D2C Brand",
    industry: "Food & Beverage",
    gstin: gstin.toLowerCase(), // normalised to upper-case
    pan: pan.toLowerCase(),
    website: "https://acme.example",
    alternatePhone: "+91 9123456780",
    dateOfBirth: "1990-05-15",
    gender: "female",
    preferences: { orderUpdates: true, promotions: false },
  } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const u = res.body.data.user;
  assert.equal(u.dateOfBirth, "1990-05-15", "DOB round-trips as YYYY-MM-DD");
  assert.equal(u.gender, "female");
  assert.equal(u.company, "Acme Packaging");
  assert.equal(u.gstin, gstin.toUpperCase());
  assert.equal(u.pan, pan.toUpperCase());
  assert.equal(u.website, "https://acme.example");
  assert.equal(u.alternatePhone, "9123456780");
  assert.deepEqual(u.preferences, { orderUpdates: true, promotions: false });
  assert.equal("passwordHash" in u, false, "password hash must never be returned");

  // A partial preferences update MERGES rather than wiping other toggles.
  const p2 = await api("/auth/me", { method: "PATCH", token: buyer.token, body: { preferences: { whatsapp: true } } });
  assert.deepEqual(p2.body.data.user.preferences, { orderUpdates: true, promotions: false, whatsapp: true });

  // Clearing a field with "" or null works.
  const cleared = await api("/auth/me", { method: "PATCH", token: buyer.token, body: { website: "", industry: null } });
  assert.equal(cleared.body.data.user.website, null);
  assert.equal(cleared.body.data.user.industry, null);

  // Admin reads the same User row — no separate customer copy.
  const admin = await adminToken();
  const detail = await api(`/admin/customers/${buyer.userId}`, { token: admin });
  assert.equal(detail.status, 200);
  const c = detail.body.data.customer;
  assert.equal(c.company, "Acme Packaging");
  assert.equal(c.businessType, "D2C Brand");
  assert.equal(c.gstin, gstin.toUpperCase());
  assert.equal(c.pan, pan.toUpperCase());
  assert.equal(c.alternatePhone, "9123456780");
  assert.equal(c.dateOfBirth, "1990-05-15");
  assert.equal(c.gender, "female");
  assert.deepEqual(c.preferences, { orderUpdates: true, promotions: false, whatsapp: true });

  // …and the list is searchable by company.
  const list = await api(`/admin/customers?search=${encodeURIComponent("Acme Packaging")}`, { token: admin });
  assert.ok(list.body.data.customers.some((x) => x.id === buyer.userId && x.company === "Acme Packaging"));
});

test("GSTIN / PAN / website are validated", async () => {
  const buyer = await registerBuyer();
  for (const body of [{ gstin: "NOT-A-GSTIN" }, { pan: "12345" }, { website: "not a url" }, { dateOfBirth: "2999-01-01" }, { dateOfBirth: "15/05/1990" }, { gender: "unknown" }]) {
    const res = await api("/auth/me", { method: "PATCH", token: buyer.token, body });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
  }
});

test("profile photo: upload stores a public URL, is served, replaces, and can be removed", async () => {
  const buyer = await registerBuyer();

  const up = await api("/auth/me/photo", { method: "POST", token: buyer.token, body: { name: "me.png", mime: "image/png", dataBase64: PNG_B64 } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const url = up.body.data.user.avatarUrl;
  assert.ok(url && url.includes("/uploads/"), `expected a public upload URL, got ${url}`);

  // The file is really there and served as an image.
  const served = await fetchUpload(url);
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-type") || "", /^image\/png/);

  // Persisted: the customer sees it on /me and the admin on the customer.
  const me = await api("/auth/me", { token: buyer.token });
  assert.equal(me.body.data.user.avatarUrl, url);
  const admin = await adminToken();
  const detail = await api(`/admin/customers/${buyer.userId}`, { token: admin });
  assert.equal(detail.body.data.customer.avatarUrl, url);

  // Replacing yields a NEW url (old file is cleaned up).
  const up2 = await api("/auth/me/photo", { method: "POST", token: buyer.token, body: { name: "me2.png", mime: "image/png", dataBase64: PNG_B64 } });
  assert.equal(up2.status, 201);
  assert.notEqual(up2.body.data.user.avatarUrl, url);
  assert.equal((await fetchUpload(url)).status, 404, "old photo file should be deleted after replace");

  // Bad type / not-an-image are rejected; nothing is stored.
  const bad = await api("/auth/me/photo", { method: "POST", token: buyer.token, body: { name: "x.gif", mime: "image/gif", dataBase64: PNG_B64 } });
  assert.equal(bad.status, 400);
  const fake = await api("/auth/me/photo", { method: "POST", token: buyer.token, body: { name: "x.png", mime: "image/png", dataBase64: Buffer.from("not an image").toString("base64") } });
  assert.equal(fake.status, 400);

  // Remove → default avatar.
  const rm = await api("/auth/me/photo", { method: "DELETE", token: buyer.token });
  assert.equal(rm.status, 200);
  assert.equal(rm.body.data.user.avatarUrl, null);
  assert.equal((await api("/auth/me", { token: buyer.token })).body.data.user.avatarUrl, null);

  // Unauthenticated callers cannot touch photos.
  assert.equal((await api("/auth/me/photo", { method: "DELETE" })).status, 401);
});

test("addresses: label, first-of-kind auto-default, explicit set-default, and auto-promote on delete", async () => {
  const buyer = await registerBuyer();
  const base = { name: "Anita Desai", phone: "9811122233", line1: "7 Marine Drive", city: "Mumbai", state: "Maharashtra", postalCode: "400020" };

  const a1 = await api("/addresses", { method: "POST", token: buyer.token, body: { ...base, label: "Home" } });
  assert.equal(a1.status, 201, JSON.stringify(a1.body));
  assert.equal(a1.body.data.label, "Home");
  assert.equal(a1.body.data.isDefault, true, "first shipping address becomes the default automatically");

  const a2 = await api("/addresses", { method: "POST", token: buyer.token, body: { ...base, label: "Office", line1: "5 FC Road" } });
  assert.equal(a2.body.data.isDefault, false);

  // Billing is a separate default — the first billing address is auto-default
  // without disturbing the shipping default.
  const b1 = await api("/addresses", { method: "POST", token: buyer.token, body: { ...base, kind: "billing", label: "HQ" } });
  assert.equal(b1.body.data.isDefault, true);
  let list = (await api("/addresses", { token: buyer.token })).body.data;
  assert.equal(list.find((a) => a.id === a1.body.data.id).isDefault, true);

  // Explicit set-default demotes the previous default of the SAME kind only.
  const sd = await api(`/addresses/${a2.body.data.id}/default`, { method: "POST", token: buyer.token });
  assert.equal(sd.status, 200);
  list = (await api("/addresses", { token: buyer.token })).body.data;
  assert.equal(list.find((a) => a.id === a2.body.data.id).isDefault, true);
  assert.equal(list.find((a) => a.id === a1.body.data.id).isDefault, false);
  assert.equal(list.find((a) => a.id === b1.body.data.id).isDefault, true, "billing default untouched");

  // Deleting the default promotes another address of that kind.
  await api(`/addresses/${a2.body.data.id}`, { method: "DELETE", token: buyer.token });
  list = (await api("/addresses", { token: buyer.token })).body.data;
  assert.equal(list.find((a) => a.id === a1.body.data.id).isDefault, true, "remaining shipping address promoted");
  assert.equal(list.filter((a) => a.kind === "shipping" && a.isDefault).length, 1);

  // Another customer cannot set-default someone else's address.
  const other = await registerBuyer();
  assert.equal((await api(`/addresses/${a1.body.data.id}/default`, { method: "POST", token: other.token })).status, 404);
});
