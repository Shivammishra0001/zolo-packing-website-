import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, registerSeller, completeMinimum, adminToken } from "./helpers.mjs";

before(startServer);
after(stopServer);

async function submittedSeller() {
  const s = await registerSeller();
  await completeMinimum(s.token);
  await api("/sellers/me/onboarding/submit", { method: "POST", token: s.token });
  return s;
}

test("seller is forbidden from admin routes (RBAC)", async () => {
  const s = await submittedSeller();
  const r = await api(`/admin/sellers/${s.supplierId}`, { token: s.token });
  assert.equal(r.status, 403);
});

test("admin lists and views a submitted seller with masked bank", async () => {
  const admin = await adminToken();
  const s = await submittedSeller();
  const list = await api("/admin/sellers?status=SUBMITTED", { token: admin });
  assert.ok(list.body.data.items.some((i) => i.id === s.supplierId));
  const detail = await api(`/admin/sellers/${s.supplierId}`, { token: admin });
  assert.equal(detail.status, 200);
  assert.ok(detail.body.data.bankAccounts[0].accountLast4);
  assert.equal(detail.body.data.bankAccounts[0].accountNumberEnc, undefined);
});

test("change-request → seller edits → resubmit → review → approve unlocks dashboard", async () => {
  const admin = await adminToken();
  const s = await submittedSeller();

  const cr = await api(`/admin/sellers/${s.supplierId}/request-changes`, { method: "POST", token: admin, body: { issues: [{ section: "documents", message: "GST expired" }] } });
  assert.equal(cr.body.data.status, "CHANGES_REQUESTED");

  const edit = await api("/sellers/me/onboarding", { method: "PATCH", token: s.token, body: { description: "fixed" } });
  assert.equal(edit.status, 200);

  const resub = await api("/sellers/me/onboarding/submit", { method: "POST", token: s.token });
  assert.equal(resub.body.data.status, "SUBMITTED");

  await api(`/admin/sellers/${s.supplierId}/review`, { method: "POST", token: admin });
  const approve = await api(`/admin/sellers/${s.supplierId}/approve`, { method: "POST", token: admin });
  assert.equal(approve.body.data.status, "APPROVED");
  assert.equal(approve.body.data.verificationStatus, "VERIFIED");

  const notif = await api("/notifications", { token: s.token });
  assert.ok(notif.body.data.items.some((n) => n.type === "seller.approved"));

  const dash = await api("/sellers/me/dashboard", { token: s.token });
  assert.equal(dash.body.data.status, "APPROVED");
});

test("reject requires a reason and sets REJECTED", async () => {
  const admin = await adminToken();
  const s = await submittedSeller();
  const noReason = await api(`/admin/sellers/${s.supplierId}/reject`, { method: "POST", token: admin, body: {} });
  assert.equal(noReason.status, 400);
  const ok = await api(`/admin/sellers/${s.supplierId}/reject`, { method: "POST", token: admin, body: { reason: "Incomplete documents" } });
  assert.equal(ok.body.data.status, "REJECTED");
});

test("cannot approve a DRAFT seller (bad transition)", async () => {
  const admin = await adminToken();
  const s = await registerSeller(); // still DRAFT
  const r = await api(`/admin/sellers/${s.supplierId}/approve`, { method: "POST", token: admin });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "BAD_TRANSITION");
});

test("suspend then reactivate an approved seller", async () => {
  const admin = await adminToken();
  const s = await submittedSeller();
  await api(`/admin/sellers/${s.supplierId}/approve`, { method: "POST", token: admin });
  const sus = await api(`/admin/sellers/${s.supplierId}/suspend`, { method: "POST", token: admin, body: { reason: "policy" } });
  assert.equal(sus.body.data.status, "SUSPENDED");
  const re = await api(`/admin/sellers/${s.supplierId}/reactivate`, { method: "POST", token: admin });
  assert.equal(re.body.data.status, "APPROVED");
});

test("audit log accumulates events for the seller lifecycle", async () => {
  const admin = await adminToken();
  const s = await submittedSeller();
  await api(`/admin/sellers/${s.supplierId}/approve`, { method: "POST", token: admin });
  // Verified indirectly: status history is included on the admin detail.
  const detail = await api(`/admin/sellers/${s.supplierId}`, { token: admin });
  const toStatuses = detail.body.data.statusHistory.map((h) => h.toStatus);
  assert.ok(toStatuses.includes("SUBMITTED"));
  assert.ok(toStatuses.includes("APPROVED"));
});
