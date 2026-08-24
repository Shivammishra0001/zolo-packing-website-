import { useRef, useState } from "react";
import { ImageOff, Upload, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { Button, Dialog } from "../../components/ui";
import { catalogApi } from "@/lib/catalog-api";
import { hydrateCatalog } from "../../catalog-store";
import { parseZip, formatBytes, LIMITS, MIME_BY_EXT } from "./bulk-import-lib";
import type { CatalogProduct } from "../../types";

// ============================================================
// Product image upload — single product, and bulk-by-SKU from a ZIP.
// Both post through the existing storage pipeline (server writes to ./uploads
// and returns a URL); nothing is stored as base64 in the database.
// ============================================================

const ACCEPT_IMAGE = "image/jpeg,image/png,image/webp";
const MAX_BYTES = LIMITS.IMAGE_MAX_BYTES;

/** File → base64 payload the upload endpoints expect. */
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const u8ToBase64 = (u8: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
};

// ---------- Single product ----------

export function UploadImageDialog({
  product,
  open,
  onClose,
}: {
  product: CatalogProduct | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setBusy(false);
  };

  const close = () => { reset(); onClose(); };

  const pick = (f: File) => {
    if (!ACCEPT_IMAGE.split(",").includes(f.type)) {
      toast.error("Unsupported format", "Use a JPG, PNG or WebP image.");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Image too large", `Maximum size is ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!file || !product) return;
    setBusy(true);
    try {
      await catalogApi.setProductImage(product.id, file.name, file.type, await fileToBase64(file));
      // Re-read from the database so the catalog, product detail and storefront
      // all show the saved image without a page refresh.
      await hydrateCatalog();
      toast.success("Image uploaded successfully.", `${product.name} now shows the new image.`);
      close();
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "Could not upload the image.");
      setBusy(false);
    }
  };

  const currentImage = product?.images?.find((u) => /^https?:\/\//i.test(u));

  return (
    <Dialog
      open={open}
      onClose={close}
      title={product ? `Upload image — ${product.name}` : "Upload image"}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!file} loading={busy} onClick={save}>Save Image</Button>
        </>
      }
    >
      <div className="space-y-3">
        {currentImage && !preview && (
          <div className="flex items-center gap-3 rounded-lg border erp-border erp-surface-2 p-2.5">
            <img src={currentImage} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <p className="text-xs erp-text-muted">Current image — uploading replaces it as the primary picture.</p>
          </div>
        )}

        {preview ? (
          <div className="flex items-center gap-3 rounded-lg border erp-border erp-surface-2 p-2.5">
            <img src={preview} alt="Selected preview" className="h-20 w-20 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold erp-text">{file?.name}</p>
              <p className="text-xs erp-text-faint">{file ? formatBytes(file.size) : ""}</p>
            </div>
            <button onClick={reset} aria-label="Remove selected image" className="flex h-8 w-8 items-center justify-center rounded-lg erp-text-muted hover:erp-surface">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed erp-border erp-surface-2 px-6 py-8 text-center"
          >
            <Upload className="h-6 w-6 erp-text-muted" aria-hidden />
            <p className="text-sm font-semibold erp-text">Drop an image or click to browse</p>
            <p className="text-[11px] erp-text-faint">JPG, PNG or WebP · max {formatBytes(MAX_BYTES)}</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_IMAGE}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }}
        />
      </div>
    </Dialog>
  );
}

// ---------- Bulk (ZIP → match by SKU) ----------

interface BulkResult {
  processed: number;
  matched: number;
  unmatched: number;
  invalid: number;
  errors: { sku: string; level?: string; error: string }[];
}

export function BulkImageUploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [zipName, setZipName] = useState<string | null>(null);
  const [pending, setPending] = useState<{ sku: string; name: string; mime: string; dataBase64: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const reset = () => { setZipName(null); setPending(null); setResult(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const handleZip = async (f: File) => {
    if (!f.name.toLowerCase().endsWith(".zip")) {
      toast.error("Unsupported file", "Upload a .zip containing your product images.");
      return;
    }
    if (f.size > LIMITS.ZIP_MAX_BYTES) {
      toast.error("ZIP too large", `Maximum ZIP size is ${formatBytes(LIMITS.ZIP_MAX_BYTES)}.`);
      return;
    }
    try {
      const zip = parseZip(new Uint8Array(await f.arrayBuffer()));
      if (zip.images.size === 0) {
        toast.error("No images in ZIP", "The archive contains no JPG/PNG/WebP files.");
        return;
      }
      // Filename (without extension) IS the SKU — the documented convention.
      const items = [...zip.images.values()].map((img) => ({
        sku: img.base.toUpperCase(),
        name: img.path.split("/").pop() ?? img.base,
        mime: MIME_BY_EXT[img.ext] ?? "image/jpeg",
        dataBase64: u8ToBase64(img.data),
      }));
      setZipName(f.name);
      setPending(items);
      setResult(null);
    } catch (e) {
      toast.error("Couldn't read ZIP", e instanceof Error ? e.message : "The archive may be corrupt.");
    }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await catalogApi.bulkImages(pending);
      await hydrateCatalog();
      setResult(res);
      toast.success(`${res.matched} image${res.matched === 1 ? "" : "s"} uploaded`, `${res.unmatched} unmatched · ${res.invalid} invalid`);
    } catch (e) {
      toast.error("Bulk upload failed", e instanceof Error ? e.message : "Could not upload the images.");
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!result) return;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [
      "SKU,Level,Reason",
      ...result.errors.map((e) => [e.sku, (e.level ?? "error").toUpperCase(), e.error].map(esc).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `image-upload-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Bulk upload product images"
      footer={
        result ? (
          <>
            {result.errors.length > 0 && <Button variant="ghost" onClick={downloadReport}>Download Report</Button>}
            <Button variant="primary" onClick={close}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!pending} loading={busy} onClick={run}>
              Upload {pending?.length ?? 0} Image{pending?.length === 1 ? "" : "s"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Found", value: result.processed },
              { label: "Matched", value: result.matched },
              { label: "No product", value: result.unmatched },
              { label: "Invalid", value: result.invalid },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border erp-border-soft erp-surface-2 p-2">
                <div className="text-lg font-extrabold erp-text">{c.value}</div>
                <div className="text-[11px] erp-text-muted">{c.label}</div>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border erp-border erp-surface-2 p-2 text-xs">
              {result.errors.slice(0, 30).map((e, i) => (
                <p key={i} className="erp-text-muted">
                  <span className="font-mono erp-text">{e.sku}</span> — {e.error}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleZip(f); }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center",
              pending ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "erp-border erp-surface-2",
            )}
          >
            {pending ? (
              <>
                <p className="text-sm font-semibold erp-text">{zipName}</p>
                <p className="text-xs erp-text-muted">{pending.length} image{pending.length === 1 ? "" : "s"} ready to match by SKU</p>
              </>
            ) : (
              <>
                <ImageOff className="h-6 w-6 erp-text-muted" aria-hidden />
                <p className="text-sm font-semibold erp-text">Drop a ZIP of product images</p>
                <p className="text-[11px] erp-text-faint">Name each file after its SKU — <code className="font-mono">ZOLO-BTL-001.jpg</code></p>
              </>
            )}
          </div>
          <input ref={inputRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleZip(f); e.target.value = ""; }} />
        </div>
      )}
    </Dialog>
  );
}
