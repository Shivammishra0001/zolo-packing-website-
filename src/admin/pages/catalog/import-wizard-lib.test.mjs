// Import wizard grouping. Run: npx tsx --test src/admin/pages/catalog/import-wizard-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { autoMap, parseWorkbook, groupProducts, matchZipImages, applyImageUrls, buildTemplate, toPayload } from "./import-wizard-lib.ts";

const book = (sheets) => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
};

test("single sheet: rows with the same Product ID become ONE variable product; a lone Simple row stays simple", () => {
  const wb = parseWorkbook(book({ Sheet1: [
    ["SKU", "Product ID", "Product Name", "Category", "Subcategory", "Type", "Color", "Size", "Price", "Stock", "MOQ", "Image", "Status"],
    ["BOX001-BR-664", "BOX001", "Corrugated Box", "Boxes", "5 Ply", "Variable", "Kraft Brown", "6x6x4", "25", "500", "50", "box.jpg", "Active"],
    ["BOX001-WH-664", "BOX001", "Corrugated Box", "Boxes", "5 Ply", "Variable", "White", "6x6x4", "28", "300", "50", "box-white.jpg", "Active"],
    ["BOX001-BR-886", "BOX001", "Corrugated Box", "Boxes", "5 Ply", "Variable", "Kraft Brown", "8x8x6", "32", "400", "50", "box.jpg", "Active"],
    ["TAPE-001", "", "Kraft Tape", "Tapes", "", "Simple", "Brown", "48mm", "120", "40", "1", "", "Active"],
  ] }));
  assert.equal(wb.format, "single");
  const m = autoMap(wb.products.headers);
  assert.deepEqual(m["Color"], { option: "Color" }); assert.deepEqual(m["Size"], { option: "Size" }); assert.deepEqual(m["Product ID"], { field: "productId" }); assert.deepEqual(m["Type"], { field: "kind" });
  const products = groupProducts(wb, m);
  assert.equal(products.length, 2, "3 rows → 1 product, plus the tape");
  const box = products.find((p) => p.name === "Corrugated Box");
  assert.equal(box.kind, "variable"); assert.equal(box.variants.length, 3); assert.equal(box.sku, "BOX001");
  assert.deepEqual(box.variantOptions, [{ name: "Color", values: ["Kraft Brown", "White"] }, { name: "Size", values: ["6x6x4", "8x8x6"] }]);
  assert.deepEqual(box.variants[1].attributes, { Color: "White", Size: "6x6x4" }); assert.equal(box.variants[1].price, "28");
  assert.deepEqual(box.images, ["box.jpg", "box-white.jpg"], "product images = the variants' images");
  const tape = products.find((p) => p.name === "Kraft Tape");
  assert.equal(tape.kind, "simple"); assert.equal(tape.sku, "TAPE-001"); assert.equal(tape.price, "120"); assert.equal(tape.color, "Brown"); assert.equal(tape.size, "48mm"); assert.deepEqual(tape.variants, []);
});

test("rows sharing only a Product Name (no id) still group; >1 row implies variable", () => {
  const wb = parseWorkbook(book({ Sheet1: [["SKU", "Product Name", "Category", "Capacity", "Price"], ["BTL-250", "PET Bottle", "Bottles", "250 ml", "5"], ["BTL-500", "pet bottle", "Bottles", "500 ml", "6"]] }));
  const products = groupProducts(wb, autoMap(wb.products.headers));
  assert.equal(products.length, 1); assert.equal(products[0].kind, "variable");
  assert.deepEqual(products[0].variantOptions, [{ name: "Capacity", values: ["250 ml", "500 ml"] }]);
});

test("two sheets: Products + Variants joined on Product ID; product image kept; orphan variant rows surface", () => {
  const wb = parseWorkbook(book({
    Products: [["Product ID", "Product Name", "Product Type", "Category", "Subcategory", "Material", "GSM", "Image"], ["BOX001", "Shipping Box", "Variable", "Boxes", "5 Ply", "Kraft", "120", "box001.jpg"]],
    Variants: [["Product ID", "SKU", "Size", "Color", "Price", "Stock", "MOQ", "Variant Image"], ["BOX001", "BOX001-664-BR", "6x6x4", "Kraft Brown", "25", "500", "50", "a.jpg"], ["BOX001", "BOX001-886-WH", "8x8x6", "White", "35", "250", "50", ""], ["NOPE", "X-1", "1", "Red", "1", "1", "1", ""]],
  }));
  assert.equal(wb.format, "two-sheet");
  const products = groupProducts(wb, autoMap(wb.products.headers), autoMap(wb.variants.headers));
  const box = products.find((p) => p.productId === "BOX001");
  assert.equal(box.kind, "variable"); assert.equal(box.variants.length, 2); assert.equal(box.material, "Kraft"); assert.equal(box.gsm, "120");
  assert.deepEqual(box.images, ["box001.jpg"]); assert.equal(box.variants[0].image, "a.jpg");
  assert.ok(products.some((p) => p.productId === "NOPE" && p.variants.length === 1), "orphan row is visible for the validation step");
});

test("ZIP images match by file name, then SKU / Product ID; unmatched names are reported", () => {
  const wb = parseWorkbook(book({ Sheet1: [["SKU", "Product ID", "Product Name", "Category", "Size", "Image"], ["BOX001-BR-664", "BOX001", "Box", "Boxes", "6x6x4", "box-brown.jpg"], ["BOX001-WH-664", "BOX001", "Box", "Boxes", "6x6x4 W", ""], ["BOX001-XX", "BOX001", "Box", "Boxes", "9x9x9", "missing.jpg"]] }));
  const products = groupProducts(wb, autoMap(wb.products.headers));
  const img = (path) => { const ext = path.split(".").pop().toLowerCase(); return { path, base: path.replace(/\.[^.]+$/, "").toLowerCase(), ext, data: new Uint8Array([1]) }; };
  const images = new Map([img("Box-Brown.JPG"), img("box001-wh-664.jpg"), img("BOX001.png")].map((i) => [`${i.base}.${i.ext}`, i]));
  const res = matchZipImages(products, { images, skipped: [], spreadsheet: null, totalUncompressedBytes: 0 });
  const box = products[0];
  assert.equal(box.variants[0].image, "zip:box-brown.jpg", "file name, case-insensitive");
  assert.equal(box.variants[1].image, "zip:box001-wh-664.jpg", "matched by SKU");
  assert.equal(box.variants[2].image, undefined);
  assert.deepEqual(res.unmatched, ["missing.jpg"]);
  assert.equal(res.matched, 2, "product-level fallback comes from the variants; BOX001.png is only used when no variant image exists");
  applyImageUrls(products, new Map([["box-brown.jpg", "http://x/1.jpg"], ["box001-wh-664.jpg", "http://x/2.jpg"]]));
  assert.equal(box.variants[0].image, "http://x/1.jpg"); assert.deepEqual(box.images, ["http://x/1.jpg", "http://x/2.jpg"]);
  const payload = toPayload(products);
  assert.equal(payload[0].variants[2].image, undefined); assert.equal(payload[0].variants.length, 3);
});

test("templates: simple + variable workbooks with the 'How to Import Products' sheet", () => {
  const simple = buildTemplate("simple"); const variable = buildTemplate("variable");
  assert.deepEqual(simple.SheetNames, ["Products", "How to Import Products"]);
  assert.deepEqual(variable.SheetNames, ["Products", "Variants", "Single-sheet example", "How to Import Products"]);
  // The variable template round-trips through the parser into one product with 4 variants + one with 3.
  const wb = parseWorkbook(new Uint8Array(XLSX.write(variable, { type: "array", bookType: "xlsx" })));
  assert.equal(wb.format, "two-sheet");
  const products = groupProducts(wb, autoMap(wb.products.headers), autoMap(wb.variants.headers));
  assert.deepEqual(products.map((p) => [p.productId, p.variants.length]), [["BOX001", 4], ["TAPE002", 3]]);
});
