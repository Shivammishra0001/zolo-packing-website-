// Tests for embedded-image extraction from XLSX workbooks.
// Run: npx tsx --test src/admin/pages/catalog/xlsx-embedded-images.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { extractEmbeddedImages, indexEmbeddedImagesByRow } from "./xlsx-embedded-images.ts";

// Minimal 1x1 JPEG (SOI + APP0 + EOI is enough — we never decode pixels).
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** Build a synthetic .xlsx containing `n` pictures anchored to consecutive rows. */
function makeWorkbook({ n = 2, prefix = "", col = 12 } = {}) {
  const anchors = Array.from({ length: n }, (_, i) =>
    `<${prefix}oneCellAnchor><${prefix}from><${prefix}col>${col}</${prefix}col><${prefix}colOff>0</${prefix}colOff>` +
    `<${prefix}row>${i + 1}</${prefix}row><${prefix}rowOff>0</${prefix}rowOff></${prefix}from>` +
    `<${prefix}ext cx="100" cy="100"/><${prefix}pic><${prefix}blipFill>` +
    `<a:blip r:embed="rId${i + 1}"/></${prefix}blipFill></${prefix}pic></${prefix}oneCellAnchor>`,
  ).join("");

  const rels = Array.from({ length: n }, (_, i) =>
    `<Relationship Target="/xl/media/image${i + 1}.jpeg" Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>`,
  ).join("");

  const files = {
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData/><drawing r:id="rIdD1"/></worksheet>`),
    "xl/worksheets/_rels/sheet1.xml.rels": strToU8(
      `<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rIdD1"/></Relationships>`,
    ),
    "xl/drawings/drawing1.xml": strToU8(`<wsDr>${anchors}</wsDr>`),
    "xl/drawings/_rels/drawing1.xml.rels": strToU8(`<Relationships>${rels}</Relationships>`),
  };
  for (let i = 1; i <= n; i++) files[`xl/media/image${i}.jpeg`] = JPEG;
  return zipSync(files);
}

test("extracts images from UNPREFIXED anchors (non-Excel writers)", () => {
  const imgs = extractEmbeddedImages(makeWorkbook({ n: 3 }));
  assert.equal(imgs.length, 3);
  assert.deepEqual(imgs.map((i) => i.anchorRow), [1, 2, 3]);
  assert.equal(imgs[0].ext, "jpeg");
});

test("extracts images from xdr:-prefixed anchors (Excel's own output)", () => {
  const imgs = extractEmbeddedImages(makeWorkbook({ n: 2, prefix: "xdr:" }));
  assert.equal(imgs.length, 2);
});

test("image bytes are preserved verbatim (no re-encoding)", () => {
  const imgs = extractEmbeddedImages(makeWorkbook({ n: 1 }));
  assert.deepEqual([...imgs[0].data], [...JPEG]);
});

test("anchor rows map to 1-indexed spreadsheet rows (header offset)", () => {
  const byRow = indexEmbeddedImagesByRow(extractEmbeddedImages(makeWorkbook({ n: 2 })));
  // anchorRow 1 (0-indexed, under the header) === spreadsheet row 2 === first data row
  assert.ok(byRow.has(2));
  assert.ok(byRow.has(3));
  assert.equal(byRow.get(2).length, 1);
});

test("non-zip input returns [] instead of throwing (csv/xls path)", () => {
  assert.deepEqual(extractEmbeddedImages(strToU8("sku,name\nA,B")), []);
});

test("workbook with no drawing layer returns []", () => {
  const wb = zipSync({ "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData/></worksheet>") });
  assert.deepEqual(extractEmbeddedImages(wb), []);
});
