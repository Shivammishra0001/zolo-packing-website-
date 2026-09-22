// Product Catalog → Categories: admin CRUD, slugs, ordering, status, moving,
// archive protection, and what the storefront tree does (and does not) expose.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerBuyer, registerSeller } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 7);
const made = [];
let ADMIN;
before(async () => { await startServer(); ADMIN = await adminToken(); });
after(async () => {
  await prisma.product.deleteMany({ where: { sku: { startsWith: "ZOLO-TEST-CAT-" } } });
  if (made.length) await prisma.category.deleteMany({ where: { id: { in: made } } });
  await stopServer();
});

const admin = (path, opt = {}) => api(path, { token: ADMIN, ...opt });
async function makeCat(body) {
  const res = await admin("/categories", { method: "POST", body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  made.push(res.body.data.category.id);
  return res.body.data.category;
}
const publicTree = async () => (await api("/categories")).body.data.tree;
const adminTree = async () => (await admin("/categories?scope=admin")).body.data.tree;
const makeProduct = (cat, sub) => admin("/products", { method: "POST", body: { name: `Cat test ${rnd()}`, sku: `ZOLO-TEST-CAT-${rnd().toUpperCase()}`, categoryId: cat.id, subcategoryId: sub?.id ?? null, basePriceMinor: 1000, moq: 1, status: "active" } });

test("create category + subcategory: slugs generated, unique, editable; nested paths refused", async () => {
  const name = `Corrugated Boxes ${rnd()}`;
  const cat = await makeCat({ name, description: "Shipping <b>boxes</b>" });
  assert.equal(cat.slug, name.toLowerCase().replace(/\s+/g, "-"));
  assert.equal(cat.description, "Shipping boxes", "markup stripped");
  assert.equal(cat.isActive, true);
  assert.equal(cat.parentId, null);

  const sub = await makeCat({ name: "5 Ply Boxes", parentId: cat.id });
  assert.equal(sub.slug, `${cat.slug}-5-ply-boxes`);
  assert.equal(sub.parentName, cat.name);

  // Same name under the same parent → refused; under another parent → fine.
  const dup = await admin("/categories", { method: "POST", body: { name: "5 ply boxes", parentId: cat.id } });
  assert.equal(dup.status, 400); assert.ok(dup.body.issues.some((i) => i.path === "name"));
  const other = await makeCat({ name: `Paper Bags ${rnd()}` });
  await makeCat({ name: "5 Ply Boxes", parentId: other.id });

  // Slug collisions get a suffix when generated, and are refused when typed.
  const twin = await makeCat({ name: `${name} Twin`, slug: undefined });
  assert.notEqual(twin.slug, cat.slug);
  const typed = await admin("/categories", { method: "POST", body: { name: `Other ${rnd()}`, slug: cat.slug } });
  assert.equal(typed.status, 400); assert.ok(typed.body.issues.some((i) => i.path === "slug"));
  for (const slug of ["Has Space", "UPPER", "bad_underscore", "-lead", "trail-"]) {
    const res = await admin("/categories", { method: "POST", body: { name: `X ${rnd()}`, slug } });
    assert.ok(res.status === 400 || res.body.data?.category?.slug !== slug, slug);
  }
  const edited = await admin(`/categories/${cat.id}`, { method: "PATCH", body: { slug: `custom-${rnd()}` } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.match(edited.body.data.category.slug, /^custom-/);

  // No 3-level nesting; no self-parenting; parent must exist.
  assert.equal((await admin("/categories", { method: "POST", body: { name: "Deep", parentId: sub.id } })).status, 400);
  assert.equal((await admin(`/categories/${cat.id}`, { method: "PATCH", body: { parentId: cat.id } })).status, 400);
  assert.equal((await admin("/subcategories", { method: "POST", body: { name: "Orphan" } })).status, 400);
  assert.equal((await admin("/categories", { method: "POST", body: { name: "" } })).status, 400);
  assert.equal((await admin("/categories", { method: "POST", body: { name: "Img", image: "https://evil.example/x.png" } })).status, 400, "foreign image URL refused");
});

test("ordering: sortOrder persists, reorder + position endpoints, storefront follows immediately", async () => {
  const tag = rnd();
  const a = await makeCat({ name: `Order A ${tag}` });
  const b = await makeCat({ name: `Order B ${tag}` });
  const c = await makeCat({ name: `Order C ${tag}` });
  const mine = (tree) => tree.filter((x) => x.name.endsWith(tag)).map((x) => x.name.split(" ")[1]);
  assert.deepEqual(mine(await publicTree()), ["A", "B", "C"], "new rows append in creation order");

  const re = await admin("/categories/reorder", { method: "POST", body: { parentId: null, ids: [b.id, a.id, c.id] } });
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.deepEqual(mine(await publicTree()), ["B", "A", "C"]);
  const rows = await prisma.category.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, select: { id: true, sortOrder: true } });
  assert.ok(rows.find((r) => r.id === b.id).sortOrder < rows.find((r) => r.id === a.id).sortOrder, "persisted in PostgreSQL");

  // Absolute position among ALL top-level siblings.
  const pos = await admin(`/categories/${c.id}/order`, { method: "PATCH", body: { position: 1 } });
  assert.equal(pos.status, 200);
  assert.equal((await publicTree())[0].id, c.id, "C is first in the storefront");
  assert.equal((await admin("/categories/reorder", { method: "POST", body: { parentId: null, ids: [a.id, "no-such-id"] } })).status, 400);

  // Subcategories order independently.
  const s1 = await makeCat({ name: "S1", parentId: a.id }); const s2 = await makeCat({ name: "S2", parentId: a.id }); const s3 = await makeCat({ name: "S3", parentId: a.id });
  await admin("/subcategories/reorder", { method: "POST", body: { parentId: a.id, ids: [s3.id, s1.id, s2.id] } });
  const node = (await publicTree()).find((x) => x.id === a.id);
  assert.deepEqual(node.subcategories.map((s) => s.name), ["S3", "S1", "S2"]);
  await admin(`/subcategories/${s2.id}/order`, { method: "PATCH", body: { position: 1 } });
  assert.deepEqual((await publicTree()).find((x) => x.id === a.id).subcategories.map((s) => s.name), ["S2", "S3", "S1"]);
});

test("status: inactive rows vanish from the storefront but stay in admin; existing products keep their link; no new assignments", async () => {
  const cat = await makeCat({ name: `Status Cat ${rnd()}` });
  const sub = await makeCat({ name: "Live Sub", parentId: cat.id });
  const off = await makeCat({ name: "Hidden Sub", parentId: cat.id, isActive: false });
  const created = await makeProduct(cat, sub);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const product = created.body.data.product;

  let node = (await publicTree()).find((x) => x.id === cat.id);
  assert.deepEqual(node.subcategories.map((s) => s.name), ["Live Sub"], "inactive subcategory hidden from customers");
  assert.equal(node.productCount, 1);
  node = (await adminTree()).find((x) => x.id === cat.id);
  assert.deepEqual(node.subcategories.map((s) => [s.name, s.isActive]), [["Live Sub", true], ["Hidden Sub", false]], "admin sees everything");
  assert.equal((await api("/categories?scope=admin")).body.data.tree.find((x) => x.id === cat.id)?.subcategories.length, 1, "anonymous ?scope=admin still gets the public tree");

  // Cannot assign a NEW product to an inactive subcategory / category.
  const bad = await makeProduct(cat, off);
  assert.equal(bad.status, 400); assert.equal(bad.body.code, "SUBCATEGORY_INACTIVE");
  const status = await admin(`/categories/${cat.id}/status`, { method: "PATCH", body: { isActive: false } });
  assert.equal(status.body.data.category.isActive, false);
  assert.ok(!(await publicTree()).some((x) => x.id === cat.id), "inactive category gone from the storefront");
  assert.ok((await adminTree()).some((x) => x.id === cat.id), "still visible to the admin");
  assert.equal((await makeProduct(cat, sub)).body.code, "CATEGORY_INACTIVE");

  // The existing product is untouched and can still be edited (its own category stays allowed).
  const still = await prisma.product.findUnique({ where: { id: product.id } });
  assert.equal(still.categoryId, cat.id); assert.equal(still.subcategoryId, sub.id);
  const edit = await admin(`/products/${product.id}`, { method: "PATCH", body: { name: "Renamed while category inactive" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).categoryId, cat.id);
  await admin(`/categories/${cat.id}/status`, { method: "PATCH", body: { isActive: true } });
  assert.equal((await admin(`/subcategories/${off.id}/status`, { method: "PATCH", body: { isActive: "yes" } })).status, 400);
});

test("edit + move: rename updates products' denormalized names; moving a subcategory carries its products", async () => {
  const from = await makeCat({ name: `From ${rnd()}` });
  const to = await makeCat({ name: `To ${rnd()}` });
  const sub = await makeCat({ name: "Courier Bags", parentId: from.id });
  const product = (await makeProduct(from, sub)).body.data.product;

  const renamed = await admin(`/categories/${from.id}`, { method: "PATCH", body: { name: `Packaging Bags ${rnd()}`, description: "Bags of every kind" } });
  assert.equal(renamed.status, 200);
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).category, renamed.body.data.category.name);

  const moved = await admin(`/subcategories/${sub.id}`, { method: "PATCH", body: { parentId: to.id } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.data.category.parentId, to.id);
  const p = await prisma.product.findUnique({ where: { id: product.id } });
  assert.equal(p.categoryId, to.id, "product followed its subcategory");
  assert.equal(p.category, to.name);
  assert.equal(p.subcategoryId, sub.id);
  const tree = await adminTree();
  assert.ok(tree.find((x) => x.id === to.id).subcategories.some((s) => s.id === sub.id));
  assert.ok(!tree.find((x) => x.id === from.id).subcategories.some((s) => s.id === sub.id));
  assert.equal((await admin(`/categories/${to.id}`, { method: "PATCH", body: { parentId: from.id } })).status, 400, "a category with subcategories cannot become a subcategory");
});

test("archive protection: rows with products (or subcategories) are refused with the exact message; empty ones archive softly", async () => {
  const cat = await makeCat({ name: `Archive Cat ${rnd()}` });
  const sub = await makeCat({ name: "Sub", parentId: cat.id });
  const product = (await makeProduct(cat, sub)).body.data.product;

  let res = await admin(`/categories/${cat.id}`, { method: "DELETE" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "CATEGORY_HAS_PRODUCTS");
  assert.equal(res.body.error, "This category contains 1 product. Please reassign the products before deleting this category.");
  res = await admin(`/subcategories/${sub.id}`, { method: "DELETE" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /^This subcategory contains 1 product\. Please reassign/);
  assert.ok(await prisma.product.findUnique({ where: { id: product.id } }), "product untouched");

  // Reassign the product elsewhere, then the subcategory can go; the category
  // still has a subcategory → refused until that is archived too.
  const elsewhere = await makeCat({ name: `Elsewhere ${rnd()}` });
  assert.equal((await admin(`/products/${product.id}`, { method: "PATCH", body: { categoryId: elsewhere.id, subcategoryId: null } })).status, 200);
  assert.equal((await admin(`/categories/${cat.id}`, { method: "DELETE" })).body.code, "CATEGORY_HAS_SUBCATEGORIES");
  assert.equal((await admin(`/subcategories/${sub.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await admin(`/categories/${cat.id}`, { method: "DELETE" })).status, 200);
  const row = await prisma.category.findUnique({ where: { id: cat.id } });
  assert.ok(row && row.deletedAt && !row.isActive, "soft-archived, id preserved");
  assert.ok(!(await adminTree()).some((x) => x.id === cat.id));
  assert.equal((await admin(`/categories/${cat.id}`)).status, 404);
  // Recreating with the same name restores the archived row (same id) — the importer relies on this.
  const back = await admin("/categories", { method: "POST", body: { name: cat.name } });
  assert.equal(back.body.data.category.id, cat.id);
  assert.equal(await prisma.product.count({ where: { id: product.id, deletedAt: null } }), 1, "no product was ever deleted");
});

test("the public tree: image = uploaded image, else a product image; counts are active products only; flat list kept", async () => {
  const cat = await makeCat({ name: `Img Cat ${rnd()}` });
  const upload = await admin("/uploads", { method: "POST", body: { name: "cat.png", mime: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } });
  const saved = await admin(`/categories/${cat.id}`, { method: "PATCH", body: { image: upload.body.data.url } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const node = (await publicTree()).find((x) => x.id === cat.id);
  assert.equal(node.image, upload.body.data.url);
  assert.equal(node.imageSource, "uploaded");
  assert.equal(node.productCount, 0);
  const body = (await api("/categories")).body.data;
  assert.ok(Array.isArray(body.categories) && body.categories.some((c) => c.id === cat.id), "flat list still served");
  assert.ok(body.categories.every((c) => c.isActive), "flat public list is active-only");
});

test("permissions: reads are public, every write needs the admin role", async () => {
  const buyer = await registerBuyer(); const seller = await registerSeller();
  const cat = await makeCat({ name: `Perm ${rnd()}` });
  assert.equal((await api("/categories")).status, 200);
  assert.equal((await api("/categories/tree")).status, 200);
  const writes = [
    ["POST", "/categories", { name: "Nope" }], ["POST", "/subcategories", { name: "Nope", parentId: cat.id }],
    ["PATCH", `/categories/${cat.id}`, { name: "Nope" }], ["PATCH", `/categories/${cat.id}/status`, { isActive: false }],
    ["PATCH", `/categories/${cat.id}/order`, { position: 1 }], ["POST", "/categories/reorder", { ids: [cat.id] }],
    ["DELETE", `/categories/${cat.id}`], ["GET", `/categories/${cat.id}`], ["GET", "/subcategories"],
  ];
  for (const [method, path, body] of writes) {
    for (const token of [buyer.token, seller.token]) assert.equal((await api(path, { method, token, body })).status, 403, `${method} ${path}`);
    assert.equal((await api(path, { method, body })).status, 401, `${method} ${path} anonymous`);
  }
  const row = await prisma.category.findUnique({ where: { id: cat.id } });
  assert.equal(row.name, cat.name); assert.equal(row.isActive, true); assert.equal(row.deletedAt, null);
});
