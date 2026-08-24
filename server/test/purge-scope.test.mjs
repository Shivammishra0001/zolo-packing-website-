// The purge script must never touch a real account.
//
// This exists because of a live incident: Prisma's `startsWith` compiles to SQL
// LIKE, where `_` is a single-character wildcard. A filter of
// `startsWith: "admin_"` therefore ALSO matched `admin@zolo.com` (the `@`
// satisfied the `_`) and deleted the real administrator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Mirror of the patterns in scripts/purge-test-data.mjs.
const TEST_EMAIL_PATTERNS = [
  /^test_[a-z0-9]+@example\.com$/i,
  /^admin_[a-z0-9]+@zolo\.com$/i,
  /^buyer_[a-z0-9]+@x\.com$/i,
  /^seller_[a-z0-9]+@x\.com$/i,
];
const isTestEmail = (email) => TEST_EMAIL_PATTERNS.some((re) => re.test(email));

test("real accounts are never classified as test data", () => {
  for (const email of [
    "admin@zolo.com",             // the exact address the wildcard bug destroyed
    "admin@zolopackaging.com",
    "superadmin@zolopackaging.com",
    "tempadmin@zolopackaging.com",
    "parth@gmail.com",
    "bhupendra.mishra@gmail.com",
    "admin.ops@zolo.com",
    "adminx@zolo.com",
    "buyer@x.com",
    "test@example.com",           // no underscore — a real address, not a fixture
  ]) {
    assert.equal(isTestEmail(email), false, `"${email}" must NOT be treated as test data`);
  }
});

test("generated test identities are still matched", () => {
  for (const email of [
    "test_ab12cd@example.com",
    "admin_9xk2p1@zolo.com",
    "buyer_6j1cjmb1csi@x.com",
    "seller_abc123@x.com",
  ]) {
    assert.equal(isTestEmail(email), true, `"${email}" must be treated as test data`);
  }
});

test("the purge script does not use startsWith on an underscore-suffixed prefix", () => {
  const src = readFileSync(new URL("../scripts/purge-test-data.mjs", import.meta.url), "utf8");
  // Strip comments first — the file documents the hazard in prose, and that
  // explanation must not itself trip the check.
  const code = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const offenders = [...code.matchAll(/startsWith:\s*"([^"]*_)"/g)].map((m) => m[1]);
  assert.deepEqual(
    offenders,
    [],
    `startsWith with a trailing "_" treats it as a LIKE wildcard: ${offenders.join(", ")}`,
  );
});
