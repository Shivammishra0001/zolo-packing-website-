// Catalog import / image / delete integration tests (real PostgreSQL).
// Run: npm test  (from server/)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const created = [];
const createdCats = [];

const sku = (tag) => {
  const s = `TST-${tag}-${rnd()}`;
  created.push(s);
  return s;
};

// A 1x1 PNG — valid magic bytes, so it survives image integrity validation.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

before(async () => { await startServer(); });

after(async () => {
  // Only ever remove rows this file created.
  if (created.length) await prisma.product.deleteMany({ where: { sku: { in: created } } });
  if (createdCats.length) await prisma.category.deleteMany({ where: { name: { in: createdCats } } });
  await stopServer();
});

test("import creates products and auto-creates the category", async () => {
  const cat = `Test Cat ${rnd()}`;
  createdCats.push(cat);
  const s = sku("A");
  const { status, body } = await api("/products/import", {
    method: "POST",
    body: { products: [{ sku: s, name: "Imported Box", category: cat, gsm: 350, moq: 100 }], mode: "update" },
  });
  assert.equal(status, 200);
  assert.equal(body.data.created, 1);
  assert.equal(body.data.failed, 0);

  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(row.name, "Imported Box");
  assert.equal(row.gsm, 350);
  assert.ok(row.categoryId, "product is linked to a Category row");
});

test("category matching is case-insensitive — no duplicate categories", async () => {
  const cat = `Dupe Cat ${rnd()}`;
  createdCats.push(cat);
  const [a, b, c] = [sku("C1"), sku("C2"), sku("C3")];
  await api("/products/import", {
    method: "POST",
    body: {
      products: [
        { sku: a, name: "P1", category: cat },
        { sku: b, name: "P2", category: cat.toUpperCase() },
        { sku: c, name: "P3", category: `  ${cat.toLowerCase()}  ` },
      ],
      mode: "update",
    },
  });
  const cats = await prisma.category.findMany({ where: { name: { equals: cat, mode: "insensitive" } } });
  assert.equal(cats.length, 1, "Boxes/boxes/BOXES collapse to one category");

  const prods = await prisma.product.findMany({ where: { sku: { in: [a, b, c] } } });
  assert.equal(new Set(prods.map((p) => p.categoryId)).size, 1, "all three share one categoryId");
});

test("gsm omitted stays NULL — never coerced to 0", async () => {
  const s = sku("N");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "No GSM", category: "Boxes" }], mode: "update" } });
  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(row.gsm, null);
});

test("one bad row does not prevent the good rows from importing", async () => {
  const good1 = sku("G1"), good2 = sku("G2");
  const { body } = await api("/products/import", {
    method: "POST",
    body: {
      products: [
        { sku: good1, name: "Good One", category: "Boxes" },
        { sku: "", name: "Bad — no SKU", category: "Boxes" },
        { sku: good2, name: "Good Two", category: "Boxes" },
      ],
      mode: "update",
    },
  });
  assert.equal(body.data.created, 2);
  assert.equal(body.data.failed, 1);
  assert.equal(body.data.errors.length, 1);
  assert.ok(await prisma.product.findUnique({ where: { sku: good1 } }));
  assert.ok(await prisma.product.findUnique({ where: { sku: good2 } }));
});

test("duplicate SKU: skip leaves the original untouched", async () => {
  const s = sku("SK");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Original", category: "Boxes" }], mode: "update" } });
  const { body } = await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Replacement", category: "Boxes" }], mode: "skip" } });
  assert.equal(body.data.skipped, 1);
  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(row.name, "Original");
});

test("duplicate SKU: update merges into the existing product", async () => {
  const s = sku("UP");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Before", category: "Boxes" }], mode: "update" } });
  const { body } = await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "After", category: "Boxes", gsm: 250 }], mode: "update" } });
  assert.equal(body.data.updated, 1);
  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(row.name, "After");
  assert.equal(row.gsm, 250);
});

test("duplicate SKU: create makes a new suffixed SKU, never overwriting", async () => {
  const s = sku("CR");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "First", category: "Boxes" }], mode: "update" } });
  const { body } = await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Second", category: "Boxes" }], mode: "create" } });
  assert.equal(body.data.created, 1);
  created.push(`${s}-2`);
  const original = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(original.name, "First", "original is untouched");
  assert.ok(await prisma.product.findUnique({ where: { sku: `${s}-2` } }), "new row got a suffixed SKU");
});

test("update with no image does NOT erase an existing image", async () => {
  const s = sku("IMG");
  await api("/products/import", {
    method: "POST",
    body: { products: [{ sku: s, name: "Has Image", category: "Boxes", images: ["http://example.com/a.jpg"] }], mode: "update" },
  });
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Has Image", category: "Boxes" }], mode: "update" } });
  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.deepEqual(row.images, ["http://example.com/a.jpg"], "existing image survives an imageless re-import");
});

test("single image upload attaches to the product and returns a URL", async () => {
  const s = sku("UPL");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Needs Image", category: "Boxes" }], mode: "update" } });
  const product = await prisma.product.findUnique({ where: { sku: s } });

  const { status, body } = await api(`/products/${product.id}/image`, {
    method: "POST",
    body: { name: "shot.png", mime: "image/png", dataBase64: PNG_B64 },
  });
  assert.equal(status, 201);
  assert.match(body.data.url, /\/uploads\//);
  assert.equal(body.data.product.images[0], body.data.url);
  assert.equal(body.data.product.imageEmoji, body.data.url);
});

test("corrupt or mistyped image files are rejected", async () => {
  const s = sku("BAD");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "P", category: "Boxes" }], mode: "update" } });
  const product = await prisma.product.findUnique({ where: { sku: s } });

  // Claims PNG, but the bytes are plain text.
  const bogus = Buffer.from("this is definitely not a png").toString("base64");
  const { status } = await api(`/products/${product.id}/image`, {
    method: "POST",
    body: { name: "evil.png", mime: "image/png", dataBase64: bogus },
  });
  assert.equal(status, 400);

  const { status: badType } = await api(`/products/${product.id}/image`, {
    method: "POST",
    body: { name: "clip.mp4", mime: "video/mp4", dataBase64: PNG_B64 },
  });
  assert.equal(badType, 400);
});

test("bulk image upload matches by SKU and reports unmatched", async () => {
  const s = sku("BLK");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "Bulk Target", category: "Boxes" }], mode: "update" } });

  const { status, body } = await api("/products/images/bulk", {
    method: "POST",
    body: {
      images: [
        { sku: s, name: `${s}.png`, mime: "image/png", dataBase64: PNG_B64 },
        { sku: "TST-DOES-NOT-EXIST", name: "x.png", mime: "image/png", dataBase64: PNG_B64 },
      ],
    },
  });
  assert.equal(status, 200);
  assert.equal(body.data.matched, 1);
  assert.equal(body.data.unmatched, 1);

  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.match(row.images[0], /\/uploads\//);
});

test("delete is a SOFT delete and hides the product from listings", async () => {
  const s = sku("DEL");
  await api("/products/import", { method: "POST", body: { products: [{ sku: s, name: "To Delete", category: "Boxes" }], mode: "update" } });
  const product = await prisma.product.findUnique({ where: { sku: s } });

  const { status } = await api(`/products/${product.id}`, { method: "DELETE" });
  assert.equal(status, 200);

  const row = await prisma.product.findUnique({ where: { sku: s } });
  assert.ok(row, "row still exists (order history depends on it)");
  assert.ok(row.deletedAt, "deletedAt is stamped");
  assert.equal(row.status, "archived");

  const { body: list } = await api("/products");
  assert.ok(!list.data.products.some((p) => p.sku === s), "soft-deleted product is not listed");
});

test("bulk delete soft-deletes every selected product", async () => {
  const a = sku("BD1"), b = sku("BD2");
  await api("/products/import", { method: "POST", body: { products: [{ sku: a, name: "A", category: "Boxes" }, { sku: b, name: "B", category: "Boxes" }], mode: "update" } });
  const rows = await prisma.product.findMany({ where: { sku: { in: [a, b] } } });

  const { status, body } = await api("/products/bulk-delete", { method: "POST", body: { ids: rows.map((r) => r.id) } });
  assert.equal(status, 200);
  assert.equal(body.data.deleted, 2);

  const after = await prisma.product.findMany({ where: { sku: { in: [a, b] } } });
  assert.equal(after.filter((r) => r.deletedAt).length, 2);
});

test("an unknown duplicate mode is rejected", async () => {
  const { status } = await api("/products/import", { method: "POST", body: { products: [], mode: "obliterate" } });
  assert.equal(status, 400);
});

// ============================================================
// Regression: concurrent category creation.
//
// resolveCategory() used to find-then-create with no protection. Under
// parallel imports two callers could both miss, both insert, and produce a
// duplicate category — while the losers threw P2002 and killed their product
// rows. slug (the only UNIQUE column) is now derived deterministically from
// the normalized name, and P2002 is recovered by re-reading the winner.
// ============================================================

test("concurrent imports of the same new category create exactly one row", async () => {
  const cat = `Race Cat ${rnd()}`;
  createdCats.push(cat);
  const skus = Array.from({ length: 6 }, (_, i) => sku(`RC${i}`));

  // Six separate import calls (separate category caches) racing on one name.
  const results = await Promise.all(
    skus.map((s) => api("/products/import", {
      method: "POST",
      body: { products: [{ sku: s, name: `Race ${s}`, category: cat }], mode: "update" },
    })),
  );

  for (const r of results) {
    assert.equal(r.status, 200);
    assert.equal(r.body.data.failed, 0, "no product may be lost to a category race");
  }

  const cats = await prisma.category.findMany({ where: { name: { equals: cat, mode: "insensitive" } } });
  assert.equal(cats.length, 1, "exactly one category row despite 6 concurrent creators");

  const prods = await prisma.product.findMany({ where: { sku: { in: skus } } });
  assert.equal(prods.length, 6, "every product saved");
  assert.equal(new Set(prods.map((p) => p.categoryId)).size, 1, "all share the one category");
});

test("category name variants collapse to one row across separate requests", async () => {
  const base = `Variant Cat ${rnd()}`;
  createdCats.push(base);
  const variants = [base, base.toUpperCase(), base.toLowerCase(), `  ${base}  `];
  const skus = variants.map((_, i) => sku(`VC${i}`));

  for (let i = 0; i < variants.length; i++) {
    await api("/products/import", {
      method: "POST",
      body: { products: [{ sku: skus[i], name: "V", category: variants[i] }], mode: "update" },
    });
  }
  const cats = await prisma.category.findMany({ where: { name: { equals: base, mode: "insensitive" } } });
  assert.equal(cats.length, 1, "Boxes / boxes / BOXES / ' Boxes ' are one category");
});

test("public health needs no auth and reports the service", async () => {
  const { status, body } = await api("/public/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "zolo-packing-api");
});

test("readiness probe confirms the database is reachable", async () => {
  const { status, body } = await api("/public/ready");
  assert.equal(status, 200);
  assert.equal(body.db, "up");
});

// ============================================================
// Taxonomy: subcategories are REAL Category rows nested under their parent —
// not a denormalized string. Previously nothing created them, so Admin showed
// "Categories = 0" and the edit form's dropdown was blank.
// ============================================================

test("import creates a subcategory nested under its parent category", async () => {
  const cat = `Tax Cat ${rnd()}`;
  createdCats.push(cat, "Tax Sub");
  const s = sku("TX");
  await api("/products/import", { method: "POST", body: {
    products: [{ SKU: s, "Product Name": "Taxed", Category: cat, Subcategory: "Tax Sub" }], mode: "update" } });

  const product = await prisma.product.findUnique({ where: { sku: s } });
  assert.ok(product.categoryId, "linked to a category");
  assert.ok(product.subcategoryId, "linked to a SUBcategory record");

  const sub = await prisma.category.findUnique({ where: { id: product.subcategoryId } });
  assert.equal(sub.parentId, product.categoryId, "the subcategory hangs off its parent");
  assert.equal(sub.name, "Tax Sub");
});

test("the same subcategory name under one parent is reused, not duplicated", async () => {
  const cat = `Reuse Cat ${rnd()}`;
  createdCats.push(cat, "Shared Sub");
  const [a, b] = [sku("R1"), sku("R2")];
  await api("/products/import", { method: "POST", body: { products: [
    { SKU: a, "Product Name": "A", Category: cat, Subcategory: "Shared Sub" },
    { SKU: b, "Product Name": "B", Category: cat, Subcategory: "  SHARED SUB  " },
  ], mode: "update" } });

  const rows = await prisma.product.findMany({ where: { sku: { in: [a, b] } } });
  assert.equal(new Set(rows.map((r) => r.subcategoryId)).size, 1, "case/whitespace variants are one row");
});

test("'General' never becomes a subcategory record", async () => {
  const cat = `Gen Cat ${rnd()}`;
  createdCats.push(cat);
  const s = sku("GN");
  await api("/products/import", { method: "POST", body: {
    products: [{ SKU: s, "Product Name": "G", Category: cat, Subcategory: "General" }], mode: "update" } });
  const product = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(product.subcategoryId, null, "the placeholder is not a taxonomy node");
});

test("Size becomes dimensions only when it is a real 3-axis measurement", async () => {
  const [a, b] = [sku("D1"), sku("D2")];
  await api("/products/import", { method: "POST", body: { products: [
    { SKU: a, "Product Name": "Box", Category: "Boxes", Size: "12 x 4 x 4 inch" },
    { SKU: b, "Product Name": "Cup", Category: "Boxes", Size: "12 oz" },
  ], mode: "update" } });

  const box = await prisma.product.findUnique({ where: { sku: a } });
  assert.equal(box.length, 12); assert.equal(box.width, 4); assert.equal(box.height, 4);
  assert.equal(box.dimUnit, "in");
  assert.equal(box.sizeLabel, "12 x 4 x 4 inch");

  const cup = await prisma.product.findUnique({ where: { sku: b } });
  assert.equal(cup.length, null, "a capacity must never be written as a length");
  assert.equal(cup.sizeLabel, "12 oz", "but it IS preserved");
});

test("re-importing the same rows creates no duplicate products or categories", async () => {
  const cat = `Idem Cat ${rnd()}`;
  createdCats.push(cat, "Idem Sub");
  const s = sku("ID");
  const rows = [{ SKU: s, "Product Name": "Idem", Category: cat, Subcategory: "Idem Sub", GSM: "300" }];

  const first = await api("/products/import", { method: "POST", body: { products: rows, mode: "update" } });
  assert.equal(first.body.data.created, 1);

  const second = await api("/products/import", { method: "POST", body: { products: rows, mode: "update" } });
  assert.equal(second.body.data.created, 0, "no duplicate product");
  assert.equal(second.body.data.updated, 1);
  assert.equal(second.body.data.subcategoriesCreated, 0, "no duplicate subcategory");

  const cats = await prisma.category.findMany({ where: { name: { in: [cat, "Idem Sub"] } } });
  assert.equal(cats.filter((c) => c.name === cat).length, 1);
});

test("editing a product's category re-links BOTH foreign keys", async () => {
  const catA = `Move A ${rnd()}`, catB = `Move B ${rnd()}`;
  createdCats.push(catA, catB, "Sub A", "Sub B");
  const s = sku("MV");
  await api("/products/import", { method: "POST", body: {
    products: [{ SKU: s, "Product Name": "Mover", Category: catA, Subcategory: "Sub A" }], mode: "update" } });
  const before = await prisma.product.findUnique({ where: { sku: s } });

  await api(`/products/${before.id}`, { method: "PATCH", body: { category: catB, subcategory: "Sub B" } });

  const after = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(after.category, catB);
  assert.equal(after.subcategory, "Sub B");
  assert.notEqual(after.categoryId, before.categoryId, "categoryId moved too");
  assert.ok(after.subcategoryId && after.subcategoryId !== before.subcategoryId);
});

test("the categories endpoint returns a tree with real product counts", async () => {
  const cat = `Tree Cat ${rnd()}`;
  createdCats.push(cat, "Tree Sub");
  const s = sku("TR");
  await api("/products/import", { method: "POST", body: {
    products: [{ SKU: s, "Product Name": "T", Category: cat, Subcategory: "Tree Sub", Status: "active" }], mode: "update" } });

  const { status, body } = await api("/categories");
  assert.equal(status, 200);
  const node = body.data.tree.find((c) => c.name === cat);
  assert.ok(node, "the new category appears in the tree");
  assert.equal(node.productCount, 1, "count comes from the database");
  assert.equal(node.subcategories[0].name, "Tree Sub");
  assert.equal(node.subcategories[0].productCount, 1);
});

test("import reports real per-run taxonomy and failure accounting", async () => {
  const cat = `Acct Cat ${rnd()}`;
  createdCats.push(cat, "Acct Sub");
  const { body } = await api("/products/import", { method: "POST", body: { products: [
    { SKU: sku("AC"), "Product Name": "Good", Category: cat, Subcategory: "Acct Sub" },
    { SKU: "", "Product Name": "Bad — no SKU", Category: cat },
  ], mode: "update" } });

  assert.equal(body.data.created, 1);
  assert.equal(body.data.failed, 1);
  assert.equal(body.data.success, false, "must NOT report success when a row failed");
  assert.ok(body.data.categoriesCreated + body.data.subcategoriesCreated >= 1);
});

test("deactivating a category is a soft delete that reports usage", async () => {
  const cat = `Del Cat ${rnd()}`;
  createdCats.push(cat);
  const s = sku("DC");
  await api("/products/import", { method: "POST", body: {
    products: [{ SKU: s, "Product Name": "D", Category: cat }], mode: "update" } });
  const product = await prisma.product.findUnique({ where: { sku: s } });

  const res = await api(`/categories/${product.categoryId}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.productsAffected, 1, "reports what still references it");

  const row = await prisma.category.findUnique({ where: { id: product.categoryId } });
  assert.ok(row, "the row survives — order history still resolves");
  assert.equal(row.isActive, false);

  // The product keeps its link rather than being orphaned.
  const after = await prisma.product.findUnique({ where: { sku: s } });
  assert.equal(after.categoryId, product.categoryId);
});
