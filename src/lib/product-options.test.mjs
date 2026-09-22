// Unit tests for the shared size/colour normalizer.
// Run: node --test src/lib/product-options.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMultiValue, joinMultiValue, normalizeProductSizes, normalizeProductColors, summarizeOptions } from "./product-options.ts";

test("splitMultiValue accepts array, comma, pipe, semicolon and newline formats", () => {
  assert.deepEqual(splitMultiValue(["Brown", " White "]), ["Brown", "White"]);
  assert.deepEqual(splitMultiValue("Brown, White | Black; Cream\nGold"), ["Brown", "White", "Black", "Cream", "Gold"]);
  assert.deepEqual(splitMultiValue("Natural Kraft"), ["Natural Kraft"]);
  assert.deepEqual(splitMultiValue(null), []);
  assert.deepEqual(splitMultiValue("  "), []);
  assert.deepEqual(splitMultiValue("n/a"), []);
});

test("' / ' is one value (two-tone colours, fractional sizes) and duplicates collapse case-insensitively", () => {
  assert.deepEqual(splitMultiValue("Yellow / Black"), ["Yellow / Black"]);
  assert.deepEqual(splitMultiValue("1/2 inch, 1/2 INCH, 3/4 inch"), ["1/2 inch", "3/4 inch"]);
});

test("joinMultiValue writes the canonical comma-separated column value", () => {
  assert.equal(joinMultiValue(["6x6x4", "8x8x6"]), "6x6x4, 8x8x6");
  assert.equal(joinMultiValue([]), null);
});

test("normalizeProductSizes reads the stored label (any format) and falls back to dimensions", () => {
  assert.deepEqual(normalizeProductSizes("12 x 10 x 8 in | 16 x 12 x 10 in"), ["12 x 10 x 8 in", "16 x 12 x 10 in"]);
  assert.deepEqual(normalizeProductSizes(null, { length: 10, width: 8, height: 4, unit: "cm" }), ["10×8×4 cm"]);
  assert.deepEqual(normalizeProductSizes(null, null), []);
});

test("normalizeProductColors handles the live DB shapes", () => {
  assert.deepEqual(normalizeProductColors("Clear / Silver"), ["Clear / Silver"]);
  assert.deepEqual(normalizeProductColors("Brown, White, Black"), ["Brown", "White", "Black"]);
  assert.deepEqual(normalizeProductColors(undefined), []);
});

test("summarizeOptions truncates with +N more and returns null for nothing", () => {
  assert.equal(summarizeOptions(["6x6x4", "8x8x6", "10x8x6", "12x10x8"], 3), "6x6x4 • 8x8x6 • 10x8x6 +1 more");
  assert.equal(summarizeOptions(["Brown"], 3), "Brown");
  assert.equal(summarizeOptions([], 3), null);
});
