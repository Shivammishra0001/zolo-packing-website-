import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Ban,
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  Pencil,
  X,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  KeyValue,
  Select,
} from "../../components/ui";
import { formatDate, inr } from "../../format";
import {
  archiveProduct,
  markOutOfStock,
  unarchiveProduct,
  updateStock,
} from "../../catalog-store";
import { PRODUCT_STATUS, STOCK_STATUS } from "../../statuses-ext";
import type {
  CatalogProduct,
  StockChangeReason,
} from "../../types";

// ---------- Shared field styles (match existing catalog dialogs) ----------
const FIELD =
  "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";
const LABEL = "mb-1.5 block text-xs font-semibold erp-text-muted";

function images(p: CatalogProduct): string[] {
  return p.images && p.images.length > 0 ? p.images : [p.imageEmoji];
}

function dimsLabel(p: CatalogProduct): string {
  const d = p.dimensions;
  return d ? `${d.length} × ${d.width} × ${d.height} ${d.unit}` : "—";
}

/** True for real image sources (uploaded/imported), false for emoji strings. */
export function isImgUrl(s: string | undefined): s is string {
  return !!s && /^(blob:|data:|https?:|\/)/.test(s);
}

/** Renders a real <img> for URL sources and the emoji/text otherwise. */
/**
 * Product thumbnail with a clean fallback chain:
 *   real image URL → emoji/text placeholder → neutral placeholder on load error.
 * A dead URL must never surface the browser's broken-image icon.
 */
export function MediaThumb({ src, imgClass, textClass }: { src: string; imgClass: string; textClass?: string }) {
  const [failed, setFailed] = useState(false);
  // A changed src deserves a fresh attempt rather than inheriting the old failure.
  useEffect(() => { setFailed(false); }, [src]);

  if (isImgUrl(src) && !failed) {
    return <img src={src} alt="" className={imgClass} loading="lazy" onError={() => setFailed(true)} />;
  }
  if (isImgUrl(src) && failed) {
    return <span className={textClass ?? "text-lg"} aria-hidden title="Image unavailable">📦</span>;
  }
  return <span className={textClass} aria-hidden>{src}</span>;
}

/** Price display: Zolo is quotation-based — a product without a fixed price
 *  must never render ₹0; it reads "On quote" instead. */
export function priceLabel(basePrice: number | undefined): string {
  return basePrice && basePrice > 0 ? inr(basePrice) : "On quote";
}

// ============================================================
// 1. Image lightbox — large view with prev / next / count / close
// ============================================================

export function ImageLightbox({
  product,
  startIndex = 0,
  onClose,
}: {
  product: CatalogProduct;
  startIndex?: number;
  onClose: () => void;
}) {
  const imgs = images(product);
  const [index, setIndex] = useState(startIndex);
  const prev = () => setIndex((i) => (i - 1 + imgs.length) % imgs.length);
  const next = () => setIndex((i) => (i + 1) % imgs.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${product.name} images`}
    >
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex w-full max-w-2xl flex-col items-center gap-4">
        <div className="flex w-full items-center justify-between text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{product.name}</p>
            <p className="font-mono text-xs text-white/60">{product.sku}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-white/10"
            aria-label="Close image viewer"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <MediaThumb
            src={imgs[index]}
            imgClass="h-full w-full object-contain"
            textClass="text-[9rem] leading-none sm:text-[12rem]"
          />
          {imgs.length > 1 && (
            <>
              <button
                onClick={prev}
                className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden />
              </button>
              <button
                onClick={next}
                className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" aria-hidden />
              </button>
            </>
          )}
          <span className="absolute bottom-3 rounded-full bg-dark-950/70 px-3 py-1 text-xs font-semibold text-white">
            {index + 1} / {imgs.length}
          </span>
        </div>

        {imgs.length > 1 && (
          <div className="flex flex-wrap justify-center gap-2">
            {imgs.map((img, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`View image ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  "flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border text-2xl transition-colors",
                  i === index ? "border-primary-500 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                )}
              >
                <MediaThumb src={img} imgClass="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// 2. Update Stock dialog
// ============================================================

const REASONS: { value: StockChangeReason; label: string }[] = [
  { value: "new_stock", label: "New Stock Received" },
  { value: "manual_adjustment", label: "Manual Adjustment" },
  { value: "damaged", label: "Damaged Stock" },
  { value: "returned", label: "Returned Stock" },
  { value: "correction", label: "Stock Correction" },
  { value: "other", label: "Other" },
];

export function UpdateStockDialog({
  product,
  open,
  onClose,
}: {
  product: CatalogProduct;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const current = product.stock ?? 0;
  const [next, setNext] = useState(String(current));
  const [reason, setReason] = useState<StockChangeReason>("new_stock");

  useEffect(() => {
    if (open) {
      setNext(String(product.stock ?? 0));
      setReason("new_stock");
    }
  }, [open, product.stock]);

  const parsed = Number(next);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const delta = valid ? parsed - current : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Update stock"
      description={product.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              updateStock(product.id, parsed);
              toast.success(
                "Stock updated",
                `${product.name}: ${current.toLocaleString("en-IN")} → ${parsed.toLocaleString("en-IN")} (${REASONS.find((r) => r.value === reason)?.label}).`,
              );
              onClose();
            }}
          >
            Confirm update
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL}>Current stock</span>
            <input value={current.toLocaleString("en-IN")} disabled className={cn(FIELD, "erp-surface-2 opacity-70")} />
          </label>
          <label className="block">
            <span className={LABEL}>New stock</span>
            <input
              type="number"
              min={0}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </label>
        </div>
        {valid && delta !== 0 && (
          <p className={cn("text-xs font-semibold", delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString("en-IN")} units
          </p>
        )}
        <label className="block">
          <span className={LABEL}>Reason</span>
          <Select value={reason} onChange={(v) => setReason(v as StockChangeReason)} className="w-full" aria-label="Reason for stock change">
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </Dialog>
  );
}

// ============================================================
// 3. Mark Out of Stock confirmation
// ============================================================

export function MarkOutOfStockDialog({
  product,
  open,
  onClose,
}: {
  product: CatalogProduct;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark out of stock"
      description={`Mark ${product.name} as Out of Stock? The product stays Active — it is not archived.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Ban}
            onClick={() => {
              markOutOfStock(product.id);
              toast.success("Marked out of stock", `${product.name} is now unavailable to buyers.`);
              onClose();
            }}
          >
            Mark Out of Stock
          </Button>
        </>
      }
    />
  );
}

// ============================================================
// 4. Archive / Unarchive confirmation
// ============================================================

export function ArchiveDialog({
  product,
  open,
  onClose,
}: {
  product: CatalogProduct;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const archived = product.status === "archived";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={archived ? "Unarchive product" : "Archive product"}
      description={
        archived
          ? `Return ${product.name} to the catalog? Its stock is preserved.`
          : `Archive ${product.name}? Data and history are kept; it is hidden from the active and buyer views. It can be unarchived anytime.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={archived ? "primary" : "secondary"}
            icon={archived ? ArchiveRestore : Archive}
            onClick={() => {
              if (archived) {
                unarchiveProduct(product.id);
                toast.success("Unarchived", `${product.name} is back in the catalog.`);
              } else {
                archiveProduct(product.id);
                toast.success("Archived", `${product.name} is hidden from active listings.`);
              }
              onClose();
            }}
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
        </>
      }
    />
  );
}

// ============================================================
// 5. Product details drawer
// ============================================================

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-[11px] font-bold uppercase tracking-wide erp-text-faint">{title}</h3>
      {children}
    </div>
  );
}

export function ProductDetailsDrawer({
  product,
  open,
  onClose,
  onEdit,
  onUpdateStock,
  onMarkOOS,
  onArchive,
  onOpenImage,
}: {
  product: CatalogProduct | null;
  open: boolean;
  onClose: () => void;
  onEdit: (p: CatalogProduct) => void;
  onUpdateStock: (p: CatalogProduct) => void;
  onMarkOOS: (p: CatalogProduct) => void;
  onArchive: (p: CatalogProduct) => void;
  onOpenImage: (p: CatalogProduct, index: number) => void;
}) {
  if (!product) return null;
  const imgs = images(product);
  const ps = PRODUCT_STATUS[product.status];
  const ss = product.stockStatus ? STOCK_STATUS[product.stockStatus] : null;
  const archived = product.status === "archived";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Product details"
      width="max-w-xl"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={Pencil} onClick={() => onEdit(product)}>
            Edit
          </Button>
          {!archived && (
            <>
              <Button variant="secondary" icon={PackageCheck} onClick={() => onUpdateStock(product)}>
                Update Stock
              </Button>
              <Button variant="secondary" icon={Ban} onClick={() => onMarkOOS(product)}>
                Mark Out of Stock
              </Button>
            </>
          )}
          <Button
            variant={archived ? "primary" : "ghost"}
            icon={archived ? ArchiveRestore : Archive}
            className="ml-auto"
            onClick={() => onArchive(product)}
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Images */}
        <div className="flex flex-wrap gap-2">
          {imgs.map((img, i) => (
            <button
              key={i}
              onClick={() => onOpenImage(product, i)}
              aria-label={`View image ${i + 1} of ${product.name}`}
              className={cn(
                "flex items-center justify-center overflow-hidden rounded-xl border erp-border erp-surface-2 transition-colors hover:border-primary-500",
                i === 0 ? "h-20 w-20 text-4xl" : "h-14 w-14 text-2xl",
              )}
            >
              <MediaThumb src={img} imgClass="h-full w-full object-cover" />
            </button>
          ))}
        </div>

        {/* Product */}
        <Section title="Product">
          <div className="space-y-1">
            <p className="text-base font-bold erp-text">{product.name}</p>
            {product.description && <p className="text-sm erp-text-muted">{product.description}</p>}
          </div>
          <KeyValue
            items={[
              { label: "Product ID", value: <span className="font-mono">{product.id}</span> },
              { label: "SKU", value: <span className="font-mono">{product.sku}</span> },
              { label: "Category", value: product.category },
              { label: "Subcategory", value: product.subcategory },
            ]}
          />
        </Section>

        {/* Specifications */}
        <Section title="Specifications">
          <KeyValue
            items={[
              { label: "Length", value: product.dimensions ? `${product.dimensions.length} ${product.dimensions.unit}` : "—" },
              { label: "Width", value: product.dimensions ? `${product.dimensions.width} ${product.dimensions.unit}` : "—" },
              { label: "Height", value: product.dimensions ? `${product.dimensions.height} ${product.dimensions.unit}` : "—" },
              { label: "GSM", value: product.gsm ?? "—" },
              { label: "Material", value: product.material ?? "—" },
              { label: "Type", value: product.productType ?? "—" },
              { label: "Color", value: product.color ?? "—" },
            ]}
          />
        </Section>

        {/* Commercial */}
        <Section title="Commercial">
          <KeyValue
            items={[
              { label: "Base Price", value: priceLabel(product.basePrice) },
              { label: "MOQ", value: `${product.moq.toLocaleString("en-IN")} units` },
              { label: "Stock on hand", value: `${(product.stock ?? 0).toLocaleString("en-IN")} units` },
            ]}
          />
        </Section>

        {/* Status */}
        <Section title="Status">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ps.tone}>Product: {ps.label}</Badge>
            {ss && <Badge tone={ss.tone}>Stock: {ss.label}</Badge>}
            <span className="ml-auto text-xs erp-text-faint">Updated {formatDate(product.updatedAt)}</span>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

// The Add / Edit product drawer lives in ./ProductForm.tsx (real image upload,
// field-level validation, awaited API save).
export { ProductFormDrawer } from "./ProductForm";

export { images as productImages, dimsLabel };
