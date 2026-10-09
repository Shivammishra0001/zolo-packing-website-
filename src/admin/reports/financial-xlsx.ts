import * as XLSX from "xlsx";

// ===========================================================================
// Sales & Financial Details → .xlsx
//
// Built as a pure function over the rows so it can be unit-tested without a
// browser, matching buildTemplateWorkbook() in the catalog importer.
//
// Typing matters here. Writing money as the string "₹1,234" gives a sheet
// nobody can SUM; writing a date as "09/10/2026" is ambiguous between two
// conventions and sorts as text. So numbers go in as numbers with an INR
// format, and dates as real dates with a display format — Excel then
// right-aligns, sums and sorts them correctly.
//
// A blank cell is written for every unknown value. Never 0 — "no cost
// recorded" and "cost of zero" are different facts, and only one of them is
// true.
// ===========================================================================

/** The exact 19 columns, in the order the brief specifies. */
export const REPORT_HEADERS = [
  "Customer ID",
  "Customer Name",
  "Order ID",
  "Order Date",
  "Product Name",
  "Qty",
  "Rate per Unit",
  "Sale",
  "Cost",
  "Amount Received",
  "Balance Amount",
  "Payment Mode",
  "Payment Received By",
  "Profit",
  "Delivery Date",
  "Sales Person",
  "Order Status",
  "Remarks",
  "Collection Status",
] as const;

export interface ReportRow {
  customerId: string | null;
  customerName: string;
  orderNumber: string;
  orderDate: string | Date | null;
  productName: string;
  quantity: number;
  rateMinor: number;
  saleMinor: number;
  costMinor: number | null;
  receivedMinor: number | null;
  balanceMinor: number | null;
  paymentMode: string | null;
  paymentReceivedBy: string | null;
  profitMinor: number | null;
  deliveryDate: string | Date | null;
  salesperson: string | null;
  orderStatus: string;
  remarks: string | null;
  collectionStatus: string;
}

/** Indian accounting format: ₹12,34,567.89, with blanks left blank. */
const INR_FORMAT = '"₹"#,##,##0.00';
const DATE_FORMAT = "dd-mmm-yyyy";

/** Paise → rupees as a NUMBER, or null so the cell stays empty. */
const money = (minor: number | null | undefined) =>
  minor == null ? null : Number((minor / 100).toFixed(2));

const asDate = (v: string | Date | null | undefined) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Order-level columns repeat the order id across its lines, so a reader can
 * group them, but Received/Balance are populated only on the order's first
 * row — see the reporting convention in the backend service. This note is
 * written into the sheet so whoever opens it later knows why.
 */
export const CONVENTION_NOTE =
  "One row per order line. Qty / Rate / Sale / Cost / Profit are per line. " +
  "Amount Received and Balance belong to the whole order and appear only on " +
  "its first row — a blank means 'see the first row for this Order ID', not zero. " +
  "A blank Cost or Profit means no cost was recorded for that line.";

export function buildFinancialWorkbook(rows: ReportRow[]): XLSX.WorkBook {
  const aoa: unknown[][] = [
    [...REPORT_HEADERS],
    ...rows.map((r) => [
      r.customerId ?? "",
      r.customerName,
      r.orderNumber,
      asDate(r.orderDate),
      r.productName,
      r.quantity,
      money(r.rateMinor),
      money(r.saleMinor),
      money(r.costMinor),
      money(r.receivedMinor),
      money(r.balanceMinor),
      r.paymentMode ?? "",
      r.paymentReceivedBy ?? "",
      money(r.profitMinor),
      asDate(r.deliveryDate),
      r.salesperson ?? "",
      r.orderStatus,
      r.remarks ?? "",
      r.collectionStatus,
    ]),
  ];

  // cellDates lets real Date objects through as dates rather than strings.
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

  // Apply number formats per column. XLSX has no column-level format, so each
  // data cell is stamped — cheap, and the only way the sheet opens correctly.
  const MONEY_COLS = [6, 7, 8, 9, 10, 13]; // Rate, Sale, Cost, Received, Balance, Profit
  const DATE_COLS = [3, 14]; // Order Date, Delivery Date
  for (let r = 1; r <= rows.length; r++) {
    for (const c of MONEY_COLS) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (cell && cell.v != null && cell.v !== "") {
        cell.t = "n";
        cell.z = INR_FORMAT;
      }
    }
    for (const c of DATE_COLS) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref];
      if (cell && cell.v != null && cell.v !== "") {
        cell.t = "d";
        cell.z = DATE_FORMAT;
      }
    }
  }

  // Readable widths; without these every money column opens as "####".
  ws["!cols"] = [
    { wch: 26 }, { wch: 26 }, { wch: 16 }, { wch: 13 }, { wch: 30 },
    { wch: 8 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 15 },
    { wch: 15 }, { wch: 14 }, { wch: 20 }, { wch: 13 }, { wch: 13 },
    { wch: 18 }, { wch: 14 }, { wch: 40 }, { wch: 16 },
  ];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: REPORT_HEADERS.length - 1 } }) };
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sales & Financial");

  // The convention on its own sheet, so the data sheet stays machine-readable
  // while the caveat still travels with the file.
  const notes = XLSX.utils.aoa_to_sheet([
    ["Sales & Financial Details"],
    ["Exported", new Date()],
    ["Rows", rows.length],
    [],
    ["Reporting convention"],
    [CONVENTION_NOTE],
  ]);
  notes["!cols"] = [{ wch: 22 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, notes, "About");

  return wb;
}

/** Filename carrying the export date, so successive exports do not overwrite. */
export const financialReportFilename = (now = new Date()) =>
  `zolo-sales-financial-${now.toISOString().slice(0, 10)}.xlsx`;
