// Canonical catalog normalization tests (pure — no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSize, normalizeRow, int, text, isBlank, slugify } from "../src/services/catalog-normalize.mjs";

test("3-axis sizes parse into dimensions AND keep their label", () => {
  for (const [input, expected] of [
    ["12 x 4 x 4 inch", { length: 12, width: 4, height: 4, unit: "in" }],
    ["12 × 12 × 2 inch", { length: 12, width: 12, height: 2, unit: "in" }],
    ["10x8x4 cm", { length: 10, width: 8, height: 4, unit: "cm" }],
    ["200 x 100 x 50 mm", { length: 200, width: 100, height: 50, unit: "mm" }],
  ]) {
    const r = parseSize(input);
    assert.deepEqual(r.dimensions, expected, input);
    assert.equal(r.sizeLabel, input, "raw text is never discarded");
  }
});

test("capacities and sheet sizes are NOT parsed as 3D dimensions", () => {
  // Writing "12" into `length` for a 12 oz cup would be fabricated data.
  for (const input of ["12 oz", "500 ml", "400ml", "A4", "60 cc", "6 oz / 500 ml", "2.5 oz"]) {
    const r = parseSize(input);
    assert.equal(r.dimensions, null, `${input} must not become dimensions`);
    assert.equal(r.sizeLabel, input, `${input} must be preserved`);
  }
});

test("a 2D size is not promoted to 3D", () => {
  const r = parseSize("3 x 4 inch");
  assert.equal(r.dimensions, null);
  assert.equal(r.sizeLabel, "3 x 4 inch");
});

test("a 3-number size with a non-length unit is rejected", () => {
  assert.equal(parseSize("12 x 4 x 4 oz").dimensions, null, "oz is not a length unit");
});

test("blank tokens normalize to null, never 0", () => {
  for (const t of ["-", "--", "—", "N/A", "NA", "null", "nil", "none", "TBD", "?", "  ", ""]) {
    assert.equal(isBlank(t), true, `${JSON.stringify(t)} is blank`);
    assert.equal(int(t), null, `${JSON.stringify(t)} must be null, not 0`);
    assert.equal(text(t), null);
  }
});

test("real numerics parse, tolerating separators and units", () => {
  assert.equal(int("350"), 350);
  assert.equal(int("1,200"), 1200);
  assert.equal(int("300 gsm"), 300);
  assert.equal(int("abc"), null, "unparseable → null, not 0");
});

test("absent MOQ/stock/price are OMITTED so updates never invent values", () => {
  const { data } = normalizeRow({ SKU: "A", "Product Name": "N", MOQ: "-", Stock: "", Price: "" });
  assert.ok(!("moq" in data), "no MOQ key at all");
  assert.ok(!("stock" in data), "no stock key at all");
  assert.ok(!("basePriceMinor" in data), "absent price stays quotation-based");
});

test("a supplied price converts rupees → minor units", () => {
  const { data } = normalizeRow({ SKU: "A", "Product Name": "N", Price: "249" });
  assert.equal(data.basePriceMinor, 24900);
});

test("spreadsheet headers and canonical keys map identically", () => {
  const fromHeaders = normalizeRow({ SKU: "A", "Product Name": "N", Category: "Boxes", Subcategory: "Gift Boxes", GSM: "350", Type: "Box", Color: "Kraft" });
  const fromCanonical = normalizeRow({ sku: "A", name: "N", category: "Boxes", subcategory: "Gift Boxes", gsm: "350", type: "Box", color: "Kraft" });
  assert.deepEqual(fromHeaders.data, fromCanonical.data);
  assert.equal(fromHeaders.category, "Boxes");
  assert.equal(fromHeaders.subcategory, "Gift Boxes");
});

test("unknown status falls back to draft with a warning, not an error", () => {
  const r = normalizeRow({ SKU: "A", "Product Name": "N", Status: "publish" });
  assert.equal(r.data.status, "draft");
  assert.ok(r.warnings.some((w) => w.includes("publish")));
});

test("slugs are deterministic and case-insensitive", () => {
  assert.equal(slugify("Food Packaging"), "food-packaging");
  assert.equal(slugify("  BOXES  "), "boxes");
  assert.equal(slugify("Boxes"), slugify("boxes"));
});
