import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  ImageOff,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog } from "../../components/ui";
import { getProductBySku, hydrateCatalog } from "../../catalog-store";
import { hydrateCategories } from "../../categories-store";
import { hydrateCategoryTree } from "@/lib/categories";
import { catalogApi } from "@/lib/catalog-api";
import { categories } from "../../mock-data-ext";
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

const ACCEPT = ".xlsx,.xls,.csv,.zip";

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
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [zip, setZip] = useState<ZipContents | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dupeMode, setDupeMode] = useState<DupeMode>("update"); // default: update existing
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
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

  const handleFile = async (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const isZip = ext === "zip";
    if (!["xlsx", "xls", "csv", "zip"].includes(ext)) {
      toast.error("Unsupported file", "Upload an .xlsx, .xls, .csv or .zip file.");
      return;
    }
    if (isZip && f.size > LIMITS.ZIP_MAX_BYTES) {
      toast.error("ZIP too large", `Maximum ZIP size is ${formatBytes(LIMITS.ZIP_MAX_BYTES)}.`);
      return;
    }
    if (!isZip && f.size > LIMITS.SPREADSHEET_MAX_BYTES) {
      toast.error("File too large", `Maximum spreadsheet size is ${formatBytes(LIMITS.SPREADSHEET_MAX_BYTES)}.`);
      return;
    }

    setFile(f);
    setParsing(true);
    try {
      let zipContents: ZipContents | null = null;
      let sheetData: ArrayBuffer | Uint8Array;

      if (isZip) {
        zipContents = parseZip(new Uint8Array(await f.arrayBuffer()));
        if (!zipContents.spreadsheet) {
          toast.error("No spreadsheet in ZIP", "Include products.xlsx / .xls / .csv inside the ZIP.");
          reset();
          return;
        }
        sheetData = zipContents.spreadsheet.data;
      } else {
        sheetData = await f.arrayBuffer();
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
      const embedded = ext === "xlsx" || isZip ? extractEmbeddedImages(sheetU8) : [];
      const embeddedByRow = indexEmbeddedImagesByRow(embedded);

      const images = new Map<string, ZipImage>(zipContents?.images ?? []);
      const embeddedKeys = new Map<number, { key: string }[]>();
      for (const [sheetRow, imgs] of embeddedByRow) {
        const keys: { key: string }[] = [];
        imgs.forEach((img, n) => {
          // Namespaced key so an embedded picture can never collide with a
          // ZIP entry of the same filename.
          const key = `embedded:${sheetRow}:${n}`;
          images.set(key, { path: img.path, base: img.base, ext: img.ext, data: img.data });
          keys.push({ key });
        });
        embeddedKeys.set(sheetRow, keys);
      }

      const parsed = validateRows(raws, {
        existingSku: (sku) => !!getProductBySku(sku),
        knownCategories: categories.map((c) => c.name),
        zipImages: images.size > 0 ? images : undefined,
        embeddedByRow: embeddedKeys.size > 0 ? embeddedKeys : undefined,
      });

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
        // Category insight: how many distinct categories the file references,
        // and which of those don't exist yet (the importer will create them).
        categories: new Set(rows.map((r) => r.category.trim().toLowerCase()).filter(Boolean)).size,
        newCategories: new Set(
          rows
            .map((r) => r.category.trim())
            .filter((c) => c && !categories.some((k) => k.name.toLowerCase() === c.toLowerCase()))
            .map((c) => c.toLowerCase()),
        ).size,
        duplicateSkus: rows.filter((r) => r.isDuplicate).length,
      }
    : null;

  const runImport = async () => {
    if (!rows) return;
    setImporting(true);
    try {
      let uploaded = 0;
      let localFailed = 0;
      const payload: CatalogProduct[] = [];

      for (const r of rows) {
        if (r.status === "error") { localFailed++; continue; }

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

      // Upsert by SKU in PostgreSQL, then re-hydrate the store from the DB so
      // the UI shows exactly what was saved (survives refresh + restart).
      const server = await catalogApi.importBatch(payload, dupeMode);
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
    }
  };

  const errorRows = rows?.filter((r) => r.messages.length > 0) ?? [];
  const importable = counts ? counts.ready + counts.warning : 0;

  return (
    <>
      <Button variant="secondary" icon={Upload} onClick={() => setOpen(true)}>Bulk Import</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Bulk import products"
        description="Upload Excel, CSV, or ZIP to add products in bulk. ZIP files can include product images."
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
              <div className="mr-auto flex items-center gap-2 text-xs">
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
              <Button variant="ghost" onClick={reset}>Cancel</Button>
              <Button variant="primary" disabled={importable === 0} loading={importing} onClick={runImport}>
                Import {importable} Product{importable === 1 ? "" : "s"}
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
        {result ? (
          // ---------- Result ----------
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold erp-text">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden /> Import completed
            </div>
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
              Imported products are live in the Product Catalog and on the buyer website.
            </p>
          </div>
        ) : !rows ? (
          // ---------- Upload ----------
          <div className="space-y-3">
            {!file ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors",
                  dragOver ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "erp-border erp-surface-2",
                )}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full erp-surface erp-text-muted">
                  <Upload className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-sm font-semibold erp-text">Drag &amp; drop your file here</p>
                <p className="text-xs erp-text-faint">or click to browse</p>
                <div className="mt-1 space-y-0.5 text-[11px] erp-text-faint">
                  <p>Supported: XLSX, XLS, CSV, ZIP</p>
                  <p>Spreadsheet max {formatBytes(LIMITS.SPREADSHEET_MAX_BYTES)} · ZIP with images max {formatBytes(LIMITS.ZIP_MAX_BYTES)}</p>
                </div>
                <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border erp-border erp-surface-2 p-3">
                {file.name.toLowerCase().endsWith(".zip")
                  ? <FileArchive className="h-8 w-8 text-primary-500" aria-hidden />
                  : <FileSpreadsheet className="h-8 w-8 text-emerald-500" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold erp-text">{file.name}</p>
                  <p className="text-xs erp-text-faint">{file.name.split(".").pop()?.toUpperCase()} · {formatBytes(file.size)}</p>
                </div>
                {parsing ? (
                  <span className="text-xs erp-text-muted">Parsing…</span>
                ) : (
                  <button onClick={reset} aria-label="Remove file" className="flex h-8 w-8 items-center justify-center rounded-lg erp-text-muted hover:erp-surface">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            )}
            <p className="text-center text-xs erp-text-faint">
              ZIP structure: <code className="font-mono">products.xlsx</code> + <code className="font-mono">images/SKU.jpg</code>.{" "}
              <button onClick={downloadZipExample} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Download the ZIP example</button>.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm erp-text-muted">No valid rows found. Check your file and try again.</div>
        ) : (
          // ---------- Preview ----------
          <div className="space-y-3">
            <p className="text-sm font-semibold erp-text">
              {counts!.total} product{counts!.total === 1 ? "" : "s"} found
              {zip && (
                <span className="font-normal erp-text-muted">
                  {" "}· {counts!.imagesFound} images found · {counts!.imagesMatched} matched · {counts!.imagesMissing} missing
                </span>
              )}
              <span className="font-normal erp-text-muted"> · {counts!.error} invalid</span>
            </p>

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
                                : r.imageMatch.source === "column" ? "Matched by name"
                                : "External URL"}
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
              Warnings still import — e.g. "Image not found" imports the product without an image. Only Error rows are skipped.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
