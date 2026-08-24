// ============================================================
// Canonical catalog normalization.
//
// ONE place that turns a raw catalog row (CSV/XLSX/API) into the exact shape
// the Product table stores. Import, the repair script and the product APIs all
// call this, so a field can never be mapped one way by the importer and
// another way by an edit form.
// ============================================================

/** Cells that mean "no value". Must normalize to null — never to 0 or "". */
const BLANK_TOKENS = new Set(["", "-", "--", "—", "–", "n/a", "na", "n.a.", "null", "nil", "none", "tbd", "?"]);

export const isBlank = (v) => v == null || BLANK_TOKENS.has(String(v).trim().toLowerCase());

/** Trimmed text, or null when the cell is blank/placeholder. */
export const text = (v) => (isBlank(v) ? null : String(v).trim());

/**
 * Optional integer. Blank/placeholder → null (ABSENT), never 0 — a 0 GSM board
 * or 0 MOQ is invented data. Unparseable text also → null.
 */
export function int(v) {
  if (isBlank(v)) return null;
  const cleaned = String(v).replace(/,/g, "").replace(/[^0-9.\-+]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** URL-safe slug. Deterministic: the same name always yields the same slug. */
export function slugify(value, fallback = "item") {
  const s = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

/** Canonical comparison key: "  BOXES " and "boxes" collapse to one. */
export const categoryKey = (name) => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const UNIT_ALIASES = { inch: "in", inches: "in", in: "in", '"': "in", cm: "cm", centimeter: "cm", mm: "mm", millimeter: "mm" };

/**
 * Parse a Size cell.
 *
 * Returns { dimensions, sizeLabel }. `dimensions` is populated ONLY for a real
 * 3-axis measurement; a capacity ("12 oz", "500 ml"), a paper size ("A4") or a
 * 2D sheet ("3 x 4 inch") is not a length/width/height and would be garbage in
 * those columns — it is preserved verbatim in sizeLabel instead.
 *
 * The raw text is ALWAYS returned as sizeLabel so nothing from the source is
 * lost, including for rows that do parse.
 */
export function parseSize(raw) {
  const label = text(raw);
  if (!label) return { dimensions: null, sizeLabel: null };

  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*([a-z"]+)?\s*$/i.exec(label);
  if (!m) return { dimensions: null, sizeLabel: label }; // capacity / 2D / A4 / free text

  const unitRaw = (m[4] ?? "in").toLowerCase();
  const unit = UNIT_ALIASES[unitRaw];
  // A trailing token we don't recognise as a length unit (e.g. "12 x 4 x 4 oz")
  // means this is not a dimension we can trust.
  if (!unit) return { dimensions: null, sizeLabel: label };

  return {
    dimensions: { length: Number(m[1]), width: Number(m[2]), height: Number(m[3]), unit },
    sizeLabel: label,
  };
}

const VALID_STATUS = new Set(["draft", "active", "archived"]);

/**
 * Normalize one catalog row into Product columns.
 *
 * Accepts either canonical keys (sku, name, …) or raw spreadsheet headers
 * ("Product Name", "GSM", …) so CSV, XLSX and API callers share one mapping.
 * Returns `{ data, category, subcategory, warnings }` — `data` holds only
 * Product columns; the two taxonomy names are resolved to records by the
 * caller (which owns the transaction).
 */
export function normalizeRow(raw) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return raw[k];
    }
    return undefined;
  };
  const warnings = [];

  const sku = text(pick("sku", "SKU"));
  const name = text(pick("name", "Product Name", "productName"));
  const category = text(pick("category", "Category"));
  const subcategory = text(pick("subcategory", "Subcategory"));

  const { dimensions, sizeLabel } = parseSize(pick("size", "Size", "sizeLabel"));
  if (sizeLabel && !dimensions) {
    warnings.push(`Size "${sizeLabel}" is not a 3-axis measurement — kept as a size label`);
  }

  const gsm = int(pick("gsm", "GSM"));
  const moq = int(pick("moq", "MOQ"));
  const stockRaw = pick("stock", "Stock", "Stock Quantity");
  const stock = int(stockRaw);

  const statusRaw = (text(pick("status", "Status")) ?? "draft").toLowerCase();
  const status = VALID_STATUS.has(statusRaw) ? statusRaw : "draft";
  if (!VALID_STATUS.has(statusRaw)) warnings.push(`Unknown status "${statusRaw}" — imported as draft`);

  // Price: absent means QUOTATION-BASED. basePriceMinor 0 is the encoding for
  // "on quote" and must render as "On quote", never ₹0.
  const priceRaw = pick("basePriceMinor", "priceMinor");
  const rupees = pick("price", "Price");
  let basePriceMinor = null;
  if (!isBlank(priceRaw)) basePriceMinor = int(priceRaw);
  else if (!isBlank(rupees)) {
    const n = Number(String(rupees).replace(/[^0-9.]/g, ""));
    basePriceMinor = Number.isFinite(n) ? Math.round(n * 100) : null;
  }

  const data = {
    name,
    description: text(pick("description", "Description")),
    material: text(pick("material", "Material")),
    color: text(pick("color", "Color", "Colour")),
    productType: text(pick("type", "Type", "productType")),
    thickness: text(pick("thickness", "Thickness")),
    sizeLabel,
    gsm,
    status,
    // Dimensions are all-or-nothing: a partial set is worse than none.
    length: dimensions?.length ?? null,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    dimUnit: dimensions?.unit ?? null,
  };

  // Only include MOQ/stock/price when the SOURCE actually supplied them, so an
  // update never overwrites a real value with an invented default.
  if (moq !== null && moq >= 0) data.moq = moq;
  if (stock !== null && stock >= 0) data.stock = stock;
  if (basePriceMinor !== null && basePriceMinor >= 0) data.basePriceMinor = basePriceMinor;

  return { sku, name, category, subcategory, data, warnings };
}
