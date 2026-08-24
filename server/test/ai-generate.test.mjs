// AI product generation tests — analyzer (pure) + generation flow (API).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { analyzeByFilename, isNonProductImage, skuFromFilename, skuCodeForCategory } from "../src/services/ai-analyzer.mjs";
import { startServer, stopServer, api, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

// ---- Pure analyzer ----
test("descriptive filename yields a confident product (no invented specs)", () => {
  const a = analyzeByFilename("kraft mailer box.png", { knownCategories: [] });
  assert.equal(a.status, "ANALYZED");
  assert.equal(a.category, "Mailer Boxes");
  assert.equal(a.material, "Kraft Board");
  assert.ok(a.confidence.overall >= 80);
  assert.ok(a.tags.length > 0);
  // specs that can't be known from a name are NOT invented
  assert.equal(a.unknown.dimensions, "Not specified");
  assert.equal(a.unknown.gsm, "Not specified");
});

test("opaque filename → REVIEW_REQUIRED, no fabricated data", () => {
  const a = analyzeByFilename("PRD-001.jpg", { knownCategories: [] });
  assert.equal(a.status, "REVIEW_REQUIRED");
  assert.equal(a.name, null);
  assert.equal(a.category, null);
  assert.ok(a.confidence.overall < 50);
  assert.ok(a.reviewReason);
});

test("category not in taxonomy is flagged isNewCategory", () => {
  const known = analyzeByFilename("glass jar.png", { knownCategories: ["Jars"] });
  assert.equal(known.isNewCategory, false);
  const unknown = analyzeByFilename("glass jar.png", { knownCategories: ["Boxes"] });
  assert.equal(unknown.isNewCategory, true);
});

test("UI assets are excluded; SKU parsed from filename when present", () => {
  assert.equal(isNonProductImage("category_food.png"), true);
  assert.equal(isNonProductImage("logo.png"), true);
  assert.equal(isNonProductImage("glass jar.png"), false);
  assert.equal(skuFromFilename("ZOLO-PIZ-001.jpg"), "ZOLO-PIZ-001");
  assert.equal(skuFromFilename("glass jar.png"), null);
  assert.equal(skuCodeForCategory("Jars"), "JAR");
});

// ---- Generation flow (API) ----
// SKUs this file creates, recorded as they are approved. Cleanup deletes ONLY
// these. It previously ran deleteMany({ sku: { startsWith: "ZOLO-" } }), which
// hard-deleted the entire imported ZOLO catalog on every `npm test` run —
// products the suite never created and had no business touching.
const createdSkus = [];

before(startServer);
after(async () => {
  await prisma.productAiAnalysis.updateMany({ data: { productId: null } });
  if (createdSkus.length) {
    await prisma.product.deleteMany({ where: { sku: { in: createdSkus } } });
  }
  await prisma.productAiAnalysis.deleteMany({});
  await stopServer();
});

test("scan → analyze → approve creates a DRAFT product (never published)", async () => {
  const token = await adminToken();

  // scan finds product images
  const scan = await api("/admin/ai/images", { token });
  assert.equal(scan.status, 200);
  assert.ok(scan.body.data.images.length > 0);
  const jar = scan.body.data.images.find((i) => i.filename === "glass jar.png");
  assert.ok(jar, "expected glass jar.png in the repo images");

  // analyze it
  const analyzed = await api("/admin/ai/analyze", { method: "POST", token, body: { filenames: ["glass jar.png"] } });
  assert.equal(analyzed.status, 200);
  const row = analyzed.body.data.analyses.find((a) => a.sourceName === "glass jar.png");
  assert.equal(row.status, "ANALYZED");

  // re-analyze → cached (no duplicate row)
  const before = await prisma.productAiAnalysis.count();
  await api("/admin/ai/analyze", { method: "POST", token, body: { filenames: ["glass jar.png"] } });
  const afterCount = await prisma.productAiAnalysis.count();
  assert.equal(before, afterCount, "identical image is not re-analyzed (cache)");

  // approve → DRAFT product
  const approved = await api(`/admin/ai/analyses/${row.id}/approve`, { method: "POST", token, body: {} });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.data.product.status, "draft", "AI products must be DRAFT");
  assert.match(approved.body.data.sku, /^ZOLO-JAR-\d{3}$/);
  createdSkus.push(approved.body.data.sku);
});

test("approving a REVIEW_REQUIRED item requires a name; override allows it", async () => {
  const token = await adminToken();
  await api("/admin/ai/analyze", { method: "POST", token, body: { filenames: ["PRD-001.jpg"] } });
  const list = await api("/admin/ai/analyses", { token });
  const prd = list.body.data.analyses.find((a) => a.sourceName === "PRD-001.jpg");
  assert.equal(prd.status, "REVIEW_REQUIRED");

  const noName = await api(`/admin/ai/analyses/${prd.id}/approve`, { method: "POST", token, body: {} });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.code, "NAME_REQUIRED");

  const withName = await api(`/admin/ai/analyses/${prd.id}/approve`, { method: "POST", token, body: { overrides: { name: "Mystery Box", category: "Retail Packaging" } } });
  assert.equal(withName.status, 201);
  assert.equal(withName.body.data.product.status, "draft");
  createdSkus.push(withName.body.data.product.sku);
});

test("non-admin cannot access AI generation endpoints", async () => {
  const reg = await api("/auth/register", { method: "POST", body: { email: `buyer_${Math.random().toString(36).slice(2)}@x.com`, password: "Passw0rd1", firstName: "B", accountType: "buyer" } });
  const buyerToken = reg.body.data.accessToken;
  const res = await api("/admin/ai/images", { token: buyerToken });
  assert.equal(res.status, 403);
});
