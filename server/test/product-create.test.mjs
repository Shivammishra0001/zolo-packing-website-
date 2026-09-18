// Individual product create / edit (the admin "Add product" form) — the REAL
// chain: POST /products (admin bearer) → PostgreSQL row + Category FK +
// stored image files, in one transaction → GET /products → storefront.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer, stopServer, api, apiRaw, adminToken, registerBuyer, fetchUpload } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { UPLOADS_PATH } from "../src/lib/storage.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const createdSkus = [];
const sku = (tag) => { const s = `ZOLO-TEST-${tag}-${rnd()}`; createdSkus.push(s); return s; };

// Real 1x1 PNG / JPEG / WebP (valid magic bytes).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const WEBP_B64 = "UklGRiYAAABXRUJQVlA4IBoAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=";

let ADMIN; let CATEGORY;
before(async () => {
  await startServer();
  ADMIN = await adminToken();
  // An existing DB category (created via the real categories API if none).
  const cats = await api("/categories");
  CATEGORY = cats.body.data.tree.find((c) => c.isActive) ?? null;
  if (!CATEGORY) {
    await api("/categories", { method: "POST", token: ADMIN, body: { name: "Boxes" } });
    CATEGORY = (await api("/categories")).body.data.tree[0];
  }
});
after(async () => {
  if (createdSkus.length) await prisma.product.deleteMany({ where: { sku: { in: createdSkus } } });
  await stopServer();
});

const fileOf = (url) => join(UPLOADS_PATH, String(url).split("/").pop());

test("creating a product requires an admin (401 anonymous, 403 customer)", async () => {
  const body = { name: "Test Packaging Box", sku: sku("AUTH"), categoryId: CATEGORY.id, basePriceMinor: 2500, moq: 100 };
  assert.equal((await api("/products", { method: "POST", body })).status, 401);
  const buyer = await registerBuyer();
  assert.equal((await api("/products", { method: "POST", token: buyer.token, body })).status, 403);
  assert.equal((await api("/uploads", { method: "POST", token: buyer.token, body: { mime: "image/png", dataBase64: PNG_B64 } })).status, 403);
  assert.equal((await api("/categories", { method: "POST", token: buyer.token, body: { name: "Nope" } })).status, 403);
});

test("the spec product: fields, category FK, three real images, ledger, audit — then visible everywhere", async () => {
  const s = sku("001");
  const res = await api("/products", { method: "POST", token: ADMIN, body: {
    id: "PRD-CLIENT-SUPPLIED", // must be ignored
    name: "Test Packaging Box", sku: s, categoryId: CATEGORY.id,
    description: "E2E product", length: 10, width: 8, height: 4, dimUnit: "cm",
    gsm: 350, material: "Kraft", productType: "Mailer box", color: "Natural Kraft",
    basePriceMinor: 4500, moq: 100, stock: 500, lowStockLevel: 50, status: "active",
    images: ["upload:0", "upload:1", "upload:2"],
    imageUploads: [
      { name: "front.png", mime: "image/png", dataBase64: PNG_B64 },
      { name: "side.jpg", mime: "image/jpeg", dataBase64: JPG_B64 },
      { name: "top.webp", mime: "image/webp", dataBase64: WEBP_B64 },
    ],
  } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data.product;
  assert.match(p.id, /^PRD-\d{4,}$/, "server-generated id");
  assert.notEqual(p.id, "PRD-CLIENT-SUPPLIED");
  assert.equal(p.sku, s);
  assert.equal(p.categoryId, CATEGORY.id, "category FK saved");
  assert.equal(p.category, CATEGORY.name);
  assert.equal(p.length, 10); assert.equal(p.width, 8); assert.equal(p.height, 4); assert.equal(p.dimUnit, "cm");
  assert.equal(p.material, "Kraft"); assert.equal(p.productType, "Mailer box");
  assert.equal(p.basePriceMinor, 4500); assert.equal(p.moq, 100); assert.equal(p.stock, 500); assert.equal(p.status, "active");
  assert.equal(p.images.length, 3, "three stored images");
  for (const url of p.images) {
    assert.match(url, /^https?:\/\/.*\/uploads\//, "persistent URL, not a blob");
    assert.ok(existsSync(fileOf(url)), "file exists on disk");
    assert.equal((await fetchUpload(url)).status, 200, "image is served");
  }
  assert.equal(p.imageEmoji, p.images[0], "primary = first image");

  // PostgreSQL row is the source of truth.
  const row = await prisma.product.findUnique({ where: { id: p.id }, include: { categoryRef: true, stockMovements: true } });
  assert.equal(row.categoryRef.id, CATEGORY.id);
  assert.deepEqual(row.images, p.images);
  assert.equal(row.stockMovements.length, 1, "opening stock recorded in the inventory ledger");
  assert.equal(row.stockMovements[0].balance, 500);
  const audit = await prisma.auditLog.findFirst({ where: { eventType: "product.created", entityId: p.id } });
  assert.ok(audit, "creation audited");

  // Appears in the catalog list (admin + storefront read the same endpoint).
  const list = await api("/products");
  const listed = list.body.data.products.find((x) => x.id === p.id);
  assert.ok(listed); assert.equal(listed.images.length, 3);
  // …and its category now counts it.
  const cats = await api("/categories");
  const cat = cats.body.data.tree.find((c) => c.id === CATEGORY.id);
  assert.ok(cat.productCount >= 1);
});

test("duplicate SKU is a clear 409, and nothing (row or image) is left behind", async () => {
  const s = sku("DUP");
  const first = await api("/products", { method: "POST", token: ADMIN, body: { name: "First", sku: s, categoryId: CATEGORY.id, basePriceMinor: 100, moq: 1 } });
  assert.equal(first.status, 201);
  const before = await prisma.product.count();
  const dup = await api("/products", { method: "POST", token: ADMIN, body: {
    name: "Second", sku: s.toLowerCase(), categoryId: CATEGORY.id, basePriceMinor: 100, moq: 1,
    images: ["upload:0"], imageUploads: [{ name: "x.png", mime: "image/png", dataBase64: PNG_B64 }],
  } });
  assert.equal(dup.status, 409, JSON.stringify(dup.body));
  assert.equal(dup.body.code, "SKU_EXISTS");
  assert.match(dup.body.error, /already exists/i);
  assert.equal(await prisma.product.count(), before, "no orphan product");
  const withSuffix = await prisma.product.findFirst({ where: { sku: `${s}-2` } });
  assert.equal(withSuffix, null, "never silently renamed");
});

test("validation is field-level and honest: bad category, bad image, partial dimensions, negatives", async () => {
  const base = { name: "Validation Box", sku: sku("VAL"), categoryId: CATEGORY.id, basePriceMinor: 100, moq: 1 };
  const badCat = await api("/products", { method: "POST", token: ADMIN, body: { ...base, categoryId: "does-not-exist" } });
  assert.equal(badCat.status, 400); assert.equal(badCat.body.code, "CATEGORY_NOT_FOUND");
  const noCat = await api("/products", { method: "POST", token: ADMIN, body: { ...base, categoryId: undefined } });
  assert.equal(noCat.status, 400); assert.equal(noCat.body.code, "CATEGORY_REQUIRED");
  const badImg = await api("/products", { method: "POST", token: ADMIN, body: { ...base, images: ["upload:0"], imageUploads: [{ name: "x.txt", mime: "text/plain", dataBase64: "aGVsbG8=" }] } });
  assert.equal(badImg.status, 400); assert.equal(badImg.body.code, "BAD_IMAGE_TYPE");
  const corrupt = await api("/products", { method: "POST", token: ADMIN, body: { ...base, images: ["upload:0"], imageUploads: [{ name: "x.png", mime: "image/png", dataBase64: Buffer.from("definitely not a png").toString("base64") }] } });
  assert.equal(corrupt.status, 400); assert.equal(corrupt.body.code, "CORRUPT_IMAGE");
  const blob = await api("/products", { method: "POST", token: ADMIN, body: { ...base, images: ["blob:http://localhost/abc"] } });
  assert.equal(blob.status, 400); assert.equal(blob.body.code, "IMAGE_NOT_UPLOADED");
  const partial = await api("/products", { method: "POST", token: ADMIN, body: { ...base, length: 10, width: 8 } });
  assert.equal(partial.status, 400); assert.equal(partial.body.code, "DIMENSIONS_PARTIAL");
  const neg = await api("/products", { method: "POST", token: ADMIN, body: { ...base, basePriceMinor: -5, moq: 0, stock: -1 } });
  assert.equal(neg.status, 400); assert.equal(neg.body.code, "VALIDATION");
  const paths = neg.body.issues.map((i) => i.path);
  assert.ok(paths.includes("basePriceMinor") && paths.includes("moq") && paths.includes("stock"), JSON.stringify(neg.body.issues));
  const short = await api("/products", { method: "POST", token: ADMIN, body: { ...base, name: "x" } });
  assert.equal(short.status, 400); assert.ok(short.body.issues.some((i) => i.path === "name"));
  // None of the above created a row.
  assert.equal(await prisma.product.count({ where: { sku: base.sku } }), 0);
});

test("edit: update fields, reorder/replace/remove images (old file cleaned), change category, status, stock", async () => {
  const s = sku("EDIT");
  const create = await api("/products", { method: "POST", token: ADMIN, body: {
    name: "Editable Box", sku: s, categoryId: CATEGORY.id, basePriceMinor: 1000, moq: 10, stock: 20, status: "draft",
    images: ["upload:0", "upload:1"], imageUploads: [{ name: "a.png", mime: "image/png", dataBase64: PNG_B64 }, { name: "b.jpg", mime: "image/jpeg", dataBase64: JPG_B64 }],
  } });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const p = create.body.data.product;
  const [imgA, imgB] = p.images;

  // A second category to move into (created via the real API).
  const newCatName = `Edit Cat ${rnd()}`;
  const cat2 = (await api("/categories", { method: "POST", token: ADMIN, body: { name: newCatName } })).body.data.category;

  // Reorder (B first), drop A, add a new one, change category/status/stock/price.
  const upd = await api(`/products/${p.id}`, { method: "PUT", token: ADMIN, body: {
    name: "Editable Box v2", categoryId: cat2.id, status: "active", stock: 35, basePriceMinor: 1200, material: "Corrugated",
    images: [imgB, "upload:0"], imageUploads: [{ name: "c.webp", mime: "image/webp", dataBase64: WEBP_B64 }],
  } });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const u = upd.body.data.product;
  assert.equal(u.name, "Editable Box v2");
  assert.equal(u.categoryId, cat2.id); assert.equal(u.category, newCatName);
  assert.equal(u.status, "active"); assert.equal(u.stock, 35); assert.equal(u.basePriceMinor, 1200); assert.equal(u.material, "Corrugated");
  assert.equal(u.images.length, 2);
  assert.equal(u.images[0], imgB, "reordered: B is primary");
  assert.equal(u.imageEmoji, imgB);
  assert.ok(!u.images.includes(imgA), "A removed");
  assert.equal(existsSync(fileOf(imgA)), false, "removed image file cleaned from storage");
  assert.ok(existsSync(fileOf(u.images[1])), "new image stored");
  const moves = await prisma.stockMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } });
  assert.equal(moves.at(-1).quantity, 15); assert.equal(moves.at(-1).balance, 35);

  // Renaming the SKU to one that exists is refused; to a free one works.
  const other = (await api("/products", { method: "POST", token: ADMIN, body: { name: "Other", sku: sku("OTH"), categoryId: CATEGORY.id, basePriceMinor: 1, moq: 1 } })).body.data.product;
  const clash = await api(`/products/${p.id}`, { method: "PUT", token: ADMIN, body: { sku: other.sku } });
  assert.equal(clash.status, 409);
  const free = sku("FREE");
  assert.equal((await api(`/products/${p.id}`, { method: "PUT", token: ADMIN, body: { sku: free } })).body.data.product.sku, free);

  // Archive / unarchive keeps the row and its images; stock status stays independent.
  const arch = await api(`/products/${p.id}`, { method: "PATCH", token: ADMIN, body: { status: "archived" } });
  assert.equal(arch.body.data.product.status, "archived"); assert.equal(arch.body.data.product.stock, 35);
  const un = await api(`/products/${p.id}`, { method: "PATCH", token: ADMIN, body: { status: "active" } });
  assert.equal(un.body.data.product.status, "active");
  const zero = await api(`/products/${p.id}`, { method: "PATCH", token: ADMIN, body: { stock: 0 } });
  assert.equal(zero.body.data.product.status, "active", "zero stock never archives a product");
  assert.equal((await api(`/products/${p.id}`, { method: "PUT", token: ADMIN, body: { moq: 0 } })).status, 400);
  assert.equal((await api("/products/PRD-NOPE", { method: "PUT", token: ADMIN, body: { name: "x" } })).status, 404);
  const audit = await prisma.auditLog.count({ where: { eventType: "product.updated", entityId: p.id } });
  assert.ok(audit >= 3);
  assert.equal((await apiRaw(`/products/${p.id}`, { method: "DELETE" })).status, 401, "delete is admin-only too");
});
