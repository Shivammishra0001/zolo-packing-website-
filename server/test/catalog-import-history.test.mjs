// Bulk catalog import history & audit (Phases 14/16/19).
//
// Every import run must leave an auditable record with correct outcome counts
// and per-row errors, readable through the admin history endpoints — the audit
// trail the console-only importer never persisted.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, unique } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const sku = () => `HIST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

test("a successful import is recorded and readable via admin history", async () => {
  const s1 = sku(), s2 = sku();
  const res = await api("/products/import", { method: "POST", body: {
    fileName: "catalog.xlsx",
    mode: "create",
    products: [
      { sku: s1, name: "Import History Box A", category: "Boxes", moq: 100 },
      { sku: s2, name: "Import History Box B", category: "Boxes", moq: 200 },
    ],
  } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.data.importId, "import returns an importId");
  assert.equal(res.body.data.created, 2);

  const admin = await adminToken();
  const detail = await api(`/admin/catalog/imports/${res.body.data.importId}`, { token: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.fileName, "catalog.xlsx");
  assert.equal(detail.body.data.mode, "create");
  assert.equal(detail.body.data.status, "COMPLETED");
  assert.equal(detail.body.data.created, 2);
  assert.equal(detail.body.data.failed, 0);

  // It appears in the history list, newest first.
  const list = await api("/admin/catalog/imports?take=5", { token: admin });
  assert.equal(list.status, 200);
  assert.ok(list.body.data.imports.some((i) => i.id === res.body.data.importId));
});

test("a partial failure is recorded as COMPLETED_WITH_ERRORS with row errors", async () => {
  const good = sku();
  const res = await api("/products/import", { method: "POST", body: {
    mode: "create",
    products: [
      { sku: good, name: "Good Row", category: "Boxes" },
      { name: "Missing SKU Row", category: "Boxes" }, // importer fails a row with no sku
    ],
  } });
  assert.equal(res.status, 200);

  const admin = await adminToken();
  const detail = await api(`/admin/catalog/imports/${res.body.data.importId}`, { token: admin });
  assert.equal(detail.body.data.status, "COMPLETED_WITH_ERRORS");
  assert.ok(detail.body.data.failed >= 1, "at least one row failed");
  assert.ok(detail.body.data.errors.length >= 1, "row-level errors are persisted");
  assert.ok(detail.body.data.errors.some((e) => e.level === "error"));
});

test("import history is admin-only", async () => {
  assert.equal((await api("/admin/catalog/imports")).status, 401);
  // A buyer token is rejected by requireAdmin.
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "B", accountType: "buyer" } });
  assert.equal((await api("/admin/catalog/imports", { token: reg.body.data.accessToken })).status, 403);
});

test("a missing import id 404s", async () => {
  const admin = await adminToken();
  assert.equal((await api("/admin/catalog/imports/nope-nope", { token: admin })).status, 404);
});

test("import records the uploaded file size (shown in Import History)", async () => {
  const res = await api("/products/import", { method: "POST", body: {
    fileName: "big-catalog.zip",
    fileSizeBytes: 327 * 1024 * 1024, // 327 MB
    mode: "create",
    products: [{ sku: sku(), name: "Sized Import Box", category: "Boxes" }],
  } });
  assert.equal(res.status, 200);
  const admin = await adminToken();
  const detail = await api(`/admin/catalog/imports/${res.body.data.importId}`, { token: admin });
  assert.equal(detail.body.data.fileSizeBytes, 327 * 1024 * 1024);
  const list = await api("/admin/catalog/imports", { token: admin });
  const row = list.body.data.imports.find((i) => i.id === res.body.data.importId);
  assert.equal(row.fileSizeBytes, 327 * 1024 * 1024);
});

test("the error handler maps an oversized body to HTTP 413", async () => {
  const { errorHandler } = await import("../src/lib/http.mjs");
  let status = 0, payload = null;
  const res = { status(s) { status = s; return this; }, json(p) { payload = p; return this; } };
  errorHandler({ type: "entity.too.large" }, {}, res, () => {});
  assert.equal(status, 413);
  assert.equal(payload.code, "PAYLOAD_TOO_LARGE");
});
