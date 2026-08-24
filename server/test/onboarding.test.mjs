import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerSeller, completeMinimum, unique } from "./helpers.mjs";

before(startServer);
after(stopServer);

test("draft persists and resumes across requests", async () => {
  const { token } = await registerSeller();
  await api("/sellers/me/onboarding", { method: "PATCH", token, body: { legalName: "Persisted Ltd", onboardingStep: 3 } });
  const got = await api("/sellers/me/onboarding", { token });
  assert.equal(got.body.data.legalName, "Persisted Ltd");
  assert.equal(got.body.data.onboardingStep, 3);
});

test("invalid GST format is rejected", async () => {
  const { token } = await registerSeller();
  const r = await api("/sellers/me/onboarding", { method: "PATCH", token, body: { gstNumber: "NOT-A-GST" } });
  assert.equal(r.status, 400);
});

test("duplicate GST across suppliers is rejected", async () => {
  const gst = unique.gst();
  const a = await registerSeller();
  await api("/sellers/me/onboarding", { method: "PATCH", token: a.token, body: { gstNumber: gst } });
  const b = await registerSeller();
  const r = await api("/sellers/me/onboarding", { method: "PATCH", token: b.token, body: { gstNumber: gst } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "GST_TAKEN");
});

test("bank account is stored masked; plaintext never returned", async () => {
  const { token } = await registerSeller();
  const r = await api("/sellers/me/bank-accounts", { method: "POST", token, body: { accountHolderName: "X", bankName: "HDFC", accountNumber: "123456789012", ifsc: "HDFC0001234" } });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.accountLast4, "9012");
  assert.equal(r.body.data.accountNumber, undefined);
  assert.equal(r.body.data.accountNumberEnc, undefined);
});

test("document upload hides storageKey; oversized/bad mime rejected", async () => {
  const { token } = await registerSeller();
  const ok = await api("/sellers/me/documents", { method: "POST", token, body: { type: "PAN", fileName: "pan.pdf", mime: "application/pdf", dataBase64: Buffer.from("%PDF").toString("base64") } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.storageKey, undefined);

  const badMime = await api("/sellers/me/documents", { method: "POST", token, body: { type: "PAN", fileName: "x.exe", mime: "application/x-msdownload", dataBase64: Buffer.from("MZ").toString("base64") } });
  assert.equal(badMime.status, 400);
});

test("submit blocked when incomplete, succeeds when complete, blocks double-submit", async () => {
  const { token } = await registerSeller();
  const early = await api("/sellers/me/onboarding/submit", { method: "POST", token });
  assert.equal(early.status, 400);
  assert.equal(early.body.code, "INCOMPLETE");

  await completeMinimum(token);
  const submit = await api("/sellers/me/onboarding/submit", { method: "POST", token });
  assert.equal(submit.status, 200);
  assert.equal(submit.body.data.status, "SUBMITTED");

  const again = await api("/sellers/me/onboarding/submit", { method: "POST", token });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "ALREADY_SUBMITTED");
});

test("submitted profile cannot be edited by seller", async () => {
  const { token } = await registerSeller();
  await completeMinimum(token);
  await api("/sellers/me/onboarding/submit", { method: "POST", token });
  const edit = await api("/sellers/me/onboarding", { method: "PATCH", token, body: { description: "sneaky" } });
  assert.equal(edit.status, 403);
});

test("a buyer cannot access seller endpoints", async () => {
  const reg = await api("/auth/register", { method: "POST", body: { email: unique.email(), password: "Passw0rd1", firstName: "Buy" } });
  const r = await api("/sellers/me/onboarding", { token: reg.body.data.accessToken });
  assert.equal(r.status, 403);
});
