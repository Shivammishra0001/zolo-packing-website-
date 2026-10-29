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

test("suspending a supplier actually revokes their write access", async () => {
  // The bug this pins: requireSeller checked the ROLE only, so suspension
  // flipped a database field and nothing else. A suspended supplier carried on
  // editing their profile and — the part that matters — swapping their bank
  // account, while the only real effect of suspension was exclusion from RFQ
  // matching. Deactivating the USER did cut access; suspending the SUPPLIER
  // did not, so the two "off switches" behaved differently.
  const s = await registerSeller();
  const adminTok = await adminToken();

  // Writes work while the application is still a draft. (The onboarding
  // service separately restricts profile edits to DRAFT/CHANGES_REQUESTED, so
  // this has to happen before submission.)
  const before = await api("/sellers/me/onboarding", {
    method: "PATCH", token: s.token, body: { legalName: "Before Suspension Ltd" },
  });
  assert.equal(before.status, 200, "a draft supplier can edit their profile");

  await completeMinimum(s.token);
  await api("/sellers/me/onboarding/submit", { method: "POST", token: s.token });
  await api(`/admin/sellers/${s.supplierId}/approve`, { method: "POST", token: adminTok });
  const susp = await api(`/admin/sellers/${s.supplierId}/suspend`, {
    method: "POST", token: adminTok, body: { reason: "Repeated quality failures" },
  });
  assert.equal(susp.status, 200, JSON.stringify(susp.body).slice(0, 160));

  // The write that actually costs money if it gets through.
  const bank = await api("/sellers/me/bank-accounts", {
    method: "POST", token: s.token,
    body: { accountHolderName: "Attacker", bankName: "X", accountNumber: "99999999", ifsc: "XXXX0000001" },
  });
  assert.equal(bank.status, 403, "a suspended supplier cannot change bank details");

  // Reads stay open on purpose: a suspended supplier must be able to sign in
  // and see WHY, otherwise the status is invisible to them.
  const read = await api("/sellers/me/onboarding", { token: s.token });
  assert.equal(read.status, 200, "a suspended supplier can still read their own record");
  assert.equal(read.body.data.status, "SUSPENDED", "and can see why they are blocked");

  // The refused bank write left no row behind.
  const banks = read.body.data.bankAccounts ?? [];
  assert.ok(
    !banks.some((b) => b.accountHolderName === "Attacker"),
    "the refused bank account was not created",
  );
});
