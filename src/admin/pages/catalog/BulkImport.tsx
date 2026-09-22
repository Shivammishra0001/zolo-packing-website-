import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  History,
  ImageOff,
  Upload,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog } from "../../components/ui";
import { getProductBySku, hydrateCatalog } from "../../catalog-store";
import { hydrateCategories } from "../../categories-store";
import { hydrateCategoryTree } from "@/lib/categories";
import { catalogApi } from "@/lib/catalog-api";
import { getCategories } from "../../categories-store";
import type { CatalogProduct } from "../../types";
import {
  LIMITS,
  MIME_BY_EXT,
  buildErrorReportCsv,
  buildTemplateWorkbook,
  buildZipExample,
  formatBytes,
  parseSpreadsheetBuffer,
  parseZip,
  validateRows,
  type ParsedRow,
  type RawRow,
  type ZipContents,
  type ZipImage,
} from "./bulk-import-lib";
import { extractEmbeddedImages, indexEmbeddedImagesByRow } from "./xlsx-embedded-images";

// ============================================================
// Bulk product import — XLSX / XLS / CSV / ZIP (spreadsheet + images).
// ZIP images are matched to SKUs (or the Image column), turned into object
// URLs via the app's existing image pipeline (product.images[] strings — the
// same field the manual editor uses), and imported into the shared catalog
// store so they appear in the admin catalog AND the buyer website.
// No base64 is stored; no parallel import module.
// ============================================================

/** Uint8Array → base64 (chunked to stay under call-stack limits). */
function u8ToBase64(u8: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

type DupeMode = "update" | "skip" | "create";

interface ImportResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  imagesUploaded: number;
  categoriesCreated: number;
  subcategoriesCreated: number;
}

/** Phased progress (spec: Reading Excel → categories → products → images). */
type Phase = "reading" | "images" | "saving" | "done";
interface Progress {
  phase: Phase;
  productsDone: number;
  productsTotal: number;
  imagesDone: number;
  imagesTotal: number;
}

/**
 * The category structure an import will produce, built from the validated
 * rows: category → subcategory → product count, each flagged NEW when the
 * database does not have it yet. Shown to the admin BEFORE anything is saved.
 */
function buildStructure(rows: ParsedRow[]) {
  const cats = new Map<string, { name: string; isNew: boolean; products: number; subs: Map<string, { name: string; isNew: boolean; products: number }> }>();
  for (const r of rows) {
    if (r.status === "error" || !r.category) continue;
    const ck = r.category.trim().toLowerCase().replace(/\s+/g, " ");
    let c = cats.get(ck);
    if (!c) { c = { name: r.category, isNew: r.isNewCategory, products: 0, subs: new Map() }; cats.set(ck, c); }
    c.products++;
    if (r.subcategory) {
      const sk = r.subcategory.trim().toLowerCase().replace(/\s+/g, " ");
      let sub = c.subs.get(sk);
      if (!sub) { sub = { name: r.subcategory, isNew: r.isNewSubcategory, products: 0 }; c.subs.set(sk, sub); }
      sub.products++;
    }
  }
  return [...cats.values()].map((c) => ({ ...c, subs: [...c.subs.values()] }));
}

function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadTemplate() {
  XLSX.writeFile(buildTemplateWorkbook(), "zolo-product-import-template.xlsx");
}

function downloadZipExample() {
  const bytes = buildZipExample();
  const copy = new Uint8Array(bytes); // detach from any shared buffer typing
  download("zolo-import-example.zip", new Blob([copy.buffer], { type: "application/zip" }));
}

/** Clean "No Image" placeholder — never a browser broken-image icon. */
function NoImage({ size, label = "No Image" }: { size: string; label?: string }) {
  return (
    <span
      className={cn(size, "flex flex-col items-center justify-center gap-0.5 rounded-lg erp-surface-2 text-center")}
      title="Image missing"
    >
      <ImageOff className="h-4 w-4 erp-text-faint" aria-hidden />
      <span className="text-[8px] leading-none erp-text-faint">{label}</span>
    </span>
  );
}

/**
 * Small thumb that renders a real image for URLs and text for emoji. If the
 * image URL fails to load it falls back to the placeholder instead of showing a
 * broken-image icon — the table never breaks and React never crashes.
 */
function Thumb({ src, size = "h-9 w-9" }: { src?: string; size?: string }) {
  const [failed, setFailed] = useState(false);
  // Reset the error state when the source changes.
  useEffect(() => setFailed(false), [src]);

  if (!src) return <NoImage size={size} />;
  const isUrl = /^(blob:|data:|https?:|\/)/.test(src);
  if (!isUrl) {
    // emoji / text placeholder
    return <span className={cn(size, "flex items-center justify-center rounded-lg erp-surface-2 text-lg")}>{src}</span>;
  }
  if (failed) return <NoImage size={size} />;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(size, "rounded-lg object-cover erp-surface-2")}
    />
  );
}

export function BulkImportButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Optional second upload: an images-only ZIP next to a plain spreadsheet
  // ("products.xlsx + products.zip together").
  const [imagesFile, setImagesFile] = useState<File | null>(null);
  // Parsed inputs kept so validation can re-run when an option changes
  // (e.g. ticking "Create missing categories") without re-reading the files.
  const [analysis, setAnalysis] = useState<{ raws: RawRow[]; images: Map<string, ZipImage>; embeddedKeys: Map<number, { key: string }[]>; zipContents: ZipContents | null } | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [zip, setZip] = useState<ZipContents | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dupeMode, setDupeMode] = useState<DupeMode>("update"); // default: update existing
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  // Live progress for large imports (thousands of images take minutes).
  const [progress, setProgress] = useState<Progress | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // One object URL per zip image, shared by preview + import. URLs consumed by
  // imported products stay alive; the rest are revoked on close/reset.
  const urlMap = useRef<Map<string, string>>(new Map());
  const usedUrls = useRef<Set<string>>(new Set());

  const revokeUnused = () => {
    for (const [, url] of urlMap.current) {
      if (!usedUrls.current.has(url)) URL.revokeObjectURL(url);
    }
    urlMap.current.clear();
    usedUrls.current.clear();
  };

  const reset = () => {
    revokeUnused();
    setFile(null);
    setImagesFile(null);
    setAnalysis(null);
    setRows(null);
    setZip(null);
    setParsing(false);
    setResult(null);
  };
  const close = () => { setOpen(false); reset(); };
  // Safety net: revoke on unmount
  useEffect(() => () => revokeUnused(), []);

  const urlFor = (zipKey: string | undefined): string | undefined => {
    if (!zipKey || !zip) return undefined;
    const cached = urlMap.current.get(zipKey);
    if (cached) return cached;
    const img = zip.images.get(zipKey);
    if (!img) return undefined;
    const copy = new Uint8Array(img.data);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: MIME_BY_EXT[img.ext] ?? "image/jpeg" }));
    urlMap.current.set(zipKey, url);
    return url;
  };

  /**
   * Run validation over the parsed inputs. Categories come from the REAL
   * category tree (API-backed store), images from the ZIP + embedded pictures.
   */
  const validate = (a: NonNullable<typeof analysis>) =>
    validateRows(a.raws, {
      existingSku: (sku) => !!getProductBySku(sku),
      existingProductId: (sku) => getProductBySku(sku)?.id,
      knownCategories: getCategories().map((c) => c.name),
      categoryTree: getCategories().map((c) => ({
        id: c.id, name: c.name, slug: c.slug,
        subcategories: c.subcategories.map((sc) => ({ id: sc.id, name: sc.name, slug: sc.slug })),
      })),
      zipImages: a.images.size > 0 ? a.images : undefined,
      embeddedByRow: a.embeddedKeys.size > 0 ? a.embeddedKeys : undefined,
    });

  /**
   * Accepts one spreadsheet, one ZIP (spreadsheet + images), or BOTH a
   * spreadsheet and an images-only ZIP dropped/selected together. A second
   * drop adds to what is already there (e.g. the ZIP after the xlsx).
   */
  const handleFiles = async (incoming: File[]) => {
    let sheetFile = file && !file.name.toLowerCase().endsWith(".zip") ? file : null;
    let zipFile = imagesFile ?? (file?.name.toLowerCase().endsWith(".zip") ? file : null);
    for (const f of incoming) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "zip") {
        if (f.size > LIMITS.ZIP_MAX_BYTES) { toast.error("ZIP too large", `Maximum ZIP size is ${formatBytes(LIMITS.ZIP_MAX_BYTES)}.`); return; }
        zipFile = f;
      } else if (["xlsx", "xls", "csv"].includes(ext)) {
        if (f.size > LIMITS.SPREADSHEET_MAX_BYTES) { toast.error("File too large", `Maximum spreadsheet size is ${formatBytes(LIMITS.SPREADSHEET_MAX_BYTES)}.`); return; }
        sheetFile = f;
      } else {
        toast.error("Unsupported file", "Upload an .xlsx, .xls, .csv or .zip file.");
        return;
      }
    }
    if (!sheetFile && !zipFile) return;

    setFile(sheetFile ?? zipFile);
    setImagesFile(sheetFile && zipFile ? zipFile : null);
    setParsing(true);
    try {
      let zipContents: ZipContents | null = null;
      let sheetData: ArrayBuffer | Uint8Array | null = null;
      let sheetExt = sheetFile ? (sheetFile.name.split(".").pop()?.toLowerCase() ?? "") : "";

      if (zipFile) zipContents = parseZip(new Uint8Array(await zipFile.arrayBuffer()));
      if (sheetFile) {
        sheetData = await sheetFile.arrayBuffer();
      } else if (zipContents?.spreadsheet) {
        sheetData = zipContents.spreadsheet.data;
        sheetExt = zipContents.spreadsheet.name.split(".").pop()?.toLowerCase() ?? "xlsx";
      } else {
        // Images-only ZIP with no sheet yet: keep it and wait for the xlsx.
        toast.info("Images ZIP received", "Now add the products spreadsheet (.xlsx / .csv) to match them.");
        setFile(null);
        setImagesFile(zipFile);
        return;
      }

      const raws = parseSpreadsheetBuffer(sheetData);
      if (raws.length === 0) {
        toast.error("Empty file", "No product rows found in the spreadsheet.");
        setRows([]);
        setZip(zipContents);
        return;
      }

      // Recover pictures embedded INSIDE the workbook (SheetJS drops the
      // drawing layer, which is why such products previously showed "No
      // Image"). They are merged into the same image map the ZIP path uses, so
      // preview, upload and commit stay on one code path.
      const sheetU8 = sheetData instanceof Uint8Array ? sheetData : new Uint8Array(sheetData);
      const embedded = sheetExt === "xlsx" ? extractEmbeddedImages(sheetU8) : [];
      const embeddedByRow = indexEmbeddedImagesByRow(embedded);

      const images = new Map<string, ZipImage>(zipContents?.images ?? []);
      const embeddedKeys = new Map<number, { key: string }[]>();
      for (const [sheetRow, imgs] of embeddedByRow) {
        const keys: { key: string }[] = [];
        imgs.forEach((img, n) => {
          // Namespaced key so an embedded picture can never collide with a
          // ZIP entry of the same filename.
          const key = `embedded:${sheetRow}:${n}`;
          images.set(key, { path: img.path, base: img.base, ext: img.ext, dir: "", data: img.data });
          keys.push({ key });
        });
        embeddedKeys.set(sheetRow, keys);
      }

      const a = { raws, images, embeddedKeys, zipContents };
      setAnalysis(a);
      const parsed = validate(a);

      // Preview/commit read images from `zip.images`; synthesize a container
      // when the workbook carried pictures but no ZIP was uploaded.
      const merged: ZipContents =
        zipContents ?? { spreadsheet: null, images: new Map(), skipped: [], totalUncompressedBytes: 0 };
      merged.images = images;
      setZip(images.size > 0 ? merged : zipContents);
      setRows(parsed);
      if (embedded.length > 0) {
        toast.success(
          "Embedded images found",
          `Recovered ${embedded.length} original image${embedded.length === 1 ? "" : "s"} from the workbook.`,
        );
      }
    } catch (e) {
      toast.error("Couldn't read file", e instanceof Error ? e.message : "The file may be corrupt.");
      reset();
    } finally {
      setParsing(false);
    }
  };

  const counts = rows
    ? {
        total: rows.length,
        ready: rows.filter((r) => r.status === "ready").length,
        warning: rows.filter((r) => r.status === "warning").length,
        error: rows.filter((r) => r.status === "error").length,
        imagesFound: zip?.images.size ?? 0,
        imagesMatched: rows.filter((r) => r.imageMatch.primary).length,
        imagesMissing: rows.filter((r) => r.status !== "error" && !r.imageMatch.primary).length,
        // Taxonomy insight from the validated rows: what exists, what the
        // import will create. Error rows are excluded (they do not import).
        categories: new Set(rows.filter((r) => r.status !== "error").map((r) => r.category.trim().toLowerCase()).filter(Boolean)).size,
        newCategories: new Set(rows.filter((r) => r.status !== "error" && r.isNewCategory).map((r) => r.category.trim().toLowerCase())).size,
        matchedCategories: new Set(rows.filter((r) => r.status !== "error" && r.category && !r.isNewCategory).map((r) => r.category.trim().toLowerCase())).size,
        newSubcategories: new Set(rows.filter((r) => r.status !== "error" && r.isNewSubcategory && r.subcategory).map((r) => `${r.category}::${r.subcategory}`.toLowerCase())).size,
        matchedSubcategories: new Set(rows.filter((r) => r.status !== "error" && r.subcategory && !r.isNewSubcategory).map((r) => `${r.category}::${r.subcategory}`.toLowerCase())).size,
        duplicateSkus: rows.filter((r) => r.isDuplicate).length,
      }
    : null;
  const structure = useMemo(() => (rows ? buildStructure(rows) : []), [rows]);
  const createsTaxonomy = (counts?.newCategories ?? 0) + (counts?.newSubcategories ?? 0) > 0;

  const runImport = async () => {
    if (!rows) return;
    setImporting(true);
    cancelRef.current = false;
    // Rows that will actually import (errors are skipped) and their total image
    // count, so the progress bars have real denominators.
    const importRows = rows.filter((r) => r.status !== "error");
    const imagesTotal = zip
      ? importRows.reduce((n, r) => n + (r.imageMatch.primary ? 1 : 0) + r.imageMatch.gallery.length, 0)
      : 0;
    setProgress({ phase: imagesTotal > 0 ? "images" : "saving", productsDone: 0, productsTotal: importRows.length, imagesDone: 0, imagesTotal });
    try {
      let uploaded = 0;
      let localFailed = 0;
      let cancelled = false;
      const payload: CatalogProduct[] = [];

      for (const r of rows) {
        if (r.status === "error") { localFailed++; continue; }
        // Cancel stops between products — already-uploaded images stay on disk
        // (harmless orphans) but nothing is written to the catalog.
        if (cancelRef.current) { cancelled = true; break; }
        setProgress((p) => (p ? { ...p, productsDone: p.productsDone + 1 } : p));

        // ZIP images → uploaded to the server (files on disk, real URLs) so
        // they survive refresh. Never blob:/base64 in the database.
        let primaryUrl: string | undefined;
        const gallery: string[] = [];
        if (zip) {
          // An individual image upload that fails must NOT fail the product —
          // the product imports without that image (image is optional). We
          // swallow the per-image error and just skip that URL.
          const upload = async (key: string | undefined) => {
            if (!key) return undefined;
            const img = zip.images.get(key);
            if (!img) return undefined;
            try {
              const url = await catalogApi.uploadImage(
                img.path.split("/").pop() ?? key,
                MIME_BY_EXT[img.ext] ?? "image/jpeg",
                u8ToBase64(img.data),
              );
              uploaded++;
              setProgress((p) => (p ? { ...p, imagesDone: p.imagesDone + 1 } : p));
              return url;
            } catch {
              return undefined; // image upload failed → product still imports
            }
          };
          primaryUrl = await upload(r.imageMatch.primary);
          for (const g of r.imageMatch.gallery) {
            const u = await upload(g);
            if (u) gallery.push(u);
          }
        }
        if (!primaryUrl && r.imageName && /^https?:\/\//i.test(r.imageName)) primaryUrl = r.imageName;

        payload.push({
          ...(r.data as CatalogProduct),
          id: `PRD-${Math.floor(2000 + Math.random() * 8000)}`,
          imageEmoji: primaryUrl ?? "📦",
          images: primaryUrl ? [primaryUrl, ...gallery] : ["📦"],
          variants: [{ id: "V1", label: "Default", sku: r.sku, moq: r.data.moq ?? 500, basePrice: r.data.basePrice ?? 0, inStock: r.data.stock ?? 0 }],
          updatedAt: new Date().toISOString(),
        });
      }

      // Cancelled before any DB write — nothing saved, report and stop.
      if (cancelled) {
        toast.info("Import cancelled", `No products were saved. ${uploaded} image(s) had already uploaded.`);
        return;
      }

      // Upsert by SKU in PostgreSQL (categories → subcategories → products in
      // one server call), then re-hydrate the store from the DB so the UI
      // shows exactly what was saved (survives refresh + restart). New
      // categories are created ONLY because the admin saw them in the
      // structure preview and clicked "Create & Import".
      setProgress((p) => (p ? { ...p, phase: "saving" } : p));
      const server = await catalogApi.importBatch(payload, dupeMode, {
        fileName: file?.name,
        fileSizeBytes: (file?.size ?? 0) + (imagesFile?.size ?? 0),
        imagesMatched: payload.filter((p) => Array.isArray(p.images) && p.images.some((u) => /^https?:|^\//.test(u))).length,
        createMissingCategories: createsTaxonomy,
      });
      setProgress((p) => (p ? { ...p, phase: "done" } : p));
      // Re-read BOTH products and the category tree from the database: an
      // import creates categories/subcategories, and Admin + storefront must
      // reflect them without a page reload.
      await Promise.all([
        hydrateCatalog(),
        hydrateCategories(true),
        hydrateCategoryTree(true),
      ]);

      setResult({
        processed: rows.length,
        created: server.created,
        updated: server.updated,
        skipped: server.skipped,
        failed: localFailed + server.failed,
        imagesUploaded: uploaded,
        categoriesCreated: server.categoriesCreated ?? 0,
        subcategoriesCreated: server.subcategoriesCreated ?? 0,
      });
      const serverErrs = server.errors.map((e) => `${e.sku}: ${e.error}`).join("; ");
      toast.success(
        "Import saved to database",
        `Created ${server.created} · Updated ${server.updated} · Skipped ${server.skipped} · Failed ${localFailed + server.failed}${serverErrs ? ` · ${serverErrs}` : ""}`,
      );
    } catch (e) {
      // No silent failures and no fake local-only fallback. The message must
      // name the actual cause — `request()` already turns an unreachable API
      // and non-JSON responses into specific text, so surface it verbatim
      // rather than replacing it with a generic string.
      toast.error(
        "Import failed — nothing saved",
        e instanceof Error ? e.message : "Unknown error while saving to the database.",
      );
    } finally {
      setImporting(false);
      setProgress(null);
      cancelRef.current = false;
    }
  };

  const errorRows = rows?.filter((r) => r.messages.length > 0) ?? [];
  const importable = counts ? counts.ready + counts.warning : 0;

  return (
    <>
      <Button variant="secondary" icon={Upload} onClick={() => setOpen(true)}>Import Products</Button>
      <Link to="/admin/catalog/imports" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold erp-text-muted hover:erp-text">
        <History className="h-4 w-4" aria-hidden /> Import History
      </Link>
      <Dialog
        open={open}
        onClose={close}
        title="Import products"
        description="Upload the products Excel (and an images ZIP). Categories, subcategories and products are detected, validated and previewed before anything is saved."
        footer={
          result ? (
            <>
              {errorRows.length > 0 && (
                <Button
                  variant="ghost"
                  icon={Download}
                  onClick={() => download("zolo-import-errors.csv", new Blob([buildErrorReportCsv(rows!)], { type: "text/csv" }))}
                >
                  Download Error Report
                </Button>
              )}
              <Button variant="primary" onClick={close}>Done</Button>
            </>
          ) : rows && rows.length > 0 ? (
            <>
              <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="erp-text-muted">Duplicate SKU:</span>
                <select
                  value={dupeMode}
                  onChange={(e) => setDupeMode(e.target.value as DupeMode)}
                  className="h-8 rounded-md border erp-border erp-surface px-2 text-xs erp-text"
                  aria-label="Duplicate SKU behaviour"
                >
                  <option value="update">Update existing product</option>
                  <option value="skip">Skip existing product</option>
                  <option value="create">Create new SKU</option>
                </select>
              </div>
              {importing ? (
                <Button variant="ghost" onClick={() => { cancelRef.current = true; }}>Cancel import</Button>
              ) : (
                <Button variant="ghost" onClick={reset}>Cancel Import</Button>
              )}
              <Button variant="primary" disabled={importable === 0} loading={importing} onClick={runImport}>
                {createsTaxonomy ? `Create & Import ${importable} Product${importable === 1 ? "" : "s"}` : `Confirm & Import ${importable} Product${importable === 1 ? "" : "s"}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" icon={Download} onClick={downloadTemplate}>Download Template</Button>
              <Button variant="ghost" icon={FileArchive} onClick={downloadZipExample}>Download ZIP Example</Button>
              <Button variant="ghost" onClick={close}>Cancel</Button>
            </>
          )
        }
      >
        {importing && progress && (
          // ---------- Live progress, phase by phase ----------
          <div className="mb-4 space-y-3 rounded-xl border erp-border-soft erp-surface-2 p-4" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-bold erp-text">
              <Upload className="h-4 w-4 animate-pulse text-primary-500" aria-hidden /> Importing…
            </div>
            {file && <p className="text-xs erp-text-muted">{file.name}{imagesFile ? ` + ${imagesFile.name}` : ""}</p>}
            {(() => {
              const order: Phase[] = ["reading", "images", "saving", "done"];
              const idx = order.indexOf(progress.phase);
              const pct = (phase: Phase, live: number) => (order.indexOf(phase) < idx ? 100 : order.indexOf(phase) > idx ? 0 : live);
              const bars = [
                { label: "Reading Excel", pct: 100 },
                ...(progress.imagesTotal > 0 ? [{ label: `Processing images (${progress.imagesDone.toLocaleString("en-IN")} / ${progress.imagesTotal.toLocaleString("en-IN")})`, pct: pct("images", progress.imagesTotal ? Math.round((progress.imagesDone / progress.imagesTotal) * 100) : 100) }] : []),
                { label: "Processing categories & subcategories", pct: pct("saving", 50) },
                { label: `Processing products (${progress.productsTotal.toLocaleString("en-IN")})`, pct: pct("saving", 50) },
              ];
              return bars.map((bar) => (
                <div key={bar.label}>
                  <div className="mb-1 flex justify-between text-xs erp-text-muted">
                    <span>{bar.label}{bar.pct >= 100 ? " ✓" : bar.pct > 0 ? "…" : ""}</span>
                    <span className="tabular-nums">{bar.pct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full erp-surface">
                    <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${bar.pct}%` }} />
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
        {result ? (
          // ---------- Result ----------
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold erp-text">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden /> Import complete ✓
            </div>
            <ul className="space-y-0.5 text-sm erp-text" data-testid="import-result">
              <li><strong>{result.created + result.updated}</strong> Products imported ({result.created} created · {result.updated} updated · {result.skipped} skipped · {result.failed} failed)</li>
              <li><strong>{result.categoriesCreated}</strong> Categories created</li>
              <li><strong>{result.subcategoriesCreated}</strong> Subcategories created</li>
              <li><strong>{result.imagesUploaded}</strong> Images matched</li>
            </ul>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Processed", value: result.processed },
                { label: "Created", value: result.created },
                { label: "Updated", value: result.updated },
                { label: "Skipped", value: result.skipped },
                { label: "Failed", value: result.failed },
                { label: "Images uploaded", value: result.imagesUploaded },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border erp-border-soft erp-surface-2 p-2.5">
                  <div className="text-lg font-extrabold erp-text">{c.value}</div>
                  <div className="text-[11px] erp-text-muted">{c.label}</div>
                </div>
              ))}
            </div>
            {errorRows.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                {errorRows.slice(0, 20).map((r) => (
                  <p key={r.row}>Row {r.row} · {r.sku || "—"} — {r.messages.join("; ")}</p>
                ))}
                {errorRows.length > 20 && <p>…and {errorRows.length - 20} more (see report).</p>}
              </div>
            )}
            <p className="text-xs erp-text-faint">
              Imported products are live in the Product Catalog and on the buyer website.{" "}
              <Link to="/admin/catalog/categories" onClick={close} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Open Categories</Link>
            </p>
          </div>
        ) : !rows ? (
          // ---------- Upload: Excel + (optional) images ZIP ----------
          <div className="space-y-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const fs = Array.from(e.dataTransfer.files ?? []); if (fs.length) void handleFiles(fs); }}
              className={cn("grid gap-3 rounded-xl border-2 border-dashed p-3 transition-colors sm:grid-cols-2", dragOver ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "erp-border")}
            >
              {/* Excel slot */}
              <button type="button" onClick={() => inputRef.current?.click()} disabled={parsing} className="flex flex-col items-center justify-center gap-1.5 rounded-lg border erp-border erp-surface-2 px-4 py-6 text-center hover:border-primary-400" data-testid="upload-excel">
                {file && !file.name.toLowerCase().endsWith(".zip")
                  ? <><FileSpreadsheet className="h-7 w-7 text-emerald-500" aria-hidden /><span className="text-sm font-semibold erp-text">Excel: {file.name} ✓</span><span className="text-[11px] erp-text-faint">{formatBytes(file.size)} · click to replace</span></>
                  : <><FileSpreadsheet className="h-7 w-7 erp-text-faint" aria-hidden /><span className="text-sm font-semibold erp-text">Upload Excel</span><span className="text-[11px] erp-text-faint">products.xlsx · .xls · .csv (max {formatBytes(LIMITS.SPREADSHEET_MAX_BYTES)})</span></>}
              </button>
              {/* Images ZIP slot */}
              <button type="button" onClick={() => zipInputRef.current?.click()} disabled={parsing} className="flex flex-col items-center justify-center gap-1.5 rounded-lg border erp-border erp-surface-2 px-4 py-6 text-center hover:border-primary-400" data-testid="upload-zip">
                {imagesFile || file?.name.toLowerCase().endsWith(".zip")
                  ? <><FileArchive className="h-7 w-7 text-primary-500" aria-hidden /><span className="text-sm font-semibold erp-text">Images: {(imagesFile ?? file)!.name} ✓</span><span className="text-[11px] erp-text-faint">{formatBytes((imagesFile ?? file)!.size)} · click to replace</span></>
                  : <><FileArchive className="h-7 w-7 erp-text-faint" aria-hidden /><span className="text-sm font-semibold erp-text">Upload Product Images ZIP</span><span className="text-[11px] erp-text-faint">optional · SKU.jpg, SKU-1.jpg, SKU/any.jpg (max {formatBytes(LIMITS.ZIP_MAX_BYTES)})</span></>}
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.zip" multiple className="hidden" aria-label="Excel file" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void handleFiles(fs); e.target.value = ""; }} />
              <input ref={zipInputRef} type="file" accept=".zip" className="hidden" aria-label="Images ZIP" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void handleFiles(fs); e.target.value = ""; }} />
              <p className="text-center text-xs erp-text-faint sm:col-span-2">
                {parsing ? "Reading Excel…" : "Drag & drop both files here, or a single ZIP that contains products.xlsx and the images."}
                {(file || imagesFile) && !parsing && <> · <button type="button" onClick={reset} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Clear</button></>}
              </p>
            </div>
            <p className="text-center text-xs erp-text-faint">
              The Category / Subcategory columns build the catalog structure: existing ones are matched (any capitalisation), new ones are shown for confirmation before anything is created.
              Images match by SKU (<code className="font-mono">BOX001.jpg</code>, <code className="font-mono">BOX001-2.jpg</code>, <code className="font-mono">BOX001/any.jpg</code>), Product ID, the Image column, or the product name.{" "}
              <button onClick={downloadZipExample} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Download the ZIP example</button>.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm erp-text-muted">No valid rows found. Check your file and try again.</div>
        ) : (
          // ---------- Preview: nothing is saved until Confirm ----------
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs erp-text-muted">
              <span className="inline-flex items-center gap-1 font-semibold erp-text"><FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> {file?.name} ✓</span>
              {(imagesFile || zip) && <span className="inline-flex items-center gap-1 font-semibold erp-text"><FileArchive className="h-3.5 w-3.5 text-primary-500" aria-hidden /> {imagesFile?.name ?? (file?.name.toLowerCase().endsWith(".zip") ? file.name : "embedded images")} ✓</span>}
              {!imagesFile && !zip && <button type="button" onClick={() => zipInputRef.current?.click()} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">+ Add images ZIP</button>}
              <input ref={zipInputRef} type="file" accept=".zip" className="hidden" aria-label="Images ZIP" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void handleFiles(fs); e.target.value = ""; }} />
            </div>

            {/* IMPORT SUMMARY */}
            <section aria-label="Import summary" className="rounded-xl border erp-border-soft erp-surface-2 p-3" data-testid="import-summary">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide erp-text-faint">Import summary</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div><span className="erp-text-muted">Products detected:</span> <strong className="erp-text">{counts!.total}</strong></div>
                <div><span className="erp-text-muted">New Categories:</span> <strong className={counts!.newCategories ? "text-primary-600 dark:text-primary-400" : "erp-text"}>{counts!.newCategories}</strong></div>
                <div><span className="erp-text-muted">New Subcategories:</span> <strong className={counts!.newSubcategories ? "text-primary-600 dark:text-primary-400" : "erp-text"}>{counts!.newSubcategories}</strong></div>
                <div><span className="erp-text-muted">Existing Categories matched:</span> <strong className="erp-text">{counts!.matchedCategories}</strong></div>
                <div><span className="erp-text-muted">Existing Subcategories matched:</span> <strong className="erp-text">{counts!.matchedSubcategories}</strong></div>
                <div><span className="erp-text-muted">Duplicate SKUs:</span> <strong className="erp-text">{counts!.duplicateSkus}</strong></div>
                {zip && <div><span className="erp-text-muted">Images:</span> <strong className="erp-text">{counts!.imagesFound} found · {counts!.imagesMatched} matched · {counts!.imagesMissing} missing</strong></div>}
                <div><span className="erp-text-muted">Warnings:</span> <strong className="text-amber-600 dark:text-amber-400">{counts!.warning}</strong></div>
                <div><span className="erp-text-muted">Errors:</span> <strong className={counts!.error ? "text-red-600 dark:text-red-400" : "erp-text"}>{counts!.error}</strong></div>
              </div>
            </section>

            {/* CATEGORY STRUCTURE the import will produce */}
            {structure.length > 0 && (
              <section aria-label="Category structure" className="rounded-xl border erp-border-soft p-3" data-testid="import-structure">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide erp-text-faint">Category structure</h3>
                <div className="max-h-48 space-y-2 overflow-y-auto text-sm">
                  {structure.map((c) => (
                    <div key={c.name}>
                      <div className="flex items-center gap-2 font-bold erp-text">
                        {c.name}
                        {c.isNew ? <Badge tone="info">NEW CATEGORY</Badge> : <Badge tone="neutral">existing</Badge>}
                        <span className="text-xs font-normal erp-text-muted">{c.products} product{c.products === 1 ? "" : "s"}</span>
                      </div>
                      {c.subs.length > 0 && (
                        <ul className="ml-2 border-l erp-border pl-3 text-xs">
                          {c.subs.map((sub, i) => (
                            <li key={sub.name} className="flex items-center gap-2 py-0.5 erp-text">
                              <span className="erp-text-faint">{i === c.subs.length - 1 ? "└──" : "├──"}</span>
                              <span className="font-semibold">{sub.name}</span>
                              {sub.isNew && <Badge tone="info">NEW SUBCATEGORY</Badge>}
                              <span className="erp-text-muted">— {sub.products} product{sub.products === 1 ? "" : "s"}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                {createsTaxonomy && <p className="mt-2 text-xs erp-text-muted">Items marked NEW do not exist yet. They are created only when you click <strong>Create &amp; Import</strong>.</p>}
              </section>
            )}

            {/* ROW ERRORS & WARNINGS — the exact row, product and problem */}
            {errorRows.length > 0 && (
              <section aria-label="Row issues" className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/5" data-testid="import-issues">
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide erp-text-faint">Issues ({counts!.error} error{counts!.error === 1 ? "" : "s"} must be fixed · {counts!.warning} warning{counts!.warning === 1 ? "" : "s"} still import)</h3>
                <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
                  {errorRows.slice(0, 200).map((r) => (
                    <li key={r.row} className="rounded-md erp-surface px-2.5 py-1.5">
                      <div className="font-semibold erp-text">Row {r.row} · Product: {r.name || "—"}{r.sku ? ` (${r.sku})` : ""}</div>
                      {r.errors.map((e) => <div key={e} className="text-red-600 dark:text-red-400">Error: {e}</div>)}
                      {r.warnings.map((w) => <div key={w} className="text-amber-700 dark:text-amber-300">Warning: {w}</div>)}
                    </li>
                  ))}
                  {errorRows.length > 200 && <li className="erp-text-faint">…and {errorRows.length - 200} more (download the report).</li>}
                </ul>
              </section>
            )}

            <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              {[
                { label: "Total", value: counts!.total },
                { label: "Ready", value: counts!.ready },
                { label: "Warnings", value: counts!.warning },
                { label: "Errors", value: counts!.error },
                { label: "Images Found", value: counts!.imagesMatched },
                { label: "Images Missing", value: counts!.imagesMissing },
                { label: "Categories", value: counts!.categories },
                { label: "New Categories", value: counts!.newCategories },
                { label: "Duplicate SKUs", value: counts!.duplicateSkus },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border erp-border-soft erp-surface-2 p-2">
                  <div className="text-lg font-extrabold erp-text">{c.value}</div>
                  <div className="text-[11px] erp-text-muted">{c.label}</div>
                </div>
              ))}
            </div>

            <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-lg border erp-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 erp-surface-2">
                  <tr className="text-left erp-text-faint">
                    {["Image", "SKU", "Product", "Category", "Price", "Image Status", "Status", "Issues"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2.5 py-2 font-bold uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const issues = [...r.errors, ...r.warnings];
                    return (
                      <tr key={r.row} className="border-t erp-border-soft align-top">
                        <td className="px-2.5 py-1.5">
                          <Thumb src={urlFor(r.imageMatch.primary) ?? (r.imageName && /^https?:/.test(r.imageName) ? r.imageName : undefined)} size="h-9 w-9" />
                        </td>
                        <td className="max-w-28 truncate px-2.5 py-1.5 font-mono erp-text" title={r.sku || undefined}>{r.sku || "—"}</td>
                        <td className="max-w-40 truncate px-2.5 py-1.5 erp-text" title={r.name || undefined}>{r.name || "—"}</td>
                        <td className="max-w-28 truncate px-2.5 py-1.5 erp-text-muted" title={r.category || undefined}>{r.category || "—"}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 erp-text-muted">{r.price != null ? `₹${r.price.toLocaleString("en-IN")}` : "Quote"}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">
                          {r.imageMatch.primary ? (
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                              {r.imageMatch.source === "embedded" ? "Original (embedded)"
                                : r.imageMatch.source === "sku" ? "Matched by SKU"
                                : r.imageMatch.source === "productId" ? "Matched by Product ID"
                                : r.imageMatch.source === "column" ? "Matched by filename"
                                : r.imageMatch.source === "name" ? "Matched by product name"
                                : "External URL"}
                              {r.imageMatch.gallery.length > 0 && <span className="erp-text-faint"> +{r.imageMatch.gallery.length}</span>}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 erp-text-faint">
                              <ImageOff className="h-3.5 w-3.5" aria-hidden />
                              Missing
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5">
                            {r.status === "ready" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                            {r.status === "warning" && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                            {r.status === "error" && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                            <Badge tone={r.status === "ready" ? "success" : r.status === "warning" ? "warning" : "danger"}>
                              {r.status === "ready" ? "Ready" : r.status === "warning" ? "Warning" : "Error"}
                            </Badge>
                          </span>
                        </td>
                        <td className="max-w-52 px-2.5 py-1.5">
                          {issues.length === 0 ? (
                            <span className="erp-text-faint">—</span>
                          ) : (
                            <span className="block" title={issues.join(" · ")}>
                              {r.errors.map((e) => (
                                <span key={e} className="mr-1 inline-block whitespace-nowrap text-red-600 dark:text-red-400">✕ {e}</span>
                              ))}
                              {r.warnings.map((w) => (
                                <span key={w} className="mr-1 inline-block whitespace-nowrap text-amber-600 dark:text-amber-400">⚠ {w}</span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs erp-text-faint">
              <strong>{importable}</strong> importable (Ready + Warnings) · <strong>{counts!.error}</strong> skipped.
              Warnings still import — e.g. "Image not found" imports the product without that image. Only Error rows are skipped
              (missing SKU/name, duplicate SKU in the file, or a category/subcategory that does not exist in the database).
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
