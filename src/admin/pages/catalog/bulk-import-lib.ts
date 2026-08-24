import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8 } from "fflate";
import type { CatalogProduct, ProductStatus } from "../../types";

// ============================================================
// Bulk-import core logic (pure, UI-free) — spreadsheet + ZIP parsing,
// validation, SKU↔image matching, templates and error reports.
// Kept free of store/React imports so it is testable in plain Node.
// ============================================================

// ---------- Limits ----------
export const LIMITS = {
  SPREADSHEET_MAX_BYTES: 10 * 1024 * 1024, // 10 MB
  ZIP_MAX_BYTES: 50 * 1024 * 1024, // 50 MB
  ZIP_UNCOMPRESSED_MAX_BYTES: 200 * 1024 * 1024, // zip-bomb guard
  IMAGE_MAX_BYTES: 5 * 1024 * 1024, // per image
  MAX_PRODUCTS: 2000,
  MAX_IMAGES: 500,
} as const;

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"] as const;
export const SPREADSHEET_EXTS = ["xlsx", "xls", "csv"] as const;

const VALID_STATUS: ProductStatus[] = ["draft", "active", "archived"];

// ---------- Header mapping (case-insensitive, whitespace-tolerant) ----------
function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_MAP: Record<string, string> = {
  sku: "sku",
  productname: "name", name: "name",
  category: "category",
  subcategory: "subcategory",
  type: "type",
  description: "description", desc: "description",
  shortdescription: "shortDescription", shortdesc: "shortDescription",
  material: "material",
  length: "length", width: "width", height: "height",
  dimensionunit: "unit", unit: "unit",
  gsm: "gsm",
  thickness: "thickness",
  color: "color", colour: "color",
  size: "size", dimensions: "size",
  price: "price", // OPTIONAL — Zolo is quotation-based; never required
  moq: "moq",
  stockquantity: "stock", stock: "stock", stockqty: "stock",
  lowstocklevel: "lowStockLevel", lowstock: "lowStockLevel",
  productstatus: "status", status: "status",
  image: "imageName", primaryimageurl: "imageName", primaryimage: "imageName",
  additionalimageurls: "imageNames", additionalimages: "imageNames",
};

export interface RawRow {
  [key: string]: string | number;
}

/** Parse an xlsx/xls/csv buffer into header-mapped raw rows. */
export function parseSpreadsheetBuffer(data: ArrayBuffer | Uint8Array): RawRow[] {
  const wb = XLSX.read(data, { type: data instanceof Uint8Array ? "array" : "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((raw) => {
    const mapped: RawRow = {};
    for (const [k, v] of Object.entries(raw)) {
      const canon = HEADER_MAP[normHeader(k)];
      if (canon) mapped[canon] = typeof v === "string" ? v.trim() : (v as string | number);
    }
    return mapped;
  });
}

// ---------- ZIP parsing (secure) ----------

export interface ZipImage {
  /** original entry path inside the zip */
  path: string;
  /** lowercase base filename without extension, e.g. "zolo-gb-001" */
  base: string;
  ext: string;
  data: Uint8Array;
}

export interface ZipContents {
  spreadsheet: { name: string; data: Uint8Array } | null;
  /** keyed by lowercase "base.ext" filename */
  images: Map<string, ZipImage>;
  /** entries ignored for safety/format reasons (path + reason) */
  skipped: { path: string; reason: string }[];
  totalUncompressedBytes: number;
}

function entryExt(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Safely read a zip buffer. Never writes to disk; still sanitizes paths
 * (Zip-Slip style entries with ".." / absolute paths are rejected), skips
 * unexpected file types, and enforces size/count limits.
 */
export function parseZip(u8: Uint8Array): ZipContents {
  const out: ZipContents = { spreadsheet: null, images: new Map(), skipped: [], totalUncompressedBytes: 0 };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(u8);
  } catch {
    throw new Error("Corrupted or unsupported ZIP file.");
  }

  for (const [path, data] of Object.entries(files)) {
    // Path traversal / absolute path guard (defense-in-depth; we never write to disk)
    if (path.includes("..") || path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
      out.skipped.push({ path, reason: "unsafe path" });
      continue;
    }
    if (path.endsWith("/") || data.length === 0) continue; // directory entries
    // macOS zip noise
    if (path.startsWith("__MACOSX/") || baseName(path).startsWith(".")) {
      out.skipped.push({ path, reason: "system file" });
      continue;
    }

    out.totalUncompressedBytes += data.length;
    if (out.totalUncompressedBytes > LIMITS.ZIP_UNCOMPRESSED_MAX_BYTES) {
      throw new Error("ZIP uncompressed size exceeds the allowed limit.");
    }

    const ext = entryExt(path);
    if ((SPREADSHEET_EXTS as readonly string[]).includes(ext)) {
      if (data.length > LIMITS.SPREADSHEET_MAX_BYTES) {
        out.skipped.push({ path, reason: "spreadsheet too large" });
        continue;
      }
      // Prefer a file literally named products.*, else first spreadsheet found
      const isCanonical = /^(.*\/)?products\.(xlsx|xls|csv)$/i.test(path);
      if (!out.spreadsheet || isCanonical) out.spreadsheet = { name: path, data };
    } else if ((IMAGE_EXTS as readonly string[]).includes(ext)) {
      if (data.length > LIMITS.IMAGE_MAX_BYTES) {
        out.skipped.push({ path, reason: "image exceeds 5 MB" });
        continue;
      }
      if (out.images.size >= LIMITS.MAX_IMAGES) {
        out.skipped.push({ path, reason: "image count limit reached" });
        continue;
      }
      const file = baseName(path).toLowerCase();
      out.images.set(file, {
        path,
        base: file.replace(/\.[a-z0-9]+$/i, ""),
        ext,
        data,
      });
    } else {
      // executables / scripts / anything unexpected — never processed
      out.skipped.push({ path, reason: `unsupported file type .${ext || "?"}` });
    }
  }
  return out;
}

// ---------- Image matching ----------

export interface ImageMatch {
  /** zip map key of the primary image, if found */
  primary?: string;
  /** zip map keys of gallery images (SKU-2.jpg, SKU-3.jpg …) */
  gallery: string[];
  /** how the primary image was resolved (for the preview's Image Status column) */
  source?: "sku" | "column" | "embedded" | "url";
}

/**
 * Match a row to zip images. Priority: explicit Image column value, then SKU
 * filename. Case-insensitive. `SKU-2.*`, `SKU-3.*` … become gallery images.
 */
export function matchImages(
  sku: string,
  imageColumn: string | undefined,
  images: Map<string, ZipImage>,
): ImageMatch {
  const match: ImageMatch = { gallery: [] };
  if (images.size === 0) return match;

  const findByName = (name: string): string | undefined => {
    const lower = name.trim().toLowerCase();
    if (!lower) return undefined;
    if (images.has(lower)) return lower; // exact filename w/ extension
    for (const ext of IMAGE_EXTS) {
      if (images.has(`${lower}.${ext}`)) return `${lower}.${ext}`; // name without ext
    }
    return undefined;
  };

  // Priority 1 — SKU-named file (most reliable: the filename IS the identity).
  if (sku) {
    const bySku = findByName(sku);
    if (bySku) { match.primary = bySku; match.source = "sku"; }
  }
  // Priority 2 — the Image column's filename.
  if (!match.primary && imageColumn) {
    const byCol = findByName(imageColumn);
    if (byCol) { match.primary = byCol; match.source = "column"; }
  }

  // Gallery: "<base>-N" variants of whichever base matched (or the SKU).
  // NOTE: no suffix-stripping here — SKUs legitimately end in digits
  // (ZOLO-001), so the variant base is the primary's base verbatim.
  const base = match.primary ? images.get(match.primary)!.base : sku.trim().toLowerCase();
  if (base) {
    const variants: { n: number; key: string }[] = [];
    for (const [key, img] of images) {
      if (key === match.primary) continue;
      const m = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`).exec(img.base);
      if (m) variants.push({ n: Number(m[1]), key });
    }
    match.gallery = variants.sort((a, b) => a.n - b.n).map((v) => v.key);
  }
  return match;
}

// ---------- Row validation ----------

export type RowStatus = "ready" | "warning" | "error";

// A message is a BLOCKING error (row cannot import) when it matches one of these
// patterns; everything else is a non-blocking warning (row still imports).
// Missing image, missing description, new category, "SKU already exists" (an
// update, not a failure) are all warnings — never errors.
function isBlockingMessage(m: string): boolean {
  // Substring matching on "must be" previously swept up soft data-quality
  // notes (notably "GSM must be numeric") and killed otherwise-valid rows.
  // Blocking is now an explicit, closed list: a row fails ONLY when it lacks
  // an identity field or would corrupt the catalog. Everything else — bad
  // optional numerics, missing images, unknown categories, existing SKUs — is
  // a warning, and the row still imports.
  return (
    m.includes("SKU is required") ||
    m.includes("Product Name is required") ||
    m.includes("Duplicate SKU within file")
  );
}

export interface ParsedRow {
  row: number; // 1-indexed spreadsheet row (incl. header offset)
  sku: string;
  name: string;
  category: string;
  price: number | null; // null = quotation-based (no fixed price)
  stock: number;
  imageName?: string;
  status: RowStatus;
  messages: string[]; // all messages (errors + warnings), for back-compat
  errors: string[]; // blocking messages only
  warnings: string[]; // non-blocking messages only
  isDuplicate: boolean; // SKU already exists in catalog
  data: Partial<CatalogProduct>;
  imageMatch: ImageMatch;
}

/**
 * Values spreadsheets use to mean "nothing". Authors type these into optional
 * columns instead of leaving them empty, so they must normalize to null — NOT
 * to 0, which would silently invent a real measurement (a 0 GSM board).
 */
const BLANK_TOKENS = new Set(["", "-", "--", "—", "–", "n/a", "na", "n.a.", "null", "nil", "none", "tbd", "?"]);

/** True when a cell is empty or holds a "no value" placeholder. */
export function isBlankValue(v: unknown): boolean {
  if (v == null) return true;
  return BLANK_TOKENS.has(String(v).trim().toLowerCase());
}

/** Trim an optional text cell; blank/placeholder text becomes undefined. */
export function cleanOptional(v: unknown): string | undefined {
  if (isBlankValue(v)) return undefined;
  return String(v).trim();
}

/**
 * Coerce an optional numeric cell. Blank/placeholder → null (absent, not zero).
 * Unparseable text → NaN so the caller can flag it. Tolerates thousands
 * separators and stray units ("350 gsm", "1,200").
 */
const optionalNum = (v: unknown): number | null => {
  if (isBlankValue(v)) return null;
  const cleaned = String(v).trim().replace(/,/g, "").replace(/[^0-9.\-+eE]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return NaN;
  return Number(cleaned);
};


/** Parse "10 x 8 x 4 inch" style size strings. */
function parseSize(s: string): CatalogProduct["dimensions"] | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(inch|inches|in|cm|mm)?\s*$/i.exec(s);
  if (!m) return undefined;
  const unitRaw = (m[4] ?? "in").toLowerCase();
  const unit = unitRaw.startsWith("in") ? "in" : unitRaw === "cm" ? "cm" : "mm";
  return { length: Number(m[1]), width: Number(m[2]), height: Number(m[3]), unit };
}

export interface ValidateOptions {
  /** returns true when a SKU already exists in the catalog */
  existingSku: (sku: string) => boolean;
  /** known category names (empty list ⇒ any category accepted) */
  knownCategories: string[];
  /** zip images available for matching (empty in plain-spreadsheet mode) */
  zipImages?: Map<string, ZipImage>;
  /**
   * Images embedded inside the workbook, keyed by 1-indexed spreadsheet row.
   * Used when the Image column names a file we don't have — the picture sitting
   * on the row IS the product's image.
   */
  embeddedByRow?: Map<number, { key: string }[]>;
}

export function validateRows(rawRows: RawRow[], opts: ValidateOptions): ParsedRow[] {
  const seenSkus = new Set<string>();
  const zipImages = opts.zipImages ?? new Map<string, ZipImage>();

  return rawRows.slice(0, LIMITS.MAX_PRODUCTS).map((raw, index) => {
    const messages: string[] = [];
    const sku = String(raw.sku ?? "").trim();
    const name = String(raw.name ?? "").trim();
    const category = cleanOptional(raw.category) ?? "";
    const imageName = cleanOptional(raw.imageName);
    const statusStr = (cleanOptional(raw.status) ?? "draft").toLowerCase();

    // Required fields
    if (!sku) messages.push("SKU is required");
    if (!name) messages.push("Product Name is required");

    // Duplicate SKU inside the spreadsheet itself → hard error
    const skuKey = sku.toLowerCase();
    if (sku && seenSkus.has(skuKey)) messages.push("Duplicate SKU within file");
    if (sku) seenSkus.add(skuKey);

    // Category: unknown is a WARNING (imports may introduce new categories)
    if (
      category &&
      opts.knownCategories.length > 0 &&
      !opts.knownCategories.some((c) => c.toLowerCase() === category.toLowerCase())
    ) {
      messages.push(`New category "${category}"`);
    }

    // Price is OPTIONAL (quotation-based). Only validate when provided.
    // Price is OPTIONAL (quotation-based catalog). A blank or placeholder means
    // "quote on request" — never an error, and never rendered as ₹0.
    let price: number | null = null;
    const priceNum = optionalNum(raw.price);
    if (priceNum !== null) {
      if (Number.isNaN(priceNum) || priceNum < 0) {
        messages.push(`Price "${String(raw.price).trim()}" is not a valid amount — imported as quotation-based`);
      } else price = priceNum;
    }

    // Optional numerics: a blank or placeholder ("-", "N/A") is ABSENT, not an
    // error and not 0. Only genuinely unparseable text warns, and even then the
    // row still imports with the field left null — we never invent a value.
    const stockNum = optionalNum(raw.stock);
    if (stockNum !== null && Number.isNaN(stockNum)) messages.push(`Stock "${String(raw.stock).trim()}" is not a number — imported as 0`);
    else if (stockNum !== null && stockNum < 0) messages.push("Stock is negative — imported as 0");
    const stock = stockNum !== null && !Number.isNaN(stockNum) && stockNum >= 0 ? stockNum : 0;

    const moqNum = optionalNum(raw.moq);
    if (moqNum !== null && (Number.isNaN(moqNum) || moqNum < 0)) messages.push(`MOQ "${String(raw.moq).trim()}" is not a valid number — using default`);

    for (const dim of ["length", "width", "height"] as const) {
      const d = optionalNum(raw[dim]);
      if (d !== null && Number.isNaN(d)) messages.push(`${dim} "${String(raw[dim]).trim()}" is not numeric — left blank`);
    }

    const gsmNum = optionalNum(raw.gsm);
    if (gsmNum !== null && Number.isNaN(gsmNum)) messages.push(`GSM "${String(raw.gsm).trim()}" is not numeric — left blank`);
    // Unknown status falls back to draft rather than failing the row — an admin
    // can flip it to active later, but the product data is not lost on import.
    if (!VALID_STATUS.includes(statusStr as ProductStatus)) {
      messages.push(`Unknown status "${statusStr}" — imported as draft (use draft/active/archived)`);
    }

    // Image column format check
    if (imageName && !/^https?:\/\//i.test(imageName)) {
      const ext = entryExt(imageName);
      if (ext && !(IMAGE_EXTS as readonly string[]).includes(ext)) {
        // Not a still image (e.g. a .mp4 asset row). The IMAGE is unusable, but
        // the PRODUCT is fine — import it and flag the image as missing.
        messages.push(`Image "${imageName}" is not a supported image format — imported without an image`);
      }
    }

    // Resolve the product image. Priority: SKU-named file → Image column →
    // image embedded on this spreadsheet row → external URL. A missing image is
    // ALWAYS a warning; the product still imports (Priority 4 = manual upload).
    const sheetRow = index + 2; // +1 for 0-index, +1 for the header row
    const imageMatch: ImageMatch =
      zipImages.size > 0 ? matchImages(sku, imageName, zipImages) : { gallery: [] };

    if (!imageMatch.primary) {
      const embedded = opts.embeddedByRow?.get(sheetRow);
      if (embedded && embedded.length > 0) {
        imageMatch.primary = embedded[0].key;
        imageMatch.source = "embedded";
        if (embedded.length > 1) imageMatch.gallery = embedded.slice(1).map((e) => e.key);
      }
    }
    if (!imageMatch.primary && imageName && /^https?:\/\//i.test(imageName)) {
      imageMatch.primary = imageName;
      imageMatch.source = "url";
    }

    const hasImageSource = zipImages.size > 0 || (opts.embeddedByRow?.size ?? 0) > 0;
    if (hasImageSource && !imageMatch.primary) messages.push("Image not found — product imported without an image");

    const isDuplicate = !!sku && opts.existingSku(sku);
    if (isDuplicate) messages.push("SKU already exists");

    // Split messages into blocking errors vs non-blocking warnings so the UI
    // and report can show each clearly. A row imports unless it has an error.
    const errors = messages.filter(isBlockingMessage);
    const warnings = messages.filter((m) => !isBlockingMessage(m));
    const rowStatus: RowStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ready";

    // Structured dimensions from Length/Width/Height columns or Size string
    const dims =
      !isBlankValue(raw.length) && !isBlankValue(raw.width) && !isBlankValue(raw.height)
        ? (() => {
            const l = optionalNum(raw.length), w = optionalNum(raw.width), h = optionalNum(raw.height);
            return l != null && w != null && h != null && ![l, w, h].some(Number.isNaN)
              ? { length: l, width: w, height: h, unit: (String(raw.unit || "in").trim().toLowerCase() as "in" | "cm" | "mm") }
              : undefined;
          })()
        : !isBlankValue(raw.size)
          ? parseSize(String(raw.size))
          : undefined;

    // Fold unmapped-but-useful fields into the description tail
    const extras = [
      cleanOptional(raw.material) ? `Material: ${cleanOptional(raw.material)}` : null,
      cleanOptional(raw.thickness) ? `Thickness: ${cleanOptional(raw.thickness)}` : null,
      cleanOptional(raw.type) ? `Type: ${cleanOptional(raw.type)}` : null,
    ].filter(Boolean).join(" · ");
    const description =
      [cleanOptional(raw.description) || cleanOptional(raw.shortDescription), extras]
        .filter(Boolean)
        .join(" — ") || undefined;

    return {
      row: index + 2,
      sku, name, category,
      price,
      stock,
      imageName,
      status: rowStatus,
      messages,
      errors,
      warnings,
      isDuplicate,
      imageMatch,
      data: {
        sku, name,
        category: category || "Uncategorised",
        subcategory: cleanOptional(raw.subcategory) || "General",
        description,
        dimensions: dims,
        // null/NaN ⇒ leave undefined so the column stays NULL in Postgres.
        gsm: gsmNum !== null && !Number.isNaN(gsmNum) ? Math.round(gsmNum) : undefined,
        material: cleanOptional(raw.material),
        color: cleanOptional(raw.color),
        // null price ⇒ quotation-based product; stored as 0 and rendered as
        // "Request a Quote" everywhere (never ₹0).
        basePrice: price ?? 0,
        moq: moqNum !== null && !Number.isNaN(moqNum) && moqNum >= 0 ? Math.round(moqNum) : 500,
        stock,
        lowStockLevel: (() => {
          const v = optionalNum(raw.lowStockLevel);
          return v !== null && !Number.isNaN(v) ? Math.round(v) : undefined;
        })(),
        status: (VALID_STATUS.includes(statusStr as ProductStatus) ? statusStr : "draft") as ProductStatus,
      },
    };
  });
}

// ---------- Error report ----------

/**
 * Build a CSV report of every row that has issues, with errors and warnings in
 * separate columns so an admin can see exactly why each row failed or warned.
 * Columns: Row, SKU, Product, Status, Errors, Warnings.
 */
export function buildErrorReportCsv(rows: ParsedRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const statusLabel = (s: RowStatus) => (s === "error" ? "ERROR" : s === "warning" ? "WARNING" : "READY");

  // Best-effort field attribution so an admin can jump straight to the cell.
  const fieldOf = (msg: string): string => {
    const m = /^(SKU|Product Name|Stock|MOQ|GSM|Price|Image|length|width|height)\b/i.exec(msg);
    if (m) return m[1];
    if (/category/i.test(msg)) return "Category";
    if (/status/i.test(msg)) return "Status";
    if (/image/i.test(msg)) return "Image";
    if (/Duplicate SKU/i.test(msg)) return "SKU";
    return "";
  };

  // Every row is listed — including clean ones — so the report doubles as a
  // full import manifest rather than only a list of failures.
  const lines = rows.flatMap((r) => {
    const issues = [
      ...r.errors.map((m) => ({ level: "ERROR", m })),
      ...r.warnings.map((m) => ({ level: "WARNING", m })),
    ];
    if (issues.length === 0) {
      return [[String(r.row), r.sku, r.name, statusLabel(r.status), "", "", "", ""].map(esc).join(",")];
    }
    return issues.map((i) =>
      [
        String(r.row), r.sku, r.name, statusLabel(r.status),
        i.level, fieldOf(i.m),
        i.level === "ERROR" ? i.m : "",
        i.level === "WARNING" ? i.m : "",
      ].map(esc).join(","),
    );
  });
  return ["Row,SKU,Product,Status,Level,Field,Error,Warning", ...lines].join("\n");
}

// ---------- Templates ----------

export const TEMPLATE_HEADERS = [
  "SKU", "Product Name", "Category", "Subcategory", "Type", "Description",
  "Material", "GSM", "Thickness", "Color", "Size", "MOQ", "Image", "Status",
];

export const TEMPLATE_SAMPLE_ROWS = [
  ["ZOLO-GB-001", "Premium Paper Gift Bag", "Gift Bags", "Paper Bags", "Shopping Bag",
   "Premium customizable paper gift bag", "Art Paper", 210, "-", "Blue",
   "10 x 8 x 4 inch", 100, "ZOLO-GB-001.png", "active"],
  ["ZOLO-GB-002", "Kraft Mailer Box", "Mailer Boxes", "Standard Mailer", "Mailer",
   "Durable kraft mailer with self-locking tabs", "Kraft Board", 320, "-", "Natural Kraft",
   "12 x 9 x 3 inch", 250, "ZOLO-GB-002.jpg", "active"],
];

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE_ROWS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return wb;
}

const ZIP_README = `Zolo Packaging — Bulk Import (ZIP with images)

1. Fill products.xlsx (keep the header row).
2. Give every product a unique SKU.
3. Put the product's image filename in the "Image" column (e.g. ZOLO-GB-001.jpg).
4. Put all images inside the /images folder.
   - Primary image:  images/ZOLO-GB-001.jpg
   - Extra images:   images/ZOLO-GB-001-2.jpg, images/ZOLO-GB-001-3.jpg
   - Supported: .jpg .jpeg .png .webp (max 5 MB each)
5. ZIP the spreadsheet + images folder together (max 50 MB).
6. In Admin → Product Catalog → Bulk Import, upload the ZIP.
7. Review the preview, then click Import.

Notes
- Price is NOT required: Zolo is quotation-based. Products without a price
  show "Request a Quote" on the website.
- If an image is missing the product still imports (with a warning).
`;

/** Tiny valid 1×1 transparent PNG for the example zip. */
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** Build zolo-import-example.zip (products.xlsx + images/ + README.txt). */
export function buildZipExample(): Uint8Array {
  const wb = buildTemplateWorkbook();
  const xlsx = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return zipSync({
    "products.xlsx": new Uint8Array(xlsx),
    "README.txt": strToU8(ZIP_README),
    "images/ZOLO-GB-001.png": TINY_PNG,
    "images/ZOLO-GB-001-2.png": TINY_PNG,
  });
}

// ---------- Misc ----------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};
