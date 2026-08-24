import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Ban,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImagePlus,
  PackageCheck,
  Pencil,
  Star,
  Trash2,
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
  updateProduct,
  updateStock,
} from "../../catalog-store";
import { PRODUCT_STATUS, STOCK_STATUS } from "../../statuses-ext";
// Canonical categories from PostgreSQL — the empty mock array is why this
// dropdown rendered blank for products that clearly had a category.
import { useCategories, hydrateCategories } from "../../categories-store";
import type {
  CatalogProduct,
  ProductStatus,
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

// ============================================================
// 6. Add / Edit product drawer (sectioned form + image dropzone)
// ============================================================

interface DraftImage {
  emoji: string;
}

export function ProductFormDrawer({
  product,
  open,
  onClose,
}: {
  /** null = create mode; a product = edit mode */
  product: CatalogProduct | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!product;

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const categories = useCategories();
  useEffect(() => { void hydrateCategories(); }, []);
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [description, setDescription] = useState("");
  const [len, setLen] = useState("");
  const [wid, setWid] = useState("");
  const [hei, setHei] = useState("");
  const [unit, setUnit] = useState<"in" | "cm" | "mm">("in");
  const [gsm, setGsm] = useState("");
  const [color, setColor] = useState("");
  const [price, setPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [lowLevel, setLowLevel] = useState("");
  const [status, setStatus] = useState<Extract<ProductStatus, "draft" | "active">>("draft");
  const [imgs, setImgs] = useState<DraftImage[]>([]);
  const [primary, setPrimary] = useState(0);

  const PALETTE = ["📦", "🎁", "📮", "🛍️", "🍫", "📕", "🟫", "🟥", "🟦", "🟨", "🟪", "✨", "🏷️", "📐"];

  useEffect(() => {
    if (!open) return;
    if (product) {
      setName(product.name);
      setSku(product.sku);
      setCategory(product.category);
      setSubcategory(product.subcategory ?? "");
      setDescription(product.description ?? "");
      setLen(String(product.dimensions?.length ?? ""));
      setWid(String(product.dimensions?.width ?? ""));
      setHei(String(product.dimensions?.height ?? ""));
      setUnit(product.dimensions?.unit ?? "in");
      setGsm(String(product.gsm ?? ""));
      setColor(product.color ?? "");
      setPrice(String(product.basePrice));
      setMoq(String(product.moq));
      setOpeningStock(String(product.stock ?? 0));
      setLowLevel(String(product.lowStockLevel ?? ""));
      setStatus(product.status === "active" ? "active" : "draft");
      setImgs((product.images ?? [product.imageEmoji]).map((emoji) => ({ emoji })));
      setPrimary(0);
    } else {
      setName(""); setSku(""); setCategory(""); setSubcategory(""); setDescription("");
      setLen(""); setWid(""); setHei(""); setUnit("in"); setGsm(""); setColor("");
      setPrice(""); setMoq(""); setOpeningStock(""); setLowLevel(""); setStatus("draft");
      setImgs([]); setPrimary(0);
    }
  }, [open, product]);

  const valid = name.trim() !== "" && sku.trim() !== "" && Number(price) > 0;

  const addImage = (emoji: string) => setImgs((arr) => [...arr, { emoji }]);
  const removeImage = (i: number) =>
    setImgs((arr) => {
      const next = arr.filter((_, idx) => idx !== i);
      if (primary >= next.length) setPrimary(Math.max(0, next.length - 1));
      return next;
    });
  const moveImage = (i: number, dir: -1 | 1) =>
    setImgs((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = () => {
    // Reorder so the chosen primary image is first.
    const ordered = imgs.length
      ? [imgs[primary].emoji, ...imgs.filter((_, i) => i !== primary).map((x) => x.emoji)]
      : ["📦"];
    const patch = {
      name: name.trim(),
      sku: sku.trim(),
      category,
      // Persist the subcategory too — omitting it meant a taxonomy change made
      // in this form silently reverted on refresh.
      subcategory: subcategory || "General",
      description: description.trim() || undefined,
      dimensions: len && wid && hei ? { length: Number(len), width: Number(wid), height: Number(hei), unit } : undefined,
      gsm: gsm ? Number(gsm) : undefined,
      color: color.trim() || undefined,
      basePrice: Number(price) || 0,
      moq: Number(moq) || 1,
      stock: Number(openingStock) || 0,
      lowStockLevel: Number(lowLevel) || undefined,
      status,
      imageEmoji: ordered[0],
      images: ordered,
    };

    if (editing && product) {
      updateProduct(product.id, patch);
      toast.success("Product updated", `Saved changes to ${patch.name}.`);
    } else {
      const id = `PRD-${Math.floor(1100 + Math.random() * 800)}`;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      import("../../catalog-store").then((m) =>
        m.addProduct({
          id,
          // subcategory comes from `patch` (spread below) — one source.
          variants: [{ id: "V1", label: "Default", sku: patch.sku, moq: patch.moq, basePrice: patch.basePrice, inStock: patch.stock }],
          updatedAt: new Date().toISOString(),
          ...patch,
        } as CatalogProduct),
      );
      toast.success("Product created", `${patch.name} added as ${status === "active" ? "Active" : "Draft"}.`);
    }
    onClose();
  };

  const twoCol = "grid grid-cols-2 gap-3";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? "Edit product" : "Add product"}
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            {editing ? "Save changes" : "Create product"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Basic */}
        <Section title="Basic information">
          <label className="block">
            <span className={LABEL}>Product name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corrugated Mailer Box" className={FIELD} />
          </label>
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>SKU *</span>
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="MB-KRF-002" className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Category</span>
              <Select
                value={category}
                onChange={(v) => { setCategory(v); setSubcategory(""); }}
                className="w-full"
                aria-label="Category"
              >
                <option value="">— Select a category —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {/* An imported product may sit in a category that is no longer
                    active; keep its own value selectable so opening the form
                    never silently reassigns it. */}
                {category && !categories.some((c) => c.name === category) && (
                  <option value={category}>{category}</option>
                )}
              </Select>
            </label>
          </div>
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>Subcategory</span>
              <Select value={subcategory} onChange={setSubcategory} className="w-full" aria-label="Subcategory">
                <option value="">— None —</option>
                {(categories.find((c) => c.name === category)?.subcategories ?? []).map((sc) => (
                  <option key={sc.id} value={sc.name}>{sc.name}</option>
                ))}
                {subcategory &&
                  !(categories.find((c) => c.name === category)?.subcategories ?? []).some((sc) => sc.name === subcategory) && (
                    <option value={subcategory}>{subcategory}</option>
                  )}
              </Select>
            </label>
            <div />
          </div>
          <label className="block">
            <span className={LABEL}>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short product description…"
              className={cn(FIELD, "h-auto py-2")}
            />
          </label>
        </Section>

        {/* Images */}
        <Section title="Images">
          <div className="flex flex-wrap gap-2">
            {imgs.map((img, i) => (
              <div key={i} className="group relative">
                <div
                  className={cn(
                    "flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border text-3xl",
                    i === primary ? "border-primary-500 ring-2 ring-primary-100 dark:ring-primary-500/20" : "erp-border erp-surface-2",
                  )}
                >
                  <MediaThumb src={img.emoji} imgClass="h-full w-full object-cover" />
                </div>
                <div className="absolute inset-x-0 -bottom-6 flex justify-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => setPrimary(i)} aria-label="Set primary" title="Set primary" className="rounded p-0.5 erp-text-muted hover:text-primary-600">
                    <Star className={cn("h-3.5 w-3.5", i === primary && "fill-primary-500 text-primary-500")} />
                  </button>
                  <button onClick={() => moveImage(i, -1)} aria-label="Move left" className="rounded p-0.5 erp-text-muted hover:erp-text">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => moveImage(i, 1)} aria-label="Move right" className="rounded p-0.5 erp-text-muted hover:erp-text">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => removeImage(i)} aria-label="Remove image" className="rounded p-0.5 text-red-500 hover:text-red-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* Dropzone (visual) + emoji picker to add mock images */}
          <div className="mt-7 rounded-xl border-2 border-dashed erp-border erp-surface-2 p-3">
            <div className="flex items-center gap-2 text-xs erp-text-faint">
              <ImagePlus className="h-4 w-4" aria-hidden />
              Drag &amp; drop images, or pick a placeholder:
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PALETTE.map((e) => (
                <button
                  key={e}
                  onClick={() => addImage(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-md erp-surface text-lg hover:ring-2 hover:ring-primary-300"
                  aria-label={`Add ${e} image`}
                >
                  {e}
                </button>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] erp-text-faint">
              <GripVertical className="h-3 w-3" aria-hidden /> First image (★) is the primary shown to buyers.
            </p>
          </div>
        </Section>

        {/* Dimensions */}
        <Section title="Dimensions">
          <div className="grid grid-cols-4 gap-3">
            <label className="block">
              <span className={LABEL}>Length</span>
              <input type="number" value={len} onChange={(e) => setLen(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Width</span>
              <input type="number" value={wid} onChange={(e) => setWid(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Height</span>
              <input type="number" value={hei} onChange={(e) => setHei(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Unit</span>
              <Select value={unit} onChange={(v) => setUnit(v as "in" | "cm" | "mm")} className="w-full" aria-label="Unit">
                <option value="in">in</option>
                <option value="cm">cm</option>
                <option value="mm">mm</option>
              </Select>
            </label>
          </div>
        </Section>

        {/* Specifications */}
        <Section title="Specifications">
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>GSM</span>
              <input type="number" value={gsm} onChange={(e) => setGsm(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Color</span>
              <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="e.g. Natural Kraft" className={FIELD} />
            </label>
          </div>
        </Section>

        {/* Commercial */}
        <Section title="Commercial">
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>Price (₹) *</span>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>MOQ</span>
              <input type="number" value={moq} onChange={(e) => setMoq(e.target.value)} className={FIELD} />
            </label>
          </div>
        </Section>

        {/* Inventory */}
        <Section title="Inventory">
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>Opening stock</span>
              <input type="number" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>Low stock level</span>
              <input type="number" value={lowLevel} onChange={(e) => setLowLevel(e.target.value)} className={FIELD} />
            </label>
          </div>
        </Section>

        {/* Status */}
        <Section title="Status">
          <div className="flex gap-2">
            {(["draft", "active"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold capitalize transition-colors",
                  status === s
                    ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                    : "erp-border erp-text-muted hover:erp-surface-2",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

export { images as productImages, dimsLabel };
