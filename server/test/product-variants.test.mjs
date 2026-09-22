// Product variants: simple vs variable products, the variant matrix, per-variant
// SKU / price / stock / MOQ / image, cart + checkout on a variant, order
// snapshots, the v2 importer (grouped rows → one product, all-or-nothing) and
// legacy products staying untouched.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerBuyer, makeAddress } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 7).toUpperCase();
let ADMIN; let CAT; let SUB;
const skus = [];
const sku = (t) => { const s = `ZOLO-TEST-VAR-${t}-${rnd()}`; skus.push(s); return s; };

const IMPORT_NAMES = ["Imported Corrugated Box", "Imported Kraft Tape", "Would be fine", "Steals a sku", "Blocked", "New cat"];
const cleanup = () => prisma.product.deleteMany({ where: { OR: [{ sku: { startsWith: "ZOLO-TEST-VAR-" } }, { sku: { in: skus } }, { name: { in: IMPORT_NAMES } }] } });

before(async () => {
  await startServer(); ADMIN = await adminToken();
  await cleanup();
  const name = `Var Boxes ${rnd()}`;
  CAT = (await api("/categories", { method: "POST", token: ADMIN, body: { name } })).body.data.category;
  SUB = (await api("/categories", { method: "POST", token: ADMIN, body: { name: "5 Ply", parentId: CAT.id } })).body.data.category;
});
after(async () => {
  await cleanup();
  await prisma.category.deleteMany({ where: { id: { in: [SUB.id, CAT.id] } } });
  await stopServer();
});

const admin = (path, opt = {}) => api(path, { token: ADMIN, ...opt });
const create = (body) => admin("/products", { method: "POST", body: { categoryId: CAT.id, subcategoryId: SUB.id, status: "active", ...body } });
const SIZE_COLOR = [{ name: "Size", values: ["6x6x4", "8x8x6"] }, { name: "Color", values: ["Kraft Brown", "White"] }];
const matrix = (opts, price = 2500) => {
  const [a, b] = opts;
  return a.values.flatMap((s) => (b ? b.values : [null]).map((c) => ({ attributes: b ? { [a.name]: s, [b.name]: c } : { [a.name]: s }, priceMinor: price, stock: 100, moq: 10 })));
};

test("simple product: unchanged path — sku/price/stock on the product, kind=simple, no variant rows", async () => {
  const res = await create({ name: "Brown Kraft Paper Tape", sku: sku("TAPE"), basePriceMinor: 12000, moq: 1, stock: 50, color: "Brown" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data.product;
  assert.equal(p.kind, "simple"); assert.equal(p.hasVariants, false); assert.deepEqual(p.variants, []);
  assert.equal(p.basePriceMinor, 12000);
  const got = await api(`/products/${p.id}`);
  assert.equal(got.status, 200); assert.equal(got.body.data.product.kind, "simple");
  assert.equal(got.body.data.product.costMinor, undefined, "internal fields hidden from the public");
});

test("variable product: 2 sizes × 2 colors → 4 variants with generated SKUs, own price/stock/moq; parent roll-ups; public shape", async () => {
  const base = sku("BOX");
  const variants = matrix(SIZE_COLOR);
  variants[0].priceMinor = 2500; variants[1].priceMinor = 2800; variants[2].priceMinor = 3200; variants[3].priceMinor = 3500;
  variants[3].stock = 0; variants[2].moq = 50;
  const res = await create({ name: "Corrugated Shipping Box", sku: base, kind: "variable", variantOptions: SIZE_COLOR, variants, material: "Kraft Paper", gsm: 120 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const p = res.body.data.product;
  assert.equal(p.kind, "variable"); assert.equal(p.variants.length, 4);
  assert.deepEqual(p.variants.map((v) => v.label), ["6x6x4 / Kraft Brown", "6x6x4 / White", "8x8x6 / Kraft Brown", "8x8x6 / White"]);
  assert.deepEqual(p.variants.map((v) => v.sku), [`${base}-664-KRBR`, `${base}-664-WHIT`, `${base}-886-KRBR`, `${base}-886-WHIT`]);
  assert.deepEqual(p.variants.map((v) => v.priceMinor), [2500, 2800, 3200, 3500]);
  // Roll-ups: min price, total stock, min MOQ.
  assert.equal(p.basePriceMinor, 2500); assert.equal(p.stock, 300); assert.equal(p.moq, 10);
  assert.deepEqual(p.variantOptions, SIZE_COLOR);
  const rows = await prisma.productVariant.findMany({ where: { productId: p.id } });
  assert.equal(rows.length, 4);
  // Listed publicly with variants, without cost.
  const listed = (await api("/products")).body.data.products.find((x) => x.id === p.id);
  assert.equal(listed.variants.length, 4); assert.equal(listed.variants[0].costMinor, undefined);
});

test("admin controls the matrix: remove a combination, add one manually, override a SKU, bulk-style edits, per-variant image; last variant protected", async () => {
  const base = sku("MTX");
  const opts = [{ name: "Size", values: ["6x6x4", "8x8x6", "10x8x6"] }, { name: "Color", values: ["Brown", "White"] }];
  const all = matrix(opts);
  // The business does not sell 10x8x6 / White → 5 variants, and one custom SKU.
  const kept = all.filter((v) => !(v.attributes.Size === "10x8x6" && v.attributes.Color === "White"));
  kept[0].sku = `${base}-CUSTOM-1`;
  let res = await create({ name: "Matrix Box", sku: base, kind: "variable", variantOptions: opts, variants: kept });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  let p = res.body.data.product;
  assert.equal(p.variants.length, 5);
  assert.equal(p.variants[0].sku, `${base}-CUSTOM-1`, "manual SKU override kept");
  assert.ok(!p.variants.some((v) => v.label === "10x8x6 / White"));

  // Add a variant manually with a new value (the option gains the value).
  const upload = await admin("/uploads", { method: "POST", body: { name: "black.png", mime: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } });
  res = await admin(`/products/${p.id}/variants`, { method: "POST", body: { attributes: { Size: "6x6x4", Color: "Black" }, priceMinor: 3000, stock: 20, moq: 5, image: upload.body.data.url } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.variants.length, 6);
  const black = res.body.data.variants.find((v) => v.label === "6x6x4 / Black");
  assert.equal(black.image, upload.body.data.url);
  p = (await admin(`/products/${p.id}`)).body.data.product;
  assert.ok(p.variantOptions.find((o) => o.name === "Color").values.includes("Black"));

  // Edit one variant: price + stock + moq (what a bulk edit sends per row).
  res = await admin(`/variants/${black.id}`, { method: "PATCH", body: { priceMinor: 3100, stock: 25, moq: 8 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.data.variant.priceMinor, res.body.data.variant.stock, res.body.data.variant.moq], [3100, 25, 8]);

  // Delete one variant (soft) — order history keeps the row.
  res = await admin(`/variants/${black.id}`, { method: "DELETE" });
  assert.equal(res.status, 200); assert.equal(res.body.data.variants.length, 5);
  assert.ok((await prisma.productVariant.findUnique({ where: { id: black.id } })).deletedAt);

  // Duplicate combination / duplicate SKU / unknown option are refused.
  assert.equal((await admin(`/products/${p.id}/variants`, { method: "POST", body: { attributes: { Size: "6x6x4", Color: "Brown" } } })).status, 400, "duplicate combination");
  assert.equal((await admin(`/products/${p.id}/variants`, { method: "POST", body: { attributes: { Size: "12x12x12", Color: "Brown" }, sku: `${base}-CUSTOM-1` } })).status, 400, "duplicate sku");
  assert.equal((await admin(`/products/${p.id}/variants`, { method: "POST", body: { attributes: { Finish: "Matte", Size: "6x6x4", Color: "Brown" } } })).status, 400, "unknown option");
  // A variant SKU cannot collide with a simple product's SKU either.
  const simple = (await create({ name: "Other simple", sku: sku("SIM"), basePriceMinor: 100 })).body.data.product;
  assert.equal((await admin(`/products/${p.id}/variants`, { method: "POST", body: { attributes: { Size: "12x12x12", Color: "Brown" }, sku: simple.sku } })).status, 409);

  // Can't delete the last variant.
  const ids = (await admin(`/products/${p.id}`)).body.data.product.variants.map((v) => v.id);
  for (const id of ids.slice(0, -1)) await admin(`/variants/${id}`, { method: "DELETE" });
  assert.equal((await admin(`/variants/${ids.at(-1)}`, { method: "DELETE" })).body.code, "LAST_VARIANT");
});

test("flexible options: a tape with Width + Length + Color; a bottle with Capacity only", async () => {
  const opts = [{ name: "Width", values: ["24 mm", "48 mm"] }, { name: "Length", values: ["50 m"] }, { name: "Color", values: ["Brown", "Clear"] }];
  const res = await create({ name: "BOPP Tape", sku: sku("BOPP"), kind: "variable", variantOptions: opts, variants: opts[0].values.flatMap((w) => opts[2].values.map((c) => ({ attributes: { Width: w, Length: "50 m", Color: c }, priceMinor: 4000, stock: 10, moq: 1 }))) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.product.variants.map((v) => v.label), ["24 mm / 50 m / Brown", "24 mm / 50 m / Clear", "48 mm / 50 m / Brown", "48 mm / 50 m / Clear"]);
  const bottle = await create({ name: "PET Bottle", sku: sku("BTL"), kind: "variable", variantOptions: [{ name: "Capacity", values: ["250 ml", "500 ml", "1 L"] }], variants: ["250 ml", "500 ml", "1 L"].map((c, i) => ({ attributes: { Capacity: c }, priceMinor: 500 + i * 100, stock: 5, moq: 1 })) });
  assert.equal(bottle.status, 201);
  assert.deepEqual(bottle.body.data.product.variants.map((v) => v.priceMinor), [500, 600, 700]);
});

test("cart + checkout use the VARIANT: its price, stock and MOQ; the order snapshots sku/label/attributes/moq; stock moves per variant", async () => {
  const base = sku("CART");
  const variants = matrix(SIZE_COLOR);
  variants[3].priceMinor = 3500; variants[3].stock = 120; variants[3].moq = 100; // 8x8x6 / White
  const p = (await create({ name: "Checkout Box", sku: base, kind: "variable", variantOptions: SIZE_COLOR, variants })).body.data.product;
  const white886 = p.variants.find((v) => v.label === "8x8x6 / White");
  const buyer = await registerBuyer();

  // Variant is required for a variable product.
  let res = await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: p.id, quantity: 100 } });
  assert.equal(res.status, 400); assert.equal(res.body.code, "VARIANT_REQUIRED");
  res = await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: p.id, variantId: white886.id, quantity: 100 } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const line = res.body.data.items[0];
  assert.equal(line.variantId, white886.id); assert.equal(line.unitPriceMinor, 3500); assert.equal(line.sku, white886.sku);
  assert.equal(line.variant, "8x8x6 / White"); assert.deepEqual(line.attributes, { Size: "8x8x6", Color: "White" });
  assert.equal(line.available, 120); assert.equal(line.moq, 100);
  // Two different variants are two lines.
  const brown664 = p.variants.find((v) => v.label === "6x6x4 / Kraft Brown");
  res = await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: p.id, variantId: brown664.id, quantity: 10 } });
  assert.equal(res.body.data.items.length, 2);
  // Over the variant's stock → refused (the other variant's stock does not count).
  assert.equal((await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: p.id, variantId: white886.id, quantity: 21 } })).body.code, "INSUFFICIENT_STOCK");

  const quote = (await api("/checkout/quote", { method: "POST", token: buyer.token, body: {} })).body.data;
  assert.equal(quote.subtotalMinor, 100 * 3500 + 10 * 2500);
  const addressId = await makeAddress(buyer.token);
  res = await api("/checkout/place", { method: "POST", token: buyer.token, body: { shippingAddressId: addressId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = res.body.data;
  const it = order.items.find((x) => x.variantId === white886.id);
  assert.equal(it.sku, white886.sku); assert.equal(it.variant, "8x8x6 / White"); assert.deepEqual(it.variantAttributes, { Size: "8x8x6", Color: "White" });
  assert.equal(it.unitPriceMinor, 3500); assert.equal(it.moq, 100); assert.equal(it.quantity, 100);

  // Stock moved on the variant AND the parent roll-up; ledger rows carry the variant.
  const v = await prisma.productVariant.findUnique({ where: { id: white886.id } });
  assert.equal(v.stock, 20);
  assert.equal((await prisma.product.findUnique({ where: { id: p.id } })).stock, 420 - 110, "parent roll-up follows");
  assert.equal(await prisma.stockMovement.count({ where: { productId: p.id, variantId: white886.id, type: "DISPATCH" } }), 1);

  // Historical: rename the variant's price/attributes → the order still reads the old values.
  await admin(`/variants/${white886.id}`, { method: "PATCH", body: { priceMinor: 9900 } });
  await admin(`/variants/${white886.id}`, { method: "DELETE" });
  const later = (await api(`/orders/${order.id}`, { token: buyer.token })).body.data.items.find((x) => x.variantId === white886.id);
  assert.equal(later.unitPriceMinor, 3500); assert.equal(later.variant, "8x8x6 / White"); assert.equal(later.sku, white886.sku);

  // Cancelling restocks the variant.
  await api(`/orders/${order.id}/cancel`, { method: "POST", token: buyer.token, body: { reason: "test" } });
  assert.equal((await prisma.productVariant.findUnique({ where: { id: white886.id } })).stock, 120);
});

test("legacy simple products keep working: add to cart without variantId, edit, and convert to variable then back", async () => {
  const legacy = (await create({ name: "Legacy Mailer", sku: sku("LEG"), basePriceMinor: 1000, moq: 1, stock: 30, color: "Kraft", sizeLabel: "10x8 in" })).body.data.product;
  const buyer = await registerBuyer();
  let res = await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: legacy.id, quantity: 2 } });
  assert.equal(res.status, 201); assert.equal(res.body.data.items[0].variantId, null); assert.equal(res.body.data.items[0].unitPriceMinor, 1000);
  assert.equal((await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: legacy.id, variantId: "x", quantity: 1 } })).body.code, "NOT_VARIABLE");

  // Convert: its current sku/size/color/price/stock become variant #1 (the form sends this).
  res = await admin(`/products/${legacy.id}`, { method: "PATCH", body: { kind: "variable", variantOptions: [{ name: "Size", values: ["10x8 in", "12x10 in"] }], variants: [
    { sku: legacy.sku, attributes: { Size: "10x8 in" }, priceMinor: 1000, stock: 30, moq: 1 },
    { attributes: { Size: "12x10 in" }, priceMinor: 1200, stock: 10, moq: 1 },
  ] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.product.kind, "variable"); assert.equal(res.body.data.product.variants.length, 2);
  assert.equal(res.body.data.product.variants[0].sku, legacy.sku, "the product's own sku may be reused by its first variant");
  // Back to simple: variants retire, product fields rule again.
  res = await admin(`/products/${legacy.id}`, { method: "PATCH", body: { kind: "simple", basePriceMinor: 1100, stock: 40, moq: 1 } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.product.kind, "simple"); assert.equal(res.body.data.product.variants.length, 0); assert.equal(res.body.data.product.basePriceMinor, 1100);
  assert.equal(await prisma.productVariant.count({ where: { productId: legacy.id, deletedAt: null } }), 0);
});

test("import v2: single-sheet rows grouped into ONE product with variants + a simple product; validate first; all-or-nothing", async () => {
  const pid = `BOX${rnd()}`; const tapeSku = sku("IMPTAPE"); skus.push(`${pid}-664-BR`, `${pid}-664-WH`, `${pid}-886-BR`, pid);
  const products = [
    { productId: pid, sku: pid, name: "Imported Corrugated Box", kind: "variable", category: CAT.name, subcategory: "5 Ply", material: "Kraft", gsm: 120, description: "Heavy duty", variants: [
      { sku: `${pid}-664-BR`, attributes: { Size: "6x6x4", Color: "Kraft Brown" }, price: 25, stock: 500, moq: 50 },
      { sku: `${pid}-664-WH`, attributes: { Size: "6x6x4", Color: "White" }, price: 28, stock: 300, moq: 50 },
      { sku: `${pid}-886-BR`, attributes: { Size: "8x8x6", Color: "Kraft Brown" }, price: 32, stock: 400, moq: 50 },
    ] },
    { sku: tapeSku, name: "Imported Kraft Tape", kind: "simple", category: CAT.name, price: 120, stock: 40, moq: 1, color: "Brown" },
  ];
  // Validation (dry run) — nothing written.
  let res = await admin("/products/import/validate", { method: "POST", body: { products } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.ok, true);
  assert.deepEqual([res.body.data.summary.products, res.body.data.summary.variants, res.body.data.summary.categoriesMatched, res.body.data.summary.subcategoriesMatched], [2, 3, 2, 1]);
  assert.equal(res.body.data.preview[0].variants.length, 3);
  assert.deepEqual(res.body.data.preview[0].variants.map((v) => v.label), ["6x6x4 / Kraft Brown", "6x6x4 / White", "8x8x6 / Kraft Brown"]);
  assert.ok(res.body.data.warnings.some((w) => /no image/i.test(w.message)));
  assert.equal(await prisma.product.count({ where: { sku: pid } }), 0, "dry run wrote nothing");

  // Errors block: unknown category, duplicate SKU, bad price, missing subcategory.
  res = await admin("/products/import/validate", { method: "POST", body: { products: [
    { sku: sku("BADCAT"), name: "No such category", category: `Nope ${rnd()}`, price: 1 },
    { sku: `${pid}-664-BR`, name: "Dup A", category: CAT.name }, { sku: `${pid}-664-BR`, name: "Dup B", category: CAT.name },
    { sku: sku("BADPRICE"), name: "Bad price", category: CAT.name, price: "abc" },
    { sku: sku("BADSUB"), name: "Bad sub", category: CAT.name, subcategory: "Does not exist" },
  ] } });
  assert.equal(res.body.data.ok, false);
  const msgs = res.body.data.errors.map((e) => e.message).join("\n");
  for (const re of [/does not exist\. Create it/, /Duplicate SKU/, /Price must be a number/, /Subcategory "Does not exist" does not exist/]) assert.match(msgs, re);
  const blocked = await admin("/products/import", { method: "POST", body: { format: "v2", products: [{ sku: sku("BLK"), name: "Blocked", category: `Nope ${rnd()}` }] } });
  assert.equal(blocked.status, 400); assert.equal(blocked.body.code, "IMPORT_INVALID"); assert.ok(Array.isArray(blocked.body.details));
  // With "create missing categories" the same file validates (as a warning).
  res = await admin("/products/import/validate", { method: "POST", body: { products: [{ sku: sku("NEWCAT"), name: "New cat", category: `Fresh Cat ${rnd()}` }], createCategories: true } });
  assert.equal(res.body.data.ok, true); assert.equal(res.body.data.summary.newCategories.length, 1);

  // Import for real.
  res = await admin("/products/import", { method: "POST", body: { format: "v2", products, fileName: "boxes.xlsx" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.data.created, res.body.data.updated, res.body.data.variantsWritten], [2, 0, 3]);
  const box = await prisma.product.findUnique({ where: { sku: pid }, include: { variants: true } });
  assert.equal(box.hasVariants, true); assert.equal(box.variants.length, 3); assert.equal(box.subcategoryId, SUB.id);
  assert.deepEqual(box.variants.map((v) => v.priceMinor).sort(), [2500, 2800, 3200]);
  assert.equal(box.basePriceMinor, 2500); assert.equal(box.stock, 1200);
  const tape = await prisma.product.findUnique({ where: { sku: tapeSku } });
  assert.equal(tape.hasVariants, false); assert.equal(tape.basePriceMinor, 12000); assert.equal(tape.stock, 40);
  assert.equal(await prisma.product.count({ where: { name: "Imported Corrugated Box", deletedAt: null } }), 1, "no duplicate products");

  // Re-import (update): same Product ID → same product, a new variant added, a price changed, no duplicates.
  products[0].variants[0].price = 26; products[0].variants.push({ sku: `${pid}-886-WH`, attributes: { Size: "8x8x6", Color: "White" }, price: 35, stock: 250, moq: 50 }); skus.push(`${pid}-886-WH`);
  res = await admin("/products/import/validate", { method: "POST", body: { products } });
  assert.deepEqual([res.body.data.summary.toCreate, res.body.data.summary.toUpdate], [0, 2]);
  res = await admin("/products/import", { method: "POST", body: { format: "v2", products } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.data.created, res.body.data.updated], [0, 2]);
  const again = await prisma.product.findUnique({ where: { sku: pid }, include: { variants: { where: { deletedAt: null } } } });
  assert.equal(again.id, box.id); assert.equal(again.variants.length, 4);
  assert.equal(again.variants.find((v) => v.sku === `${pid}-664-BR`).priceMinor, 2600);
  assert.equal(await prisma.product.count({ where: { name: "Imported Corrugated Box", deletedAt: null } }), 1);

  // All-or-nothing: a product whose variant SKU belongs to ANOTHER product fails validation → nothing of the batch is written.
  const other = `OTH${rnd()}`; skus.push(other, `${other}-A`);
  res = await admin("/products/import", { method: "POST", body: { format: "v2", products: [
    { sku: sku("GOOD"), name: "Would be fine", category: CAT.name, price: 5 },
    { productId: other, name: "Steals a sku", kind: "variable", category: CAT.name, variants: [{ sku: `${pid}-664-WH`, attributes: { Size: "1" }, price: 1 }] },
  ] } });
  assert.equal(res.status, 400);
  assert.equal(await prisma.product.count({ where: { name: "Would be fine" } }), 0, "the good product was NOT written");
});

test("permissions: variant + import endpoints are admin-only; reads are public", async () => {
  const buyer = await registerBuyer();
  const p = (await create({ name: "Perm Box", sku: sku("PERM"), kind: "variable", variantOptions: [{ name: "Size", values: ["A"] }], variants: [{ attributes: { Size: "A" }, priceMinor: 1 }] })).body.data.product;
  for (const [method, path] of [["POST", `/products/${p.id}/variants`], ["PATCH", `/variants/${p.variants[0].id}`], ["DELETE", `/variants/${p.variants[0].id}`], ["POST", "/products/import/validate"], ["POST", "/products/import"]]) {
    assert.equal((await api(path, { method, token: buyer.token, body: {} })).status, 403, `${method} ${path}`);
    assert.equal((await api(path, { method, body: {} })).status, 401, `${method} ${path} anonymous`);
  }
  assert.equal((await api(`/products/${p.id}`)).status, 200);
});
