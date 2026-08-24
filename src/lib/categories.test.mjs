// Category tree derivation tests.
// Run: npx tsx --test src/lib/categories.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryTree, productMatchesCategory, slugifyCategory } from "./categories.ts";

// Minimal StoreProduct shape: the tree only reads tags[0] and subcategory.
const p = (category, subcategory, name = "x") => ({ name, tags: [category], subcategory });

test("groups products by their real category", () => {
  const tree = buildCategoryTree([p("Boxes", "Gift Boxes"), p("Boxes", "Mailer Boxes"), p("Tapes", "Kraft Tape")]);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].name, "Boxes");
  assert.equal(tree[0].count, 2);
  assert.equal(tree[1].name, "Tapes");
});

test("category names differing only by case/whitespace collapse into one node", () => {
  const tree = buildCategoryTree([p("Boxes", "A"), p("boxes", "B"), p("  BOXES  ", "C")]);
  assert.equal(tree.length, 1, "Boxes / boxes / BOXES are one category");
  assert.equal(tree[0].count, 3);
});

test("subcategories carry real counts and are sorted by size", () => {
  const tree = buildCategoryTree([
    p("Boxes", "Gift Boxes"), p("Boxes", "Gift Boxes"), p("Boxes", "Mailer Boxes"),
  ]);
  const subs = tree[0].subcategories;
  assert.equal(subs[0].name, "Gift Boxes");
  assert.equal(subs[0].count, 2);
  assert.equal(subs[1].count, 1);
});

test("'General' placeholder never becomes a customer-facing subcategory", () => {
  // The importer writes "General" when a row has no subcategory; it is not a
  // real grouping and must not appear as a filter.
  const tree = buildCategoryTree([p("Boxes", "General"), p("Boxes", "Gift Boxes")]);
  assert.deepEqual(tree[0].subcategories.map((s) => s.name), ["Gift Boxes"]);
});

test("categories are ordered by product count, biggest first", () => {
  const tree = buildCategoryTree([p("Tapes", "a"), p("Boxes", "b"), p("Boxes", "c"), p("Boxes", "d")]);
  assert.deepEqual(tree.map((c) => c.name), ["Boxes", "Tapes"]);
});

test("a product with no category falls into 'Other' rather than vanishing", () => {
  const tree = buildCategoryTree([p("", "")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, "Other");
});

test("filter matches on category slug", () => {
  assert.equal(productMatchesCategory(p("Boxes", "Gift Boxes"), "boxes"), true);
  assert.equal(productMatchesCategory(p("Tapes", "Kraft Tape"), "boxes"), false);
});

test("filter also matches a SUBcategory slug", () => {
  // "Cans" and "Bottles" live as subcategories of Containers in the real
  // catalog, so /products?category=metal-cans must still resolve.
  assert.equal(productMatchesCategory(p("Containers", "Metal Cans"), "metal-cans"), true);
  assert.equal(productMatchesCategory(p("Containers", "Pill Bottles"), "pill-bottles"), true);
  assert.equal(productMatchesCategory(p("Containers", "Glass Jars"), "metal-cans"), false);
});

test("empty filter matches everything", () => {
  assert.equal(productMatchesCategory(p("Boxes", "x"), ""), true);
});

test("slugify is URL-safe and stable", () => {
  assert.equal(slugifyCategory("Food Packaging"), "food-packaging");
  assert.equal(slugifyCategory("  PACKAGING ACCESSORIES  "), "packaging-accessories");
  assert.equal(slugifyCategory("Boxes"), slugifyCategory("boxes"));
});
