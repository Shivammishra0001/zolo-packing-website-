// Import wizard — pure logic (no React) so it is unit-testable.
//
//   parseWorkbook()   → sheets (single-sheet, or a Products + Variants pair)
//   autoMap()         → Excel column → system field (admin can change it)
//   groupProducts()   → rows → products with variants (same Product ID / name
//                        ⇒ ONE product; one row = one variant)
//   matchZipImages()  → ZIP files matched by SKU / Product ID / filename
//   buildTemplate()   → Simple + Variable templates with a "How to Import" sheet
//
// Everything the server needs is produced here as the v2 payload; the server
// validates again and writes in one transaction.
import * as XLSX from "xlsx";
import type { ZipContents, ZipImage } from "./bulk-import-lib";

// ---------- system fields ----------

export type SystemField =
  | "productId" | "name" | "kind" | "category" | "subcategory" | "description" | "material" | "gsm" | "thickness" | "brand" | "manufacturer" | "productType" | "status" | "featured"
  | "sku" | "price" | "compareAtPrice" | "stock" | "moq" | "weightGrams" | "length" | "width" | "height" | "dimUnit" | "image" | "variantStatus" | "ignore";

export interface FieldMeta { key: SystemField; label: string; scope: "product" | "variant" | "both"; hint?: string }
export const SYSTEM_FIELDS: FieldMeta[] = [
  { key: "productId", label: "Product ID", scope: "both", hint: "Rows with the same Product ID become one product" },
  { key: "name", label: "Product Name", scope: "product" },
  { key: "kind", label: "Product Type (Simple / Variable)", scope: "product" },
  { key: "category", label: "Category", scope: "product" },
  { key: "subcategory", label: "Subcategory", scope: "product" },
  { key: "description", label: "Description", scope: "product" },
  { key: "material", label: "Material", scope: "both" },
  { key: "gsm", label: "GSM", scope: "product" },
  { key: "thickness", label: "Thickness", scope: "both" },
  { key: "brand", label: "Brand", scope: "product" },
  { key: "manufacturer", label: "Manufacturer", scope: "product" },
  { key: "productType", label: "Type descriptor (e.g. Mailer box)", scope: "product" },
  { key: "status", label: "Status", scope: "product" },
  { key: "featured", label: "Featured", scope: "product" },
  { key: "sku", label: "SKU", scope: "variant" },
  { key: "price", label: "Price (₹)", scope: "variant" },
  { key: "compareAtPrice", label: "Compare At Price (₹)", scope: "variant" },
  { key: "stock", label: "Stock", scope: "variant" },
  { key: "moq", label: "MOQ", scope: "variant" },
  { key: "weightGrams", label: "Weight (g)", scope: "variant" },
  { key: "length", label: "Length", scope: "variant" },
  { key: "width", label: "Width", scope: "variant" },
  { key: "height", label: "Height", scope: "variant" },
  { key: "dimUnit", label: "Dimension unit", scope: "variant" },
  { key: "image", label: "Image (file name or URL)", scope: "both" },
  { key: "variantStatus", label: "Variant status", scope: "variant" },
  { key: "ignore", label: "— Ignore column —", scope: "both" },
];

/** A column may also be an OPTION (variant attribute): { option: "Size" }. */
export type ColumnTarget = { field: SystemField } | { option: string };
export type Mapping = Record<string, ColumnTarget>; // excel header → target

export const OPTION_NAMES = ["Size", "Color", "GSM", "Thickness", "Material", "Finish", "Shape", "Closure", "Capacity", "Pack Size", "Print Type", "Handle Type", "Ply", "Width", "Length"];

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const FIELD_ALIASES: Record<string, SystemField> = {
  productid: "productId", pid: "productId", parentid: "productId", productcode: "productId", groupid: "productId",
  productname: "name", name: "name", title: "name",
  producttype: "kind", type: "kind", kind: "kind",
  category: "category", subcategory: "subcategory", subcat: "subcategory",
  description: "description", desc: "description", shortdescription: "description",
  gsm: "gsm", brand: "brand", manufacturer: "manufacturer", productstatus: "status", status: "status", featured: "featured", isfeatured: "featured",
  sku: "sku", variantsku: "sku", price: "price", unitprice: "price", priceinr: "price", compareatprice: "compareAtPrice", compareprice: "compareAtPrice", mrp: "compareAtPrice",
  stock: "stock", stockquantity: "stock", stockqty: "stock", quantity: "stock", moq: "moq", minorderqty: "moq",
  weight: "weightGrams", weightg: "weightGrams", weightgrams: "weightGrams",
  length: "length", width: "width", height: "height", dimensionunit: "dimUnit", unit: "dimUnit", dimunit: "dimUnit",
  image: "image", variantimage: "image", productimage: "image", primaryimage: "image", primaryimageurl: "image", imagename: "image", images: "image",
  variantstatus: "variantStatus",
};
// Columns that are variant OPTIONS by default. Material / Thickness are
// product-level fields unless the admin re-maps them to an option.
const OPTION_ALIASES: Record<string, string> = {
  size: "Size", sizes: "Size", dimensions: "Size", color: "Color", colour: "Color", colors: "Color", finish: "Finish", shape: "Shape", closure: "Closure",
  capacity: "Capacity", packsize: "Pack Size", printtype: "Print Type", handletype: "Handle Type", ply: "Ply", option: "Option", option1: "Option 1", option2: "Option 2",
};

export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {};
  for (const h of headers) {
    const n = norm(h);
    if (!n) continue;
    if (FIELD_ALIASES[n]) m[h] = { field: FIELD_ALIASES[n] };
    else if (OPTION_ALIASES[n]) m[h] = { option: OPTION_ALIASES[n] };
    else if (/^option\d*$/.test(n)) m[h] = { option: h.trim() };
    else if (n === "material" || n === "thickness") m[h] = { field: n as SystemField };
    else m[h] = { field: "ignore" };
  }
  return m;
}

// ---------- workbook ----------

export interface Sheet { name: string; headers: string[]; rows: Record<string, string | number>[] }
export interface Workbook { sheets: Sheet[]; products: Sheet; variants: Sheet | null; format: "single" | "two-sheet" }

export function parseWorkbook(data: ArrayBuffer | Uint8Array): Workbook {
  const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? "array" : "array" });
  const sheets: Sheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "", raw: false });
    const headers = rows.length ? Object.keys(rows[0]).filter((h) => !h.startsWith("__EMPTY")) : (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map(String);
    return { name, headers, rows: rows.filter((r) => Object.values(r).some((v) => String(v).trim() !== "")) };
  }).filter((s) => s.headers.length && !/^how to|instructions|readme/i.test(s.name));
  if (!sheets.length) throw new Error("The workbook has no data sheet.");
  const byName = (re: RegExp) => sheets.find((s) => re.test(s.name));
  const products = byName(/^products?$/i);
  const variants = byName(/^variants?$/i);
  if (products && variants) return { sheets, products, variants, format: "two-sheet" };
  // Two unnamed sheets where the second has SKU and the first does not → same thing.
  if (sheets.length >= 2 && !sheets[0].headers.some((h) => norm(h) === "sku") && sheets[1].headers.some((h) => norm(h) === "sku")) {
    return { sheets, products: sheets[0], variants: sheets[1], format: "two-sheet" };
  }
  return { sheets, products: sheets[0], variants: null, format: "single" };
}

// ---------- grouping ----------

export interface ImportVariant {
  sku?: string; attributes: Record<string, string>; price?: string; compareAtPrice?: string; stock?: string; moq?: string; weightGrams?: string;
  length?: string; width?: string; height?: string; dimUnit?: string; material?: string; thickness?: string; image?: string; status?: string; _row: number;
}
export interface ImportProduct {
  productId?: string; sku?: string; name: string; kind: "simple" | "variable"; category?: string; subcategory?: string; description?: string; material?: string; gsm?: string;
  thickness?: string; brand?: string; manufacturer?: string; productType?: string; status?: string; featured?: string; images: string[];
  // simple-product sellable fields
  price?: string; compareAtPrice?: string; stock?: string; moq?: string; size?: string; color?: string; weightGrams?: string; length?: string; width?: string; height?: string; dimUnit?: string;
  variantOptions: { name: string; values: string[] }[]; variants: ImportVariant[]; _rows: number[];
}

const val = (row: Record<string, string | number>, header: string | undefined) => (header === undefined ? "" : String(row[header] ?? "").trim());
const isVariableWord = (s: string) => /^(variable|variant|variants|variable product)$/i.test(s.trim());

function invert(mapping: Mapping) {
  const byField = new Map<SystemField, string>(); const options: { header: string; option: string }[] = [];
  for (const [header, t] of Object.entries(mapping)) {
    if ("option" in t) { if (t.option.trim()) options.push({ header, option: t.option.trim() }); }
    else if (t.field !== "ignore" && !byField.has(t.field)) byField.set(t.field, header);
  }
  return { byField, options };
}

/**
 * Turn mapped rows into products. Single sheet: one row = one variant, rows
 * with the same Product ID (or, without one, the same Product Name) are ONE
 * product. Two sheets: product rows + variant rows joined on Product ID.
 */
export function groupProducts(wb: Workbook, productMapping: Mapping, variantMapping?: Mapping): ImportProduct[] {
  const pm = invert(productMapping);
  const vm = wb.variants ? invert(variantMapping ?? productMapping) : pm;
  const groups = new Map<string, ImportProduct>();
  const productRows = wb.products.rows;
  const g = (row: Record<string, string | number>, map: typeof pm) => (key: SystemField) => val(row, map.byField.get(key));

  // Product-level rows (single sheet: every row; two-sheet: the Products sheet).
  productRows.forEach((row, i) => {
    const P = g(row, pm);
    const productId = P("productId"); const name = P("name");
    const key = (productId || name || `row-${i}`).toLowerCase();
    let p = groups.get(key);
    if (!p) {
      p = {
        productId: productId || undefined, sku: undefined, name: name || productId, kind: "simple", category: P("category") || undefined, subcategory: P("subcategory") || undefined,
        description: P("description") || undefined, material: P("material") || undefined, gsm: P("gsm") || undefined, thickness: P("thickness") || undefined,
        brand: P("brand") || undefined, manufacturer: P("manufacturer") || undefined, productType: P("productType") || undefined, status: P("status") || undefined, featured: P("featured") || undefined,
        images: [], variantOptions: [], variants: [], _rows: [],
      };
      if (isVariableWord(P("kind"))) p.kind = "variable";
      if (wb.format === "two-sheet" && P("image")) p.images.push(P("image"));
      groups.set(key, p);
    } else {
      // Later rows may fill product fields the first row left blank.
      for (const f of ["category", "subcategory", "description", "material", "gsm", "thickness", "brand", "manufacturer", "productType", "status"] as const) if (!p[f] && P(f)) p[f] = P(f);
      if (isVariableWord(P("kind"))) p.kind = "variable";
    }
    p._rows.push(i + 2);
    if (wb.format === "single") pushVariant(p, row, pm, i + 2);
  });

  // Two-sheet: variant rows join on Product ID (or name).
  if (wb.variants) {
    wb.variants.rows.forEach((row, i) => {
      const V = g(row, vm);
      const key = (V("productId") || V("name")).toLowerCase();
      const p = key ? groups.get(key) : undefined;
      if (!p) {
        // An orphan variant row still surfaces as a product so the error is visible.
        const orphan: ImportProduct = { productId: V("productId") || undefined, name: V("name") || V("productId") || `Variants row ${i + 2}`, kind: "variable", images: [], variantOptions: [], variants: [], _rows: [i + 2] };
        groups.set(key || `orphan-${i}`, orphan);
        pushVariant(orphan, row, vm, i + 2);
        return;
      }
      pushVariant(p, row, vm, i + 2);
    });
  }

  const out: ImportProduct[] = [];
  for (const p of groups.values()) {
    // Option axes = every option column with a value on any of its rows.
    const axes = new Map<string, string[]>();
    for (const v of p.variants) for (const [k, x] of Object.entries(v.attributes)) { if (!axes.has(k)) axes.set(k, []); if (!axes.get(k)!.includes(x)) axes.get(k)!.push(x); }
    const hasOptions = [...axes.values()].some((vals) => vals.length > 0);
    if (p.kind !== "variable" && (p.variants.length > 1 || (wb.format === "two-sheet" && p.variants.length > 0))) p.kind = "variable";
    if (p.kind === "variable") {
      p.variantOptions = [...axes].map(([name, values]) => ({ name, values }));
      for (const v of p.variants) for (const k of Object.keys(v.attributes)) if (!v.attributes[k]) delete v.attributes[k];
      p.sku = p.productId || undefined;
      // A variable product without a product-level image shows its variants' images.
      if (!p.images.length) p.images = [...new Set(p.variants.map((v) => v.image).filter((x): x is string => Boolean(x)))];
    } else {
      // Simple: the single row's sellable values live on the product.
      const v = p.variants[0];
      if (v) {
        Object.assign(p, { sku: v.sku || p.productId, price: v.price, compareAtPrice: v.compareAtPrice, stock: v.stock, moq: v.moq, weightGrams: v.weightGrams, length: v.length, width: v.width, height: v.height, dimUnit: v.dimUnit });
        if (!p.material && v.material) p.material = v.material;
        if (!p.thickness && v.thickness) p.thickness = v.thickness;
        if (v.image) p.images = [v.image];
        p.size = v.attributes.Size ?? Object.values(v.attributes)[0]; p.color = v.attributes.Color;
        void hasOptions;
      }
      p.variantOptions = []; p.variants = [];
    }
    out.push(p);
  }
  return out;
}

function pushVariant(p: ImportProduct, row: Record<string, string | number>, map: ReturnType<typeof invert>, rowNo: number) {
  const V = (key: SystemField) => val(row, map.byField.get(key));
  const attributes: Record<string, string> = {};
  for (const { header, option } of map.options) { const x = val(row, header); if (x) attributes[option] = x; }
  p.variants.push({
    sku: V("sku") || undefined, attributes, price: V("price") || undefined, compareAtPrice: V("compareAtPrice") || undefined, stock: V("stock") || undefined, moq: V("moq") || undefined,
    weightGrams: V("weightGrams") || undefined, length: V("length") || undefined, width: V("width") || undefined, height: V("height") || undefined, dimUnit: V("dimUnit") || undefined,
    material: map.byField.has("material") && p.kind === "variable" ? V("material") || undefined : undefined, thickness: map.byField.has("thickness") && p.kind === "variable" ? V("thickness") || undefined : undefined,
    image: V("image") || undefined, status: V("variantStatus") || undefined, _row: rowNo,
  });
}

// ---------- images ----------

export interface ImageResolution { matched: number; unmatched: string[]; uploads: { name: string; image: ZipImage }[] }

const base = (s: string) => s.trim().toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Resolve every image reference to a ZIP file. A reference is matched by
 * (1) exact file name, (2) base name; and each variant / product without a
 * reference is matched by (3) its SKU or (4) its Product ID as the file name.
 * Returns the list of files that need uploading; the caller uploads them and
 * swaps the references for URLs with `applyImageUrls`.
 */
export function matchZipImages(products: ImportProduct[], zip: ZipContents | null): ImageResolution {
  const files = new Map<string, ZipImage>();
  const list: ZipImage[] = zip ? (zip.images instanceof Map ? [...zip.images.values()] : (zip.images as unknown as ZipImage[])) : [];
  const nameOf = (img: ZipImage) => `${img.base}.${img.ext}`;
  for (const img of list) { files.set(nameOf(img), img); files.set(img.path.split("/").pop()!.toLowerCase(), img); files.set(base(nameOf(img)), img); }
  const uploads = new Map<string, ZipImage>(); const unmatched = new Set<string>();
  const resolveRef = (ref: string): string | null => {
    if (/^https?:\/\//i.test(ref)) return ref;
    // Already resolved on an earlier pass (validate → import): keep it.
    if (ref.startsWith("zip:")) { const hit = files.get(ref.slice(4).toLowerCase()); if (hit) { uploads.set(nameOf(hit), hit); return ref; } return null; }
    const hit = files.get(ref.toLowerCase()) ?? files.get(base(ref));
    if (!hit) { unmatched.add(ref); return null; }
    uploads.set(nameOf(hit), hit); return `zip:${nameOf(hit)}`;
  };
  const resolveKey = (key: string | undefined): string | null => {
    if (!key) return null;
    const hit = files.get(base(key));
    if (!hit) return null;
    uploads.set(nameOf(hit), hit); return `zip:${nameOf(hit)}`;
  };
  for (const p of products) {
    p.images = p.images.map((ref) => resolveRef(ref)).filter((x): x is string => Boolean(x));
    if (!p.images.length) { const byKey = resolveKey(p.sku) ?? resolveKey(p.productId); if (byKey) p.images = [byKey]; }
    for (const v of p.variants) {
      v.image = v.image ? resolveRef(v.image) ?? undefined : resolveKey(v.sku) ?? undefined;
    }
    // A variable product's gallery = its own images + every variant image.
    if (p.kind === "variable") p.images = [...new Set([...p.images, ...p.variants.map((v) => v.image).filter((x): x is string => Boolean(x))])];
  }
  return { matched: uploads.size, unmatched: [...unmatched], uploads: [...uploads].map(([name, image]) => ({ name, image })) };
}

/** Replace `zip:<file>` references with uploaded URLs (unuploaded ones are dropped). */
export function applyImageUrls(products: ImportProduct[], urlByFile: Map<string, string>) {
  const swap = (ref: string | undefined) => (ref?.startsWith("zip:") ? urlByFile.get(ref.slice(4)) : ref);
  for (const p of products) {
    p.images = p.images.map(swap).filter((x): x is string => Boolean(x));
    for (const v of p.variants) v.image = swap(v.image);
  }
}

/**
 * The v2 payload the server accepts. `keepRefs` (validation) passes ZIP
 * references through so the server can count images; the real import only
 * sends uploaded URLs.
 */
export function toPayload(products: ImportProduct[], keepRefs = false) {
  const ok = (u: string | undefined): u is string => Boolean(u) && (keepRefs || /^https?:\/\//i.test(u as string));
  return products.map((p) => ({
    productId: p.productId, sku: p.sku, name: p.name, kind: p.kind, category: p.category, subcategory: p.subcategory, description: p.description,
    material: p.material, gsm: p.gsm, thickness: p.thickness, brand: p.brand, manufacturer: p.manufacturer, productType: p.productType, status: p.status, featured: p.featured,
    images: p.images.filter(ok),
    ...(p.kind === "simple"
      ? { price: p.price, compareAtPrice: p.compareAtPrice, stock: p.stock, moq: p.moq, size: p.size, color: p.color, weightGrams: p.weightGrams, length: p.length, width: p.width, height: p.height, dimUnit: p.dimUnit }
      : { variantOptions: p.variantOptions, variants: p.variants.map((v) => ({ sku: v.sku, attributes: v.attributes, price: v.price, compareAtPrice: v.compareAtPrice, stock: v.stock, moq: v.moq, weightGrams: v.weightGrams, length: v.length, width: v.width, height: v.height, dimUnit: v.dimUnit, material: v.material, thickness: v.thickness, image: ok(v.image) ? v.image : undefined, status: v.status })) }),
  }));
}

// ---------- templates ----------

const HOW_TO = [
  ["How to Import Products"],
  [""],
  ["One row = one variant", "Every row in the Variants sheet (or in a single-sheet file) is one sellable variant with its own SKU, price, stock and MOQ."],
  ["Same Product ID = same product", "Rows that share a Product ID (or, without one, the same Product Name) are imported as ONE product with several variants. Duplicate products are never created."],
  ["Simple products", "A product with a single row and Product Type = Simple is imported as a simple product: its SKU, price and stock live on the product itself."],
  ["Variable products", "Set Product Type = Variable and give every variant row its option values (Size, Color, Capacity, Ply…). Only the option columns your product needs have to be filled."],
  ["SKU must be unique", "Across the whole catalog — products and variants. Leave the SKU empty on a variant row to have one generated from the Product ID and the option values."],
  ["Category must exist", "Create categories first under Product Catalog → Categories, or tick “Create missing categories” in the import wizard."],
  ["Subcategory must belong to the category", "The subcategory is looked up under the row's Category."],
  ["Price, Stock and MOQ must be numeric", "Price in rupees (25 or 25.50). Stock is a whole number ≥ 0. MOQ is a whole number ≥ 1. An empty price means quotation-only."],
  ["Images", "Put file names (box-brown.jpg) in the Image column and upload a ZIP with those files, or paste full https:// URLs. Files named after a SKU or Product ID are matched automatically."],
  ["Validation first", "The wizard validates the whole file and shows errors and warnings BEFORE anything is written. Errors block the import; warnings can be fixed or accepted."],
  ["All or nothing", "The import is one database transaction: if anything fails, nothing is imported."],
];

export function buildTemplate(kind: "simple" | "variable"): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  if (kind === "simple") {
    const headers = ["SKU", "Product Name", "Category", "Subcategory", "Type", "Description", "Material", "GSM", "Thickness", "Color", "Size", "Price", "Compare At Price", "Stock", "MOQ", "Weight", "Image", "Status"];
    const rows = [
      ["TAPE-001", "Brown Kraft Paper Tape", "Tapes", "Kraft Tape", "Simple", "Water-activated kraft paper tape, 48 mm × 50 m", "Kraft paper", "", "", "Brown", "48 mm x 50 m", "120", "", "500", "10", "250", "tape-001.jpg", "Active"],
      ["MAILER-010", "Poly Mailer Bag", "Mailers", "Poly Mailers", "Simple", "Self-seal poly mailer", "LDPE", "", "60 micron", "White", "10 x 12 in", "4.50", "", "5000", "100", "12", "mailer-010.jpg", "Active"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Products");
  } else {
    const products = [
      ["Product ID", "Product Name", "Product Type", "Category", "Subcategory", "Description", "Material", "GSM", "Thickness", "Brand", "Status", "Featured", "Image"],
      ["BOX001", "Corrugated Shipping Box", "Variable", "Boxes", "5 Ply Boxes", "Heavy-duty 5-ply corrugated shipping box for e-commerce and industrial packaging.", "Kraft paper", "120", "5 Ply", "Zolo", "Active", "No", "box001.jpg"],
      ["TAPE002", "BOPP Packing Tape", "Variable", "Tapes", "BOPP Tape", "Clear and brown BOPP tape in two widths.", "BOPP film", "", "40 micron", "Zolo", "Active", "No", ""],
    ];
    const variants = [
      ["Product ID", "Product Name", "SKU", "Size", "Color", "Width", "Price", "Compare At Price", "Stock", "MOQ", "Weight", "Length", "Width (cm)", "Height", "Variant Image", "Status"],
      ["BOX001", "Corrugated Shipping Box", "BOX001-664-BR", "6x6x4", "Kraft Brown", "", "25", "30", "500", "50", "180", "6", "6", "4", "box001-664-br.jpg", "Active"],
      ["BOX001", "Corrugated Shipping Box", "BOX001-664-WH", "6x6x4", "White", "", "28", "", "300", "50", "180", "6", "6", "4", "box001-664-wh.jpg", "Active"],
      ["BOX001", "Corrugated Shipping Box", "BOX001-886-BR", "8x8x6", "Kraft Brown", "", "32", "", "400", "50", "260", "8", "8", "6", "box001-886-br.jpg", "Active"],
      ["BOX001", "Corrugated Shipping Box", "BOX001-886-WH", "8x8x6", "White", "", "35", "", "250", "50", "260", "8", "8", "6", "box001-886-wh.jpg", "Active"],
      ["TAPE002", "BOPP Packing Tape", "TAPE002-48-CL", "", "Clear", "48 mm", "45", "", "1000", "36", "120", "", "", "", "tape002-48-cl.jpg", "Active"],
      ["TAPE002", "BOPP Packing Tape", "TAPE002-48-BR", "", "Brown", "48 mm", "45", "", "1000", "36", "120", "", "", "", "tape002-48-br.jpg", "Active"],
      ["TAPE002", "BOPP Packing Tape", "TAPE002-72-CL", "", "Clear", "72 mm", "68", "", "600", "24", "180", "", "", "", "", "Active"],
    ];
    // "Width" (option, e.g. tape width) vs "Width (cm)" (dimension) are both
    // shown so the mapping step demonstrates re-mapping a column to an option.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(products), "Products");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(variants), "Variants");
    const single = [
      ["SKU", "Product ID", "Product Name", "Category", "Subcategory", "Type", "Description", "Material", "GSM", "Thickness", "Color", "Size", "Price", "Stock", "MOQ", "Image", "Status"],
      ["BOX001-BR-664", "BOX001", "Corrugated Box", "Boxes", "5 Ply Boxes", "Variable", "Heavy-duty box", "Kraft", "120", "5mm", "Kraft Brown", "6x6x4", "25", "500", "50", "box.jpg", "Active"],
      ["BOX001-WH-664", "BOX001", "Corrugated Box", "Boxes", "5 Ply Boxes", "Variable", "Heavy-duty box", "Kraft", "120", "5mm", "White", "6x6x4", "28", "300", "50", "box-white.jpg", "Active"],
      ["BOX001-BR-886", "BOX001", "Corrugated Box", "Boxes", "5 Ply Boxes", "Variable", "Heavy-duty box", "Kraft", "120", "5mm", "Kraft Brown", "8x8x6", "32", "400", "50", "box.jpg", "Active"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(single), "Single-sheet example");
  }
  const how = XLSX.utils.aoa_to_sheet(HOW_TO);
  how["!cols"] = [{ wch: 36 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, how, "How to Import Products");
  return wb;
}
