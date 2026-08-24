// Focused tests for the bulk-import validation + image matching (Node, no UI).
// Run: node --test src/admin/pages/catalog/bulk-import-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRows, matchImages, buildErrorReportCsv } from "./bulk-import-lib.ts";

const opts = (over = {}) => ({ existingSku: () => false, knownCategories: [], ...over });

test("missing image is a WARNING, never an error (row still importable)", () => {
  const rows = validateRows(
    [{ sku: "ZOLO-PIZ-001", name: "Pizza Box", category: "Food Packaging" }],
    opts({ zipImages: new Map([["other.jpg", { path: "other.jpg", base: "other", ext: "jpg", data: new Uint8Array() }]]) }),
  );
  assert.equal(rows[0].status, "warning");
  assert.ok(rows[0].messages.some((m) => m.startsWith("Image not found")));
});

test("missing SKU is an ERROR", () => {
  const rows = validateRows([{ name: "No SKU Box", category: "Boxes" }], opts());
  assert.equal(rows[0].status, "error");
  assert.ok(rows[0].messages.some((m) => m.includes("SKU is required")));
});

test("missing product name is an ERROR", () => {
  const rows = validateRows([{ sku: "ZOLO-X-1" }], opts());
  assert.equal(rows[0].status, "error");
});

test("valid row with no optional fields is READY (no ZIP)", () => {
  const rows = validateRows([{ sku: "ZOLO-A-1", name: "Box A", category: "Boxes" }], opts());
  assert.equal(rows[0].status, "ready");
});

test("unknown category is at most a WARNING, never an error", () => {
  const rows = validateRows(
    [{ sku: "ZOLO-A-1", name: "Box A", category: "Totally New Cat" }],
    opts({ knownCategories: ["Boxes"] }),
  );
  assert.notEqual(rows[0].status, "error");
});

test("empty category does NOT error (defaults to Uncategorised)", () => {
  const rows = validateRows([{ sku: "ZOLO-A-1", name: "Box A" }], opts());
  assert.notEqual(rows[0].status, "error");
  assert.equal(rows[0].data.category, "Uncategorised");
});

test("blank/whitespace price is fine (quotation-based); junk price warns but imports", () => {
  const ok = validateRows([{ sku: "S1", name: "N", price: "  " }], opts());
  assert.equal(ok[0].status, "ready");
  // Junk in an OPTIONAL field must not cost us the product — warn and import
  // as quotation-based rather than rejecting the row.
  const bad = validateRows([{ sku: "S2", name: "N", price: "abc" }], opts());
  assert.equal(bad[0].status, "warning");
  assert.equal(bad[0].price, null);
});

test("errors and warnings are split; missing image is warning not error", () => {
  const rows = validateRows(
    [{ sku: "S1", name: "Box", category: "Boxes" }],
    opts({ zipImages: new Map([["x.jpg", { path: "x.jpg", base: "x", ext: "jpg", data: new Uint8Array() }]]) }),
  );
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].warnings.length, 1);
  assert.ok(rows[0].warnings[0].startsWith("Image not found"));
  assert.equal(rows[0].status, "warning");
});

test("existing SKU is a WARNING (an update), never an error — importable", () => {
  const rows = validateRows([{ sku: "DUP", name: "Box", category: "Boxes" }], opts({ existingSku: () => true }));
  assert.equal(rows[0].status, "warning");
  assert.ok(rows[0].warnings.includes("SKU already exists"));
});

test("error report CSV has Row/SKU/Product/Status/Errors/Warnings columns", () => {
  const rows = validateRows(
    [{ name: "No SKU" }, { sku: "S2", name: "Warn Box", category: "Boxes" }],
    opts({ zipImages: new Map([["z.jpg", { path: "z.jpg", base: "z", ext: "jpg", data: new Uint8Array() }]]) }),
  );
  const csv = buildErrorReportCsv(rows);
  const [header, ...lines] = csv.split("\n");
  assert.equal(header, "Row,SKU,Product,Status,Level,Field,Error,Warning");
  assert.ok(lines.some((l) => l.includes("ERROR") && l.includes("SKU is required")));
  assert.ok(lines.some((l) => l.includes("WARNING") && l.includes("Image not found")));
});

test("importable count = ready + warning (errors excluded)", () => {
  const rows = validateRows(
    [
      { sku: "R1", name: "Ready", category: "Boxes" }, // ready
      { sku: "R2", name: "Warn", category: "New Cat" }, // warning (new category, known list set)
      { name: "Bad" }, // error (no sku)
    ],
    opts({ knownCategories: ["Boxes"] }),
  );
  const importable = rows.filter((r) => r.status !== "error").length;
  assert.equal(importable, 2);
  assert.equal(rows.filter((r) => r.status === "error").length, 1);
});

test("image matching: exact filename, then SKU fallback, case-insensitive, all exts", () => {
  const mk = (name) => [name.toLowerCase(), { path: name, base: name.replace(/\.[a-z]+$/i, "").toLowerCase(), ext: name.split(".").pop().toLowerCase(), data: new Uint8Array() }];
  const images = new Map([mk("ZOLO-BTL-001.JPG")]);
  // by SKU, case-insensitive, uppercase ext
  assert.equal(matchImages("ZOLO-BTL-001", undefined, images).primary, "zolo-btl-001.jpg");
  // webp/png fallback
  const images2 = new Map([mk("ZOLO-BTL-002.webp")]);
  assert.equal(matchImages("zolo-btl-002", undefined, images2).primary, "zolo-btl-002.webp");
});

// ============================================================
// Regression cover for the "47 errors" defect.
//
// The Zolo catalog leaves optional numeric columns as "-". The old validator
// ran Number("-") → NaN → "GSM must be numeric", which isBlockingMessage()
// swept up via its "must be" substring rule, killing 47 of 72 valid rows.
// ============================================================

test("placeholder '-' in an optional numeric is NOT an error and NOT zero", () => {
  const rows = validateRows(
    [{ sku: "ZOLO-BTL-001", name: "Bottle Box", category: "Boxes", gsm: "-", thickness: "-" }],
    opts(),
  );
  assert.equal(rows[0].status, "ready");
  assert.deepEqual(rows[0].errors, []);
  // Absent, not 0 — a 0 GSM board is a fabricated specification.
  assert.equal(rows[0].data.gsm, undefined);
});

test("every documented blank token normalizes to absent", () => {
  for (const token of ["-", "--", "—", "N/A", "NA", "n.a.", "null", "nil", "none", "TBD", "?", "   "]) {
    const rows = validateRows([{ sku: `S-${token}`, name: "N", category: "Boxes", gsm: token }], opts());
    assert.equal(rows[0].status, "ready", `token ${JSON.stringify(token)} should be ready`);
    assert.equal(rows[0].data.gsm, undefined, `token ${JSON.stringify(token)} should be absent`);
  }
});

test("a real GSM value still parses (and tolerates units/separators)", () => {
  const rows = validateRows(
    [
      { sku: "A", name: "N", category: "Boxes", gsm: "350" },
      { sku: "B", name: "N", category: "Boxes", gsm: "1,200" },
      { sku: "C", name: "N", category: "Boxes", gsm: "300 gsm" },
    ],
    opts(),
  );
  assert.equal(rows[0].data.gsm, 350);
  assert.equal(rows[1].data.gsm, 1200);
  assert.equal(rows[2].data.gsm, 300);
});

test("genuinely unparseable optional numeric warns but still imports", () => {
  const rows = validateRows([{ sku: "A", name: "N", category: "Boxes", gsm: "heavy" }], opts());
  assert.equal(rows[0].status, "warning");
  assert.deepEqual(rows[0].errors, []);
  assert.equal(rows[0].data.gsm, undefined);
});

test("a non-image Image value (e.g. .mp4) imports the product without an image", () => {
  const rows = validateRows(
    [{ sku: "ZOLO-DIG-009", name: "Banner Video", category: "Digital Files", image: "banner-video.mp4" }],
    opts(),
  );
  assert.notEqual(rows[0].status, "error");
  assert.deepEqual(rows[0].errors, []);
});

test("embedded workbook images are matched by spreadsheet row", () => {
  const rows = validateRows(
    [
      { sku: "A", name: "Has embedded", category: "Boxes" }, // sheet row 2
      { sku: "B", name: "No embedded", category: "Boxes" },  // sheet row 3
    ],
    opts({ embeddedByRow: new Map([[2, [{ key: "embedded:2:0" }]]]) }),
  );
  assert.equal(rows[0].imageMatch.primary, "embedded:2:0");
  assert.equal(rows[0].imageMatch.source, "embedded");
  assert.equal(rows[0].status, "ready");
  // Row without a picture is a warning, never an error.
  assert.equal(rows[1].imageMatch.primary, undefined);
  assert.equal(rows[1].status, "warning");
});

test("a SKU-named file wins over the Image column (priority 1)", () => {
  const img = (n) => ({ path: n, base: n.replace(/\.\w+$/, ""), ext: "jpg", data: new Uint8Array() });
  const rows = validateRows(
    [{ sku: "ZOLO-BTL-001", name: "N", category: "Boxes", image: "bottle box.jpg" }],
    opts({ zipImages: new Map([["zolo-btl-001.jpg", img("zolo-btl-001.jpg")], ["bottle box.jpg", img("bottle box.jpg")]]) }),
  );
  assert.equal(rows[0].imageMatch.primary, "zolo-btl-001.jpg");
  assert.equal(rows[0].imageMatch.source, "sku");
});

test("error report lists clean rows too and attributes a field", () => {
  const rows = validateRows(
    [{ sku: "OK", name: "Fine", category: "Boxes" }, { name: "Broken" }],
    opts(),
  );
  const csv = buildErrorReportCsv(rows);
  const lines = csv.split("\n").slice(1);
  assert.equal(lines.length, 2, "clean rows appear in the manifest as well");
  assert.ok(lines.some((l) => l.includes("READY")));
  assert.ok(lines.some((l) => l.includes("ERROR") && l.includes("SKU")));
});
