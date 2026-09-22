import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, FileUp, Images, Loader2, Upload, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { ApiError, request } from "@/lib/api/client";
import { catalogApi } from "@/lib/catalog-api";
import { hydrateCatalog } from "../../catalog-store";
import { hydrateCategories } from "../../categories-store";
import { hydrateCategoryTree } from "@/lib/categories";
import { Badge, Button, Dialog } from "../../components/ui";
import { parseZip, formatBytes, MIME_BY_EXT, type ZipContents } from "./bulk-import-lib";
import {
  autoMap, applyImageUrls, buildTemplate, groupProducts, matchZipImages, parseWorkbook, toPayload, OPTION_NAMES, SYSTEM_FIELDS,
  type ColumnTarget, type ImportProduct, type Mapping, type SystemField, type Workbook,
} from "./import-wizard-lib";

// ============================================================
// Product import wizard — Upload → Map columns → Validate → Preview → Import.
//
// Simple AND variable products, single-sheet (one row = one variant, same
// Product ID = one product) or the two-sheet Products + Variants format, plus
// an optional ZIP of images matched by file name / SKU / Product ID. Nothing
// touches the database until the server-side validation passes and the admin
// confirms; the import itself is one transaction (all or nothing).
// ============================================================

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS = ["Upload", "Map columns", "Validate", "Preview", "Import"];
const ACCEPT = ".xlsx,.xls,.csv,.zip";

interface ValidationReport {
  ok: boolean;
  summary: { products: number; simple: number; variable: number; variants: number; categoriesMatched: number; subcategoriesMatched: number; newCategories: string[]; newSubcategories: string[]; toCreate: number; toUpdate: number; toSkip: number; productsWithoutImages: number };
  errors: { product: string; field: string | null; message: string }[];
  warnings: { product: string; field: string | null; message: string }[];
  preview: { ref: string; name: string; kind: "simple" | "variable"; category?: string; subcategory?: string; action: string; sku?: string; images: number; variants: { sku: string; label: string; priceMinor: number; stock: number; moq: number; image?: string }[] }[];
}
interface ImportResult { created: number; updated: number; skipped: number; variantsWritten: number; products: { id: string; sku: string; name: string; kind: string; action: string }[]; importId: string | null }

function u8ToBase64(u8: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function download(name: string, wb: XLSX.WorkBook) {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const inr = (minor: number) => (minor ? `₹${(minor / 100).toLocaleString("en-IN")}` : "On quote");
const SELECT = "h-9 w-full rounded-md border erp-border erp-surface px-2 text-sm erp-text outline-none focus:border-primary-500";

// ---------- step 2: mapping table ----------

function MappingTable({ title, headers, sample, mapping, onChange, scope }: {
  title: string; headers: string[]; sample: Record<string, string | number>[]; mapping: Mapping; onChange: (m: Mapping) => void; scope: "single" | "product" | "variant";
}) {
  const fields = SYSTEM_FIELDS.filter((f) => scope === "single" || f.scope === "both" || f.scope === scope || f.key === "ignore");
  const targetValue = (t: ColumnTarget | undefined) => (!t ? "ignore" : "option" in t ? `option:${t.option}` : t.field);
  const set = (header: string, value: string) => {
    if (value === "option:__custom") { const name = window.prompt("Option name (e.g. Ply, Capacity)"); if (name?.trim()) onChange({ ...mapping, [header]: { option: name.trim() } }); return; }
    onChange({ ...mapping, [header]: value.startsWith("option:") ? { option: value.slice(7) } : { field: value as SystemField } });
  };
  const used = new Map<string, string>();
  for (const [h, t] of Object.entries(mapping)) { const v = targetValue(t); if (v !== "ignore") used.set(v, used.has(v) ? `${used.get(v)}, ${h}` : h); }
  return (
    <div className="rounded-lg border erp-border">
      <div className="border-b erp-border px-3 py-2 text-xs font-bold uppercase tracking-wide erp-text-faint">{title}</div>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] font-bold uppercase tracking-wide erp-text-faint"><tr><th className="px-3 py-2">Excel column</th><th className="px-3 py-2">Example</th><th className="px-3 py-2">→ System field</th></tr></thead>
        <tbody className="divide-y erp-border">
          {headers.map((h) => {
            const v = targetValue(mapping[h]);
            const dup = v !== "ignore" && (used.get(v) ?? "").includes(",");
            return (
              <tr key={h}>
                <td className="px-3 py-2 font-semibold erp-text">{h}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-xs erp-text-muted">{sample.map((r) => String(r[h] ?? "")).find(Boolean) ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <select value={v} onChange={(e) => set(h, e.target.value)} className={cn(SELECT, "max-w-[280px]", dup && "border-amber-500")} aria-label={`Map column ${h}`}>
                      <optgroup label="Product / variant fields">{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>
                      {scope !== "product" && (
                        <optgroup label="Variant option (Size, Color…)">
                          {[...new Set([...OPTION_NAMES, ...(v.startsWith("option:") ? [v.slice(7)] : [])])].map((o) => <option key={o} value={`option:${o}`}>Option: {o}</option>)}
                          <option value="option:__custom">Option: custom…</option>
                        </optgroup>
                      )}
                    </select>
                    {v !== "ignore" && !dup && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Mapped" />}
                    {dup && <span className="text-[11px] text-amber-700" title={used.get(v)}>also used by {used.get(v)?.split(", ").filter((x) => x !== h).join(", ")}</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- the wizard ----------

export function BulkImportButton() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [wb, setWb] = useState<Workbook | null>(null);
  const [zip, setZip] = useState<{ name: string; contents: ZipContents } | null>(null);
  const [pMap, setPMap] = useState<Mapping>({});
  const [vMap, setVMap] = useState<Mapping>({});
  const [mode, setMode] = useState<"update" | "skip">("update");
  const [createCategories, setCreateCategories] = useState(false);
  const [products, setProducts] = useState<ImportProduct[] | null>(null);
  const [imageInfo, setImageInfo] = useState<{ matched: number; unmatched: string[]; toUpload: number } | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => { setStep(1); setFile(null); setWb(null); setZip(null); setPMap({}); setVMap({}); setProducts(null); setImageInfo(null); setReport(null); setBusy(null); setResult(null); setExpanded(new Set()); };
  const close = () => { if (busy) return; setOpen(false); reset(); };

  const readFile = async (f: File) => {
    setBusy("Reading file…");
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (/\.zip$/i.test(f.name)) {
        const contents = parseZip(buf);
        setZip({ name: f.name, contents });
        if (contents.spreadsheet) { const parsed = parseWorkbook(contents.spreadsheet.data); setWb(parsed); setFile(f); setPMap(autoMap(parsed.products.headers)); setVMap(parsed.variants ? autoMap(parsed.variants.headers) : {}); }
        else if (!wb) toast.success("Images loaded", `${contents.images.size} image(s). Now add the Excel file.`);
        return;
      }
      const parsed = parseWorkbook(buf);
      setWb(parsed); setFile(f); setPMap(autoMap(parsed.products.headers)); setVMap(parsed.variants ? autoMap(parsed.variants.headers) : {});
    } catch (e) {
      toast.error("Could not read the file", e instanceof Error ? e.message : "Unsupported file.");
    } finally { setBusy(null); }
  };
  const onDrop = async (files: FileList | null) => { for (const f of Array.from(files ?? [])) await readFile(f); };

  /** Step 2 → 3: group rows, match ZIP images, ask the server to validate. */
  const validate = async () => {
    if (!wb) return;
    setBusy("Validating…");
    try {
      const grouped = groupProducts(wb, pMap, wb.variants ? vMap : undefined);
      const imgs = matchZipImages(grouped, zip?.contents ?? null);
      setProducts(grouped);
      setImageInfo({ matched: imgs.matched, unmatched: imgs.unmatched, toUpload: imgs.uploads.length });
      const r = await request<ValidationReport>("/products/import/validate", { method: "POST", body: { products: toPayload(grouped, true), mode, createCategories } });
      setReport(r);
      setStep(3);
    } catch (e) {
      toast.error("Validation failed", e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Please try again.");
    } finally { setBusy(null); }
  };

  /** Step 5: upload matched ZIP images, then import everything in one request. */
  const runImport = async () => {
    if (!products || !wb) return;
    setStep(5);
    try {
      const imgs = matchZipImages(products, zip?.contents ?? null);
      const urlByFile = new Map<string, string>();
      let done = 0;
      for (const { name, image } of imgs.uploads) {
        setBusy(`Uploading images ${done + 1} / ${imgs.uploads.length}…`);
        const mime = MIME_BY_EXT[image.ext] ?? "image/jpeg";
        try { urlByFile.set(name, await catalogApi.uploadImage(name, mime, u8ToBase64(image.data))); }
        catch (e) { toast.error(`Image ${name} skipped`, e instanceof Error ? e.message : "Upload failed."); }
        done++;
      }
      applyImageUrls(products, urlByFile);
      setBusy("Importing products…");
      const r = await request<ImportResult>("/products/import", { method: "POST", body: { format: "v2", products: toPayload(products), mode, createCategories, fileName: file?.name ?? zip?.name ?? null, fileSizeBytes: file?.size ?? null, imagesMatched: urlByFile.size } });
      setResult(r);
      await Promise.all([hydrateCatalog(), hydrateCategories(true), hydrateCategoryTree(true)]);
      toast.success("Import complete", `${r.created} created, ${r.updated} updated, ${r.variantsWritten} variant(s) written.`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Import failed.";
      toast.error("Nothing was imported", msg);
      setStep(3);
      if (e instanceof ApiError && e.code === "IMPORT_INVALID") void validate();
    } finally { setBusy(null); }
  };

  const grouped = useMemo(() => (wb ? (() => { try { return groupProducts(wb, pMap, wb.variants ? vMap : undefined); } catch { return []; } })() : []), [wb, pMap, vMap]);
  const canMap = Boolean(wb) && Object.values(pMap).some((t) => "field" in t && t.field === "name") && (wb?.format === "two-sheet" ? Object.values(vMap).some((t) => "field" in t && t.field === "productId") : true);

  return (
    <>
      <Button variant="secondary" icon={FileUp} onClick={() => setOpen(true)}>Bulk Import</Button>
      <Dialog open={open} onClose={close} width="max-w-5xl" title="Import products" description="Simple and variable products from Excel — validated before anything is written.">
        <div className="space-y-4">
          {/* stepper */}
          <ol className="flex flex-wrap gap-1 text-xs" aria-label="Import steps">
            {STEPS.map((s, i) => { const n = (i + 1) as Step; return (
              <li key={s} className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold", n === step ? "bg-primary-500 text-white" : n < step ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "erp-surface-2 erp-text-faint")}>
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/30 text-[10px]">{n < step ? "✓" : n}</span>{s}
              </li>
            ); })}
          </ol>

          {/* ---- 1 Upload ---- */}
          {step === 1 && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); void onDrop(e.dataTransfer.files); }}
                className={cn("rounded-xl border-2 border-dashed p-6 text-center", dragOver ? "border-primary-500 bg-primary-50/50" : "erp-border")}
              >
                <FileSpreadsheet className="mx-auto h-8 w-8 erp-text-faint" aria-hidden />
                <p className="mt-2 text-sm font-semibold erp-text">{wb ? `${file?.name ?? zip?.name} — ${wb.format === "two-sheet" ? `Products (${wb.products.rows.length}) + Variants (${wb.variants?.rows.length ?? 0})` : `${wb.products.rows.length} rows`}` : "Drop the Excel file here"}</p>
                <p className="mt-1 text-xs erp-text-muted">.xlsx / .csv — single sheet (one row = one variant) or Products + Variants sheets. Optionally a .zip with images (or a .zip holding both).</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button size="sm" icon={Upload} onClick={() => fileRef.current?.click()} loading={busy === "Reading file…"}>{wb ? "Replace Excel" : "Choose Excel"}</Button>
                  <Button size="sm" icon={Images} onClick={() => zipRef.current?.click()}>{zip ? `Images: ${zip.contents.images.size} (${zip.name})` : "Add images ZIP (optional)"}</Button>
                </div>
                <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void onDrop(e.target.files)} aria-label="Excel file" />
                <input ref={zipRef} type="file" accept=".zip" className="sr-only" onChange={(e) => void onDrop(e.target.files)} aria-label="Images ZIP" />
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg erp-surface-2 p-3 text-xs erp-text-muted">
                <Download className="h-4 w-4 shrink-0" aria-hidden />
                <span className="font-semibold erp-text">Download Product Import Template:</span>
                <Button size="sm" variant="ghost" onClick={() => download("zolo-simple-product-template.xlsx", buildTemplate("simple"))}>Simple Product Template</Button>
                <Button size="sm" variant="ghost" onClick={() => download("zolo-variable-product-template.xlsx", buildTemplate("variable"))}>Variable Product Template</Button>
                <span className="basis-full">Both include a “How to Import Products” sheet: one row = one variant, same Product ID = same product, unique SKUs, existing categories, numeric price / stock / MOQ, image file names matched from a ZIP.</span>
              </div>
              <div className="flex justify-end"><Button variant="primary" disabled={!wb} onClick={() => setStep(2)}>Next: map columns</Button></div>
            </div>
          )}

          {/* ---- 2 Map ---- */}
          {step === 2 && wb && (
            <div className="space-y-3">
              <p className="text-xs erp-text-muted">Columns were detected automatically. Change any mapping below — pick “Option: …” for a column that varies between variants (Size, Color, Capacity, Ply…).</p>
              {wb.format === "two-sheet" ? (
                <>
                  <MappingTable title={`Sheet “${wb.products.name}” → product fields`} headers={wb.products.headers} sample={wb.products.rows.slice(0, 3)} mapping={pMap} onChange={setPMap} scope="product" />
                  <MappingTable title={`Sheet “${wb.variants!.name}” → variant fields`} headers={wb.variants!.headers} sample={wb.variants!.rows.slice(0, 3)} mapping={vMap} onChange={setVMap} scope="variant" />
                </>
              ) : (
                <MappingTable title={`Sheet “${wb.products.name}” — one row per variant`} headers={wb.products.headers} sample={wb.products.rows.slice(0, 3)} mapping={pMap} onChange={setPMap} scope="single" />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs erp-text-muted">{grouped.length} product(s) · {grouped.reduce((n, p) => n + p.variants.length, 0)} variant(s) detected{!canMap && " — map Product Name (and Product ID on the Variants sheet) to continue"}</span>
                <div className="flex gap-2"><Button onClick={() => setStep(1)}>Back</Button><Button variant="primary" disabled={!canMap} loading={busy === "Validating…"} onClick={validate}>Next: validate</Button></div>
              </div>
            </div>
          )}

          {/* ---- 3 Validate ---- */}
          {step === 3 && report && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  [`${report.summary.products} products detected`, `${report.summary.simple} simple · ${report.summary.variable} variable`],
                  [`${report.summary.variants} variants detected`, `${report.summary.toCreate} new · ${report.summary.toUpdate} to update${report.summary.toSkip ? ` · ${report.summary.toSkip} skipped` : ""}`],
                  [`${report.summary.categoriesMatched} categories matched`, report.summary.newCategories.length ? `${report.summary.newCategories.length} will be created` : "all existing"],
                  [`${report.summary.subcategoriesMatched} subcategories matched`, imageInfo ? `${imageInfo.matched} image file(s) matched` : ""],
                ].map(([t, sub]) => (
                  <div key={t} className="rounded-lg border erp-border p-3"><div className="flex items-center gap-1.5 text-sm font-semibold erp-text"><CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />{t}</div><div className="mt-0.5 text-[11px] erp-text-muted">{sub}</div></div>
                ))}
              </div>
              {report.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-red-700 dark:text-red-300"><XCircle className="h-4 w-4" aria-hidden />{report.errors.length} error{report.errors.length === 1 ? "" : "s"} — fix these in the file (or the mapping) and validate again</div>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-red-800 dark:text-red-200">{report.errors.map((e, i) => <li key={i}><span className="font-mono font-semibold">{e.product}</span>: {e.message}</li>)}</ul>
                </div>
              )}
              {(report.warnings.length > 0 || (imageInfo?.unmatched.length ?? 0) > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4" aria-hidden />{report.warnings.length + (imageInfo?.unmatched.length ?? 0)} warning(s) — the import can proceed</div>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-900 dark:text-amber-100">
                    {imageInfo?.unmatched.map((n) => <li key={`img-${n}`}>Image <span className="font-mono">{n}</span> is not in the ZIP</li>)}
                    {report.warnings.map((w, i) => <li key={i}><span className="font-mono font-semibold">{w.product}</span>: {w.message}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4 rounded-lg erp-surface-2 p-3 text-xs">
                <label className="flex items-center gap-2 erp-text"><span className="font-semibold">Existing products:</span>
                  <select value={mode} onChange={(e) => setMode(e.target.value as "update" | "skip")} className={cn(SELECT, "w-auto")}><option value="update">Update them</option><option value="skip">Skip them</option></select>
                </label>
                <label className="flex items-center gap-2 erp-text"><input type="checkbox" checked={createCategories} onChange={(e) => setCreateCategories(e.target.checked)} className="h-4 w-4 accent-primary-500" /> Create missing categories / subcategories</label>
                <Button size="sm" variant="ghost" loading={busy === "Validating…"} onClick={validate}>Validate again</Button>
              </div>
              <div className="flex justify-between"><Button onClick={() => setStep(2)}>Back</Button><Button variant="primary" disabled={!report.ok} onClick={() => setStep(4)}>Next: preview</Button></div>
            </div>
          )}

          {/* ---- 4 Preview ---- */}
          {step === 4 && report && (
            <div className="space-y-3">
              <p className="text-xs erp-text-muted">What will be written — {report.summary.products} product(s), {report.summary.variants} variant(s). Nothing has been saved yet.</p>
              <ul className="max-h-[50vh] divide-y erp-border overflow-y-auto rounded-lg border erp-border">
                {report.preview.map((p) => { const isOpen = expanded.has(p.ref); return (
                  <li key={p.ref} className="px-3 py-2">
                    <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(p.ref)) n.delete(p.ref); else n.add(p.ref); return n; })} className="flex w-full items-center gap-2 text-left" aria-expanded={isOpen}>
                      {p.kind === "variable" ? (isOpen ? <ChevronDown className="h-4 w-4 erp-text-faint" /> : <ChevronRight className="h-4 w-4 erp-text-faint" />) : <span className="w-4" />}
                      <span className="font-semibold erp-text">{p.name}</span>
                      <Badge tone={p.kind === "variable" ? "primary" : "neutral"}>{p.kind === "variable" ? `${p.variants.length} variants` : `simple · ${p.sku}`}</Badge>
                      <Badge tone={p.action === "create" ? "success" : p.action === "update" ? "info" : "neutral"}>{p.action}</Badge>
                      <span className="ml-auto truncate text-xs erp-text-muted">{p.category}{p.subcategory ? ` › ${p.subcategory}` : ""}{p.images ? ` · ${p.images} image(s)` : ""}</span>
                    </button>
                    {p.kind === "variable" && isOpen && (
                      <ul className="mt-1 space-y-0.5 pl-6 text-xs">
                        {p.variants.map((v, i) => <li key={v.sku} className="flex items-center gap-2 erp-text-muted"><span className="erp-text-faint">{i === p.variants.length - 1 ? "└──" : "├──"}</span><span className="font-semibold erp-text">{v.label || "Default"}</span><span className="font-mono">{v.sku}</span><span>{inr(v.priceMinor)}</span><span>stock {v.stock}</span><span>MOQ {v.moq}</span>{v.image && <span className="text-emerald-600">image</span>}</li>)}
                      </ul>
                    )}
                  </li>
                ); })}
              </ul>
              <div className="flex justify-between"><Button onClick={() => setStep(3)}>Back</Button><Button variant="primary" icon={FileUp} onClick={runImport}>Import Products</Button></div>
            </div>
          )}

          {/* ---- 5 Import ---- */}
          {step === 5 && (
            <div className="space-y-4 py-2">
              {busy && <div className="flex items-center gap-2 text-sm erp-text"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{busy}</div>}
              {result && (
                <>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" aria-hidden />Import complete</div>
                    <p className="mt-1">{result.created} product(s) created · {result.updated} updated · {result.skipped} skipped · {result.variantsWritten} variant(s) written{zip ? ` · ${formatBytes(zip.contents.totalUncompressedBytes)} of images processed` : ""}.</p>
                  </div>
                  <ul className="max-h-48 divide-y erp-border overflow-y-auto rounded-lg border erp-border text-xs">
                    {result.products.map((p) => <li key={p.id} className="flex items-center gap-2 px-3 py-1.5"><Badge tone={p.action === "create" ? "success" : "info"}>{p.action}</Badge><Link to={`/admin/catalog/${p.id}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">{p.name}</Link><span className="font-mono erp-text-muted">{p.sku}</span><span className="erp-text-faint">{p.kind}</span></li>)}
                  </ul>
                  <div className="flex justify-end gap-2">{result.importId && <Link to="/admin/catalog/imports"><Button>Import history</Button></Link>}<Button variant="primary" onClick={close}>Done</Button></div>
                </>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
