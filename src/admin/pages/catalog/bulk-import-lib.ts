import * as XLSX from "xlsx";
import { unzipSync, zipSync, strToU8 } from "fflate";
import type { CatalogProduct, ProductStatus } from "../../types";
import { joinMultiValue, splitMultiValue } from "../../../lib/product-options.ts";

// ============================================================
// Bulk-import core logic (pure, UI-free) — spreadsheet + ZIP parsing,
// validation, SKU↔image matching, templates and error reports.
// Kept free of store/React imports so it is testable in plain Node.
// ============================================================

// ---------- Limits ----------
// The ZIP is parsed IN THE BROWSER (fflate), so these are the real gates — the
// backend never receives the archive, only base64 image chunks + JSON product
// rows, which is why a 500 MB catalog never sits in server memory.
export const LIMITS = {
  SPREADSHEET_MAX_BYTES: 25 * 1024 * 1024, // 25 MB (a plain xlsx/csv)
  ZIP_MAX_BYTES: 500 * 1024 * 1024, // 500 MB catalog ZIP (xlsx + images)
  ZIP_UNCOMPRESSED_MAX_BYTES: 5 * 1024 * 1024 * 1024, // 5 GB zip-bomb guard
  IMAGE_MAX_BYTES: 10 * 1024 * 1024, // per image
  MAX_PRODUCTS: 25_000,
  MAX_IMAGES: 25_000,
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
  productid: "productId", id: "productId",
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
  image: "imageName", images: "imageName", imagename: "imageName", imagefile: "imageName", primaryimageurl: "imageName", primaryimage: "imageName",
  additionalimageurls: "imageNames", additionalimages: "imageNames", galleryimages: "imageNames",
};

/** URL-safe slug — same rule as the server (catalog-normalize slugify). */
export function slugifyName(value: string): string {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** "  Corrugated   Boxes " and "corrugated boxes" collapse to one key. */
export const categoryKey = (name: string) => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

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
  /** lowercase name of the immediate parent folder ("" at the zip root) — folder-per-SKU layouts */
  dir: string;
  data: Uint8Array;
}

export interface ZipContents {
  spreadsheet: { name: string; data: Uint8Array } | null;
  /**
   * keyed by the lowercase entry PATH ("box001.jpg", "images/box001-2.jpg",
   * "box001/front.jpg"). Keying by bare filename used to make every
   * "<sku>/image1.jpg" overwrite the previous folder's image1.jpg.
   */
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
      const segments = path.toLowerCase().split("/").filter(Boolean);
      out.images.set(path.toLowerCase(), {
        path,
        base: file.replace(/\.[a-z0-9]+$/i, ""),
        ext,
        dir: segments.length > 1 ? segments[segments.length - 2] : "",
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

export type ImageSource = "sku" | "productId" | "filename" | "column" | "name" | "embedded" | "url";

export interface ImageMatch {
  /** zip map key of the primary image, if found */
  primary?: string;
  /** zip map keys of gallery images (SKU-2.jpg, SKU-3.jpg, folder files, extra Image-column files …) */
  gallery: string[];
  /** how the primary image was resolved (for the preview's Image Status column) */
  source?: ImageSource;
  /** Image-column filenames that were listed but are not in the ZIP (one warning each; never fails the row) */
  missing: string[];
}

interface ImageIndex {
  /** "box001.jpg" → keys of every entry with that filename (any folder) */
  byFile: Map<string, string[]>;
  /** "box001" → keys of entries whose base name is exactly that */
  byBase: Map<string, string[]>;
  /** "box001" → keys of "box001-1.jpg", "box001-2.png" … in numeric order */
  bySeries: Map<string, { n: number; key: string }[]>;
  /** "box001" → keys of every image inside a folder named box001 */
  byDir: Map<string, string[]>;
}

const indexCache = new WeakMap<Map<string, ZipImage>, ImageIndex>();

/** Build (once per ZIP) the lookups matchImages needs, so a 25k-image ZIP is not rescanned per row. */
function indexImages(images: Map<string, ZipImage>): ImageIndex {
  const cached = indexCache.get(images);
  if (cached) return cached;
  const idx: ImageIndex = { byFile: new Map(), byBase: new Map(), bySeries: new Map(), byDir: new Map() };
  const push = (m: Map<string, string[]>, k: string, v: string) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const [key, img] of images) {
    push(idx.byFile, `${img.base}.${img.ext}`, key);
    push(idx.byBase, img.base, key);
    const m = /^(.+)-(\d+)$/.exec(img.base);
    if (m) {
      const list = idx.bySeries.get(m[1]) ?? [];
      list.push({ n: Number(m[2]), key });
      idx.bySeries.set(m[1], list);
    }
    if (img.dir) push(idx.byDir, img.dir, key);
  }
  for (const list of idx.bySeries.values()) list.sort((a, b) => a.n - b.n || a.key.localeCompare(b.key));
  for (const list of idx.byDir.values()) list.sort((a, b) => a.localeCompare(b));
  indexCache.set(images, idx);
  return idx;
}

/**
 * Every image that belongs to an identifier: the exact file ("BOX001.jpg"),
 * its numbered series ("BOX001-1.jpg", "BOX001-2.jpg" …) and a folder of the
 * same name ("BOX001/front.jpg"). Order: exact file, series, folder.
 */
function imagesForIdentifier(id: string, idx: ImageIndex): string[] {
  const base = id.trim().toLowerCase();
  if (!base) return [];
  const out: string[] = [];
  const add = (k: string) => { if (!out.includes(k)) out.push(k); };
  // A bare identifier may also be typed with its extension ("box001.jpg").
  const stripped = base.replace(/\.(jpe?g|png|webp)$/i, "");
  for (const k of idx.byFile.get(base) ?? []) add(k);
  for (const k of idx.byBase.get(stripped) ?? []) add(k);
  for (const { key } of idx.bySeries.get(stripped) ?? []) add(key);
  for (const k of idx.byDir.get(stripped) ?? []) add(k);
  return out;
}

export interface MatchImagesOptions {
  /** Product ID (PRD-xxxx) — from the sheet's Product ID column or the existing catalog row for this SKU */
  productId?: string;
  /** product name; matched as its slug ("kraft-mailer-box.jpg") */
  name?: string;
}

/**
 * Match a row to zip images.
 *
 * Priority for the PRIMARY image: SKU → Product ID → filename listed in the
 * Image column → product-name slug. Case-insensitive. For each identifier the
 * exact file, its "-N" series and a same-named folder all count, so
 * "BOX001.jpg", "BOX001-1.jpg … -3.jpg" and "BOX001/image1.jpg" all work.
 *
 * Every file the Image column lists ("a.jpg, b.jpg" or "a.jpg | b.jpg") is
 * attached in addition; the ones not in the ZIP are reported in `missing`
 * (one warning each — the row still imports).
 */
export function matchImages(
  sku: string,
  imageColumn: string | undefined,
  images: Map<string, ZipImage>,
  opts: MatchImagesOptions = {},
): ImageMatch {
  const match: ImageMatch = { gallery: [], missing: [] };
  if (images.size === 0) return match;
  const idx = indexImages(images);

  // Image column: explicit filenames (URLs are handled by the caller).
  const columnFiles = splitMultiValue(imageColumn).filter((f) => !/^https?:\/\//i.test(f));
  const columnFound: string[] = [];
  for (const f of columnFiles) {
    const found = imagesForIdentifier(f, idx);
    if (found.length) columnFound.push(...found);
    else match.missing.push(f);
  }

  const nameSlug = opts.name ? slugifyName(opts.name) : "";
  const candidates: { source: ImageSource; keys: string[] }[] = [
    { source: "sku", keys: sku ? imagesForIdentifier(sku, idx) : [] },
    { source: "productId", keys: opts.productId ? imagesForIdentifier(opts.productId, idx) : [] },
    { source: "column", keys: columnFound },
    { source: "name", keys: nameSlug ? imagesForIdentifier(nameSlug, idx) : [] },
  ];

  const all: string[] = [];
  for (const c of candidates) {
    for (const k of c.keys) {
      if (all.includes(k)) continue;
      all.push(k);
      if (!match.primary) { match.primary = k; match.source = c.source; }
    }
  }
  match.gallery = all.slice(1);
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
    m.includes("Duplicate SKU within file") ||
    m === "Category is missing" ||
    // Taxonomy must match the REAL database — a misspelled category would
    // otherwise create a duplicate ("Corrugated Box" beside "Corrugated Boxes").
    /^(Category|Subcategory) ".*" does not exist/.test(m) ||
    /^Subcategory ".*" does not belong to/.test(m)
  );
}

export interface ParsedRow {
  row: number; // 1-indexed spreadsheet row (incl. header offset)
  sku: string;
  name: string;
  category: string;
  subcategory?: string;
  /** Category / subcategory the import will CREATE (not in the database yet). */
  isNewCategory: boolean;
  isNewSubcategory: boolean;
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


/** Parse ONE "10 x 8 x 4 inch" style size string (null for capacities, A4, free text). */
function parseOneSize(s: string): CatalogProduct["dimensions"] | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(inch|inches|in|cm|mm)?\s*$/i.exec(s);
  if (!m) return undefined;
  const unitRaw = (m[4] ?? "in").toLowerCase();
  const unit = unitRaw.startsWith("in") ? "in" : unitRaw === "cm" ? "cm" : "mm";
  return { length: Number(m[1]), width: Number(m[2]), height: Number(m[3]), unit };
}

export interface KnownCategory {
  id: string;
  name: string;
  slug?: string;
  subcategories?: { id: string; name: string; slug?: string }[];
}

/**
 * Closest existing name for a "did you mean" hint. Same key → containment →
 * bounded edit distance; null when nothing is reasonably close.
 */
export function suggestName(name: string, candidates: readonly string[]): string | null {
  const key = categoryKey(name);
  if (!key) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const ck = categoryKey(c);
    if (!ck) continue;
    let score: number;
    if (ck === key) score = 0;
    else if (ck.startsWith(key) || key.startsWith(ck) || ck.includes(key) || key.includes(ck)) score = 1;
    else score = 2 + levenshtein(key, ck);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  const budget = 2 + Math.min(4, Math.max(1, Math.floor(key.length / 4)));
  return best !== null && bestScore <= budget ? best : null;
}

/**
 * "Corrugated Box" vs "Corrugated Boxes": a spelling slip, not a new category.
 * One edit for short names, two for long ones, or a singular/plural pair.
 */
export function isLikelyTypo(name: string, existing: string): boolean {
  const a = categoryKey(name), b = categoryKey(existing);
  if (!a || !b || a === b) return false;
  const singular = (k: string) => k.replace(/(ies|es|s)$/, "");
  if (singular(a) === singular(b)) return true;
  const budget = Math.max(a.length, b.length) >= 8 ? 2 : 1;
  return levenshtein(a, b) <= budget;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let left = i;
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const cur = Math.min(prev[j] + 1, left + 1, sub);
      prev[j - 1] = left;
      left = cur;
    }
    prev[b.length] = left;
  }
  return prev[b.length];
}

export interface ValidateOptions {
  /** returns true when a SKU already exists in the catalog */
  existingSku: (sku: string) => boolean;
  /** existing Product ID for a SKU (lets "PRD-4282.jpg" match a row that has no Product ID column) */
  existingProductId?: (sku: string) => string | undefined;
  /**
   * The REAL category tree from the database. Category/subcategory cells are
   * matched against it (case/whitespace-insensitive, by name or slug) and the
   * official DB name + id are written to the row. Empty ⇒ fall back to
   * `knownCategories` name checks.
   */
  categoryTree?: KnownCategory[];
  /**
   * Default: an unknown category/subcategory is NEW — a warning, listed in the
   * preview's structure and created when the admin confirms — unless it looks
   * like a typo of an existing name, which is an ERROR with the suggestion.
   * `false` = strict: every unknown name is an error.
   */
  createMissingCategories?: boolean;
  /** known category names (empty list ⇒ any category accepted) — legacy name-only check */
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
    const categoryCell = cleanOptional(raw.category) ?? "";
    const subcategoryCell = cleanOptional(raw.subcategory);
    const imageName = cleanOptional(raw.imageName);
    const productIdCell = cleanOptional(raw.productId);
    const statusStr = (cleanOptional(raw.status) ?? "draft").toLowerCase();

    // Required fields
    if (!sku) messages.push("SKU is required");
    if (!name) messages.push("Product Name is required");

    // Duplicate SKU inside the spreadsheet itself → hard error
    const skuKey = sku.toLowerCase();
    if (sku && seenSkus.has(skuKey)) messages.push("Duplicate SKU within file");
    if (sku) seenSkus.add(skuKey);

    // Category / subcategory: matched against the REAL database tree. A match
    // is case/whitespace-insensitive (name or slug) and the row is stamped with
    // the official DB name + id. No match ⇒ NEW (created on confirm), except a
    // likely typo of an existing name ⇒ error with the suggestion. A
    // subcategory that exists under ANOTHER category is an error: it must
    // belong to the row's category.
    // Whitespace-normalised so "Stretch  Film" and "Stretch Film" are one
    // category in the preview structure and on the server.
    let category = categoryCell.replace(/\s+/g, " ");
    let categoryId: string | undefined;
    let subcategory = subcategoryCell && categoryKey(subcategoryCell) !== "general" ? subcategoryCell.replace(/\s+/g, " ") : undefined;
    let subcategoryId: string | undefined;
    let isNewCategory = false;
    let isNewSubcategory = false;
    const strict = opts.createMissingCategories === false;
    const tree = opts.categoryTree ?? [];
    if (!categoryCell) messages.push("Category is missing");
    if (tree.length > 0 && categoryCell) {
      const key = categoryKey(categoryCell);
      const hit = tree.find((c) => categoryKey(c.name) === key || (c.slug && c.slug === slugifyName(categoryCell)));
      if (hit) {
        category = hit.name;
        categoryId = hit.id;
        if (subcategory) {
          const subKey = categoryKey(subcategory);
          const subs = hit.subcategories ?? [];
          const subHit = subs.find((sc) => categoryKey(sc.name) === subKey || (sc.slug && sc.slug === slugifyName(subcategory!)));
          if (subHit) {
            subcategory = subHit.name;
            subcategoryId = subHit.id;
          } else {
            const elsewhere = tree.find((c) => c.id !== hit.id && (c.subcategories ?? []).some((sc) => categoryKey(sc.name) === subKey));
            const hint = suggestName(subcategory, subs.map((sc) => sc.name));
            if (elsewhere) {
              messages.push(`Subcategory "${subcategory}" does not belong to category "${hit.name}" (it belongs to "${elsewhere.name}")`);
            } else if (hint && (strict || isLikelyTypo(subcategory, hint))) {
              messages.push(`Subcategory "${subcategory}" does not exist under "${hit.name}". Possible existing subcategory: "${hint}"`);
            } else if (strict) {
              messages.push(`Subcategory "${subcategory}" does not exist under "${hit.name}"`);
            } else {
              isNewSubcategory = true;
              messages.push(`New subcategory "${subcategory}" will be created under "${hit.name}"`);
            }
          }
        }
      } else {
        const hint = suggestName(categoryCell, tree.map((c) => c.name));
        if (hint && (strict || isLikelyTypo(categoryCell, hint))) {
          messages.push(`Category "${categoryCell}" does not exist. Possible existing category: "${hint}"`);
        } else if (strict) {
          messages.push(`Category "${categoryCell}" does not exist`);
        } else {
          isNewCategory = true;
          messages.push(`New category "${categoryCell}" will be created${hint ? ` (similar to existing "${hint}")` : ""}`);
          if (subcategory) { isNewSubcategory = true; messages.push(`New subcategory "${subcategory}" will be created under "${categoryCell}"`); }
        }
      }
    } else if (
      category &&
      (opts.categoryTree !== undefined || opts.knownCategories.length > 0) &&
      !opts.knownCategories.some((c) => categoryKey(c) === categoryKey(category))
    ) {
      // An EMPTY catalog (tree supplied but empty) or a name-only list:
      // anything unknown is NEW. With no taxonomy info at all (unit tests,
      // offline) every category is accepted silently — the server decides.
      isNewCategory = true;
      messages.push(`New category "${category}" will be created`);
      if (subcategory) { isNewSubcategory = true; messages.push(`New subcategory "${subcategory}" will be created under "${category}"`); }
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
    const productId = productIdCell ?? (sku ? opts.existingProductId?.(sku) : undefined);
    const imageMatch: ImageMatch =
      zipImages.size > 0 ? matchImages(sku, imageName, zipImages, { productId, name }) : { gallery: [], missing: [] };
    for (const f of imageMatch.missing) messages.push(`Image not found: ${f}`);

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
    if (hasImageSource && !imageMatch.primary && imageMatch.missing.length === 0) messages.push("Image not found — product imported without an image");

    const isDuplicate = !!sku && opts.existingSku(sku);
    if (isDuplicate) messages.push("SKU already exists");

    // Split messages into blocking errors vs non-blocking warnings so the UI
    // and report can show each clearly. A row imports unless it has an error.
    const errors = messages.filter(isBlockingMessage);
    const warnings = messages.filter((m) => !isBlockingMessage(m));
    const rowStatus: RowStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ready";

    // Size cell → every value ("6x6x4, 8x8x6 | 10x8x6") is kept in the existing
    // sizeLabel column; structured dimensions come from L/W/H columns, else the
    // first size that is a real 3-axis measurement.
    const sizes = splitMultiValue(raw.size);
    const sizeLabel = joinMultiValue(sizes) ?? undefined;
    const dimsFromSizes = sizes.map(parseOneSize).find(Boolean);
    // Structured dimensions from Length/Width/Height columns or Size string
    const dims =
      !isBlankValue(raw.length) && !isBlankValue(raw.width) && !isBlankValue(raw.height)
        ? (() => {
            const l = optionalNum(raw.length), w = optionalNum(raw.width), h = optionalNum(raw.height);
            return l != null && w != null && h != null && ![l, w, h].some(Number.isNaN)
              ? { length: l, width: w, height: h, unit: (String(raw.unit || "in").trim().toLowerCase() as "in" | "cm" | "mm") }
              : undefined;
          })()
        : dimsFromSizes;

    // Material / Thickness / Type have their own columns (and their own spec
    // line on the product page), so they are no longer folded into the
    // description tail where they showed up twice.
    const description = cleanOptional(raw.description) || cleanOptional(raw.shortDescription) || undefined;

    return {
      row: index + 2,
      sku, name, category, subcategory,
      isNewCategory, isNewSubcategory,
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
        subcategory: subcategory || "General",
        ...(categoryId ? { categoryId } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
        description,
        dimensions: dims,
        sizeLabel,
        thickness: cleanOptional(raw.thickness),
        productType: cleanOptional(raw.type),
        // null/NaN ⇒ leave undefined so the column stays NULL in Postgres.
        gsm: gsmNum !== null && !Number.isNaN(gsmNum) ? Math.round(gsmNum) : undefined,
        material: cleanOptional(raw.material),
        // "Brown | White; Black" → "Brown, White, Black" (the existing column format).
        color: joinMultiValue(splitMultiValue(raw.color)) ?? undefined,
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
   "Premium customizable paper gift bag", "Art Paper", 210, "-", "Blue, White, Black",
   "10 x 8 x 4 inch, 12 x 10 x 5 inch", 100, "ZOLO-GB-001.png", "active"],
  ["ZOLO-GB-002", "Kraft Mailer Box", "Mailer Boxes", "Standard Mailer", "Mailer",
   "Durable kraft mailer with self-locking tabs", "Kraft Board", 320, "3 Ply", "Natural Kraft | White",
   "12 x 9 x 3 inch | 14 x 10 x 4 inch", 250, "ZOLO-GB-002.jpg, ZOLO-GB-002-2.jpg", "active"],
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
3. Category and Subcategory must already exist in Admin → Catalog → Categories
   (matching ignores case and spacing; the subcategory must belong to the
   category). A row with an unknown category is reported with the closest
   existing name — tick "Create missing categories" only if it really is new.
4. Several Sizes or Colours go in ONE cell, separated by comma, | or a line
   break: "6x6x4 in, 8x8x6 in, 10x8x6 in" / "Brown | White | Black".
5. Images — name files by SKU and put them in the ZIP (any folder):
   - Primary image:  images/ZOLO-GB-001.jpg
   - Extra images:   images/ZOLO-GB-001-2.jpg, images/ZOLO-GB-001-3.jpg
   - Or one folder per SKU: images/ZOLO-GB-001/front.jpg, .../back.jpg
   - Or list files in the "Image" column: "a.jpg, b.jpg" or "a.jpg | b.jpg"
   - Also matched: Product ID (PRD-1234.jpg) and the product name slug.
   - Supported: .jpg .jpeg .png .webp
6. Upload the ZIP (spreadsheet + images), or products.xlsx and an images-only
   ZIP together, in Admin → Product Catalog → Bulk Import.
7. Review the preview, then click Import.

Notes
- Price is NOT required: Zolo is quotation-based. Products without a price
  show "Request a Quote" on the website.
- If an image is missing the product still imports (with a warning naming
  the file, e.g. "Image not found: ZOLO-GB-001-2.jpg").
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
    "images/ZOLO-GB-002/ZOLO-GB-002.png": TINY_PNG,
    "images/ZOLO-GB-002/ZOLO-GB-002-2.png": TINY_PNG,
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
