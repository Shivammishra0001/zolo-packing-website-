// The export is where a reporting convention quietly becomes wrong: a blank
// written as 0, money written as text, a date written in an ambiguous format.
// These assert the cell TYPES, not just the values.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildFinancialWorkbook, REPORT_HEADERS } from "./financial-xlsx.ts";

const row = (over = {}) => ({
  customerId: "cus_1",
  customerName: "Acme Packaging",
  orderNumber: "ORD-0001",
  orderDate: "2026-09-15T00:00:00.000Z",
  productName: "5 Ply Box",
  quantity: 100,
  rateMinor: 3000,
  saleMinor: 300000,
  costMinor: 240000,
  receivedMinor: 150000,
  balanceMinor: 150000,
  paymentMode: "upi",
  paymentReceivedBy: "Sushil Shukla",
  profitMinor: 60000,
  deliveryDate: "2026-09-20T00:00:00.000Z",
  salesperson: "Sushil Shukla",
  orderStatus: "DELIVERED",
  remarks: "handle with care",
  collectionStatus: "Part collected",
  ...over,
});

const sheetOf = (wb) => wb.Sheets[wb.SheetNames[0]];
const cell = (ws, r, c) => ws[XLSX.utils.encode_cell({ r, c })];

test("the header is exactly the 19 specified columns, in order", () => {
  const ws = sheetOf(buildFinancialWorkbook([row()]));
  const got = REPORT_HEADERS.map((_, c) => cell(ws, 0, c)?.v);
  assert.deepEqual(got, [...REPORT_HEADERS]);
  assert.equal(got.length, 19);
});

test("money is a NUMBER in rupees with an INR format, not a formatted string", () => {
  const ws = sheetOf(buildFinancialWorkbook([row()]));
  const sale = cell(ws, 1, 7); // "Sale"
  assert.equal(sale.t, "n", "cell type is numeric so Excel can SUM it");
  assert.equal(sale.v, 3000, "300000 paise renders as 3000 rupees");
  assert.match(String(sale.z), /₹/, "carries a rupee number format");
});

test("dates are real dates, not strings", () => {
  const ws = sheetOf(buildFinancialWorkbook([row()]));
  const d = cell(ws, 1, 3); // "Order Date"
  assert.equal(d.t, "d");
  assert.ok(d.v instanceof Date);
  assert.equal(d.v.toISOString().slice(0, 10), "2026-09-15");
});

test("an unknown cost leaves Cost and Profit BLANK, never zero", () => {
  // The whole point: 0 would claim the line was free and the sale was pure
  // profit. A blank says "not recorded", which is the truth.
  const ws = sheetOf(buildFinancialWorkbook([row({ costMinor: null, profitMinor: null })]));
  const cost = cell(ws, 1, 8);
  const profit = cell(ws, 1, 13);
  for (const [name, c] of [["Cost", cost], ["Profit", profit]]) {
    assert.ok(c == null || c.v === null || c.v === "" || c.v === undefined, `${name} is blank, got ${JSON.stringify(c)}`);
    if (c) assert.notEqual(c.v, 0, `${name} must never be written as 0`);
  }
});

test("order money appears once: later lines of the same order are blank", () => {
  // Three lines, one order, 1500 received. Attributed to the first line only,
  // so SUM over the column gives 1500 rather than 4500.
  const rows = [
    row({ receivedMinor: 150000, balanceMinor: 150000 }),
    row({ productName: "Box B", receivedMinor: null, balanceMinor: null }),
    row({ productName: "Box C", receivedMinor: null, balanceMinor: null }),
  ];
  const ws = sheetOf(buildFinancialWorkbook(rows));
  const received = [1, 2, 3].map((r) => cell(ws, r, 9)?.v ?? null);
  assert.equal(received[0], 1500);
  assert.equal(received[1], null);
  assert.equal(received[2], null);
  const total = received.reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
  assert.equal(total, 1500, "summing the column must not multiply the receipt");
});

test("every data row is written — nothing is truncated", () => {
  const rows = Array.from({ length: 2500 }, (_, i) => row({ orderNumber: `ORD-${i}` }));
  const ws = sheetOf(buildFinancialWorkbook(rows));
  const range = XLSX.utils.decode_range(ws["!ref"]);
  assert.equal(range.e.r, 2500, "2500 data rows plus one header");
  assert.equal(cell(ws, 2500, 2).v, "ORD-2499", "the last row is the last record");
});

test("a missing optional value is an empty string, not the text 'null'", () => {
  const ws = sheetOf(buildFinancialWorkbook([
    row({ salesperson: null, remarks: null, paymentMode: null, paymentReceivedBy: null, customerId: null }),
  ]));
  for (const c of [0, 11, 12, 15, 17]) {
    const v = cell(ws, 1, c)?.v;
    assert.equal(v, "", `column ${c} is blank, got ${JSON.stringify(v)}`);
  }
});

test("the workbook carries the convention on a second sheet", () => {
  const wb = buildFinancialWorkbook([row()]);
  assert.deepEqual(wb.SheetNames, ["Sales & Financial", "About"]);
});
