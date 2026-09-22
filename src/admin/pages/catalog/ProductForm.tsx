// Add / Edit product drawer — the individual product upload form.
//
// Real chain: this form → POST/PUT /api/v1/products (admin bearer token) →
// PostgreSQL (product row + category FK + stored image files in ONE
// transaction) → the saved record is inserted into the catalog store → it is
// on the Product Catalog list, the product page and the storefront without a
// reload. Images are real files (JPG/PNG/WebP), previewed locally and uploaded
// as part of the save; a browser preview URL is never stored.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, GripVertical, ImagePlus, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { Button, Drawer, Select } from "../../components/ui";
import { createProduct, saveProduct } from "../../catalog-store";
import { useCategories, hydrateCategories } from "../../categories-store";
import { CatalogApiError, describeCatalogError, type ProductWriteInput } from "@/lib/catalog-api";
import type { CatalogProduct, ProductStatus } from "../../types";

const FIELD =
  "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";
const FIELD_ERR = "border-red-500 focus:border-red-500 focus:ring-red-100";
const LABEL = "mb-1.5 block text-xs font-semibold erp-text-muted";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 10;

/** A real, persistent image URL (stored file) — never a browser preview or emoji. */
const isStoredUrl = (s: string) => /^(https?:\/\/|\/)/.test(s) && !/^(blob:|data:)/.test(s);

interface DraftImage {
  key: string;
  /** Stored URL for an existing image. */
  url?: string;
  /** New file waiting to be uploaded with the save. */
  file?: File;
  preview: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wide erp-text-faint">{title}</h3>
      {children}
    </section>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <span role="alert" className="mt-1 block text-[11px] font-medium text-red-600 dark:text-red-400">{msg}</span> : null;
}

type Errors = Partial<Record<"name" | "sku" | "category" | "price" | "moq" | "stock" | "dims" | "gsm" | "images" | "featuredOrder" | "newArrivalOrder" | "form", string>>;

/** On/off switch in the admin style (role=switch, keyboard operable). */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", checked ? "bg-primary-500" : "bg-dark-300 dark:bg-dark-600")}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

/** Empty = "no explicit order"; otherwise a positive whole number. */
const orderError = (v: string) => (v.trim() === "" || (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 999999) ? undefined : "Display order must be a positive whole number.");

export function ProductFormDrawer({
  product,
  open,
  onClose,
  onSaved,
}: {
  /** null = create mode; a product = edit mode */
  product: CatalogProduct | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (p: CatalogProduct) => void;
}) {
  const toast = useToast();
  const editing = !!product;
  const categories = useCategories();
  useEffect(() => { void hydrateCategories(); }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [len, setLen] = useState("");
  const [wid, setWid] = useState("");
  const [hei, setHei] = useState("");
  const [unit, setUnit] = useState<"in" | "cm" | "mm">("cm");
  const [gsm, setGsm] = useState("");
  const [material, setMaterial] = useState("");
  const [productType, setProductType] = useState("");
  const [color, setColor] = useState("");
  const [price, setPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [stock, setStock] = useState("");
  const [lowLevel, setLowLevel] = useState("");
  const [status, setStatus] = useState<Extract<ProductStatus, "draft" | "active">>("draft");
  const [isFeatured, setIsFeatured] = useState(false);
  const [featuredOrder, setFeaturedOrder] = useState("");
  const [isNewArrival, setIsNewArrival] = useState(false);
  const [newArrivalOrder, setNewArrivalOrder] = useState("");
  const [imgs, setImgs] = useState<DraftImage[]>([]);
  const [primary, setPrimary] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Release object URLs when previews are dropped.
  const previewsRef = useRef<string[]>([]);
  useEffect(() => () => { previewsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const selectedCategory = useMemo(() => categories.find((c) => c.id === categoryId), [categories, categoryId]);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setBusy(false);
    if (product) {
      setName(product.name);
      setSku(product.sku);
      // Prefer the FK; fall back to matching the denormalised name for legacy rows.
      const cat = categories.find((c) => c.id === product.categoryId) ?? categories.find((c) => c.name === product.category);
      setCategoryId(cat?.id ?? "");
      const sub = cat?.subcategories.find((s) => s.id === product.subcategoryId) ?? cat?.subcategories.find((s) => s.name === product.subcategory);
      setSubcategoryId(sub?.id ?? "");
      setDescription(product.description ?? "");
      setLen(product.dimensions ? String(product.dimensions.length) : "");
      setWid(product.dimensions ? String(product.dimensions.width) : "");
      setHei(product.dimensions ? String(product.dimensions.height) : "");
      setUnit(product.dimensions?.unit ?? "cm");
      setGsm(product.gsm != null ? String(product.gsm) : "");
      setMaterial(product.material ?? "");
      setProductType(product.productType ?? "");
      setColor(product.color ?? "");
      setPrice(product.basePrice ? String(product.basePrice) : "");
      setMoq(String(product.moq));
      setStock(String(product.stock ?? 0));
      setLowLevel(product.lowStockLevel != null ? String(product.lowStockLevel) : "");
      setStatus(product.status === "active" ? "active" : "draft");
      setIsFeatured(product.isFeatured === true);
      setFeaturedOrder(product.featuredOrder != null ? String(product.featuredOrder) : "");
      setIsNewArrival(product.isNewArrival === true);
      setNewArrivalOrder(product.newArrivalOrder != null ? String(product.newArrivalOrder) : "");
      setImgs((product.images ?? []).filter(isStoredUrl).map((url, i) => ({ key: `u${i}-${url}`, url, preview: url })));
      setPrimary(0);
    } else {
      setName(""); setSku(""); setCategoryId(""); setSubcategoryId(""); setDescription("");
      setLen(""); setWid(""); setHei(""); setUnit("cm"); setGsm(""); setMaterial(""); setProductType(""); setColor("");
      setPrice(""); setMoq(""); setStock(""); setLowLevel(""); setStatus("draft");
      setIsFeatured(false); setFeaturedOrder(""); setIsNewArrival(false); setNewArrivalOrder("");
      setImgs([]); setPrimary(0);
    }
    // categories may arrive after the drawer opens; re-run then so the edit
    // form pre-selects the right option instead of showing a blank dropdown.
  }, [open, product, categories]);

  // ---- images ----
  const addFiles = (files: FileList | File[]) => {
    const next: DraftImage[] = [];
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      if (!ACCEPT.includes(f.type)) { problems.push(`${f.name}: unsupported format (use JPG, PNG or WebP)`); continue; }
      if (f.size > MAX_IMAGE_BYTES) { problems.push(`${f.name}: larger than 10 MB`); continue; }
      const preview = URL.createObjectURL(f);
      previewsRef.current.push(preview);
      next.push({ key: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, file: f, preview });
    }
    setImgs((arr) => {
      const merged = [...arr, ...next];
      if (merged.length > MAX_IMAGES) problems.push(`Only the first ${MAX_IMAGES} images are kept`);
      return merged.slice(0, MAX_IMAGES);
    });
    setErrors((e) => ({ ...e, images: problems.length ? problems.join(" · ") : undefined }));
  };
  const removeImage = (i: number) =>
    setImgs((arr) => {
      const next = arr.filter((_, idx) => idx !== i);
      setPrimary((p) => (p >= next.length ? Math.max(0, next.length - 1) : p > i ? p - 1 : p === i ? 0 : p));
      return next;
    });
  const replaceImage = (i: number, f: File) => {
    if (!ACCEPT.includes(f.type)) { setErrors((e) => ({ ...e, images: `${f.name}: unsupported format (use JPG, PNG or WebP)` })); return; }
    if (f.size > MAX_IMAGE_BYTES) { setErrors((e) => ({ ...e, images: `${f.name}: larger than 10 MB` })); return; }
    const preview = URL.createObjectURL(f);
    previewsRef.current.push(preview);
    setImgs((arr) => arr.map((img, idx) => (idx === i ? { key: `f-${Date.now()}`, file: f, preview } : img)));
    setErrors((e) => ({ ...e, images: undefined }));
  };
  const moveImage = (i: number, dir: -1 | 1) =>
    setImgs((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      setPrimary((p) => (p === i ? j : p === j ? i : p));
      return next;
    });

  // ---- validation (frontend; the server validates again) ----
  const validate = (): Errors => {
    const e: Errors = {};
    if (name.trim().length < 2) e.name = "Product name is required (at least 2 characters).";
    if (sku.trim().length < 2) e.sku = "SKU is required.";
    else if (!/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/.test(sku.trim())) e.sku = "SKU may only contain letters, numbers, dots, dashes and underscores.";
    if (!categoryId) e.category = "Choose a category.";
    const priceN = Number(price);
    if (price.trim() === "" || !Number.isFinite(priceN) || priceN < 0) e.price = "Enter a valid price (0 = quotation-based).";
    const moqN = Number(moq);
    if (moq.trim() === "" || !Number.isInteger(moqN) || moqN < 1) e.moq = "MOQ must be a whole number of at least 1.";
    const stockN = stock.trim() === "" ? 0 : Number(stock);
    if (!Number.isInteger(stockN) || stockN < 0) e.stock = "Stock must be a whole number of 0 or more.";
    const dims = [len, wid, hei].map((v) => v.trim());
    const filled = dims.filter(Boolean).length;
    if (filled > 0 && filled < 3) e.dims = "Enter length, width and height together (or leave all blank).";
    else if (filled === 3 && dims.some((v) => !(Number(v) > 0))) e.dims = "Dimensions must be numbers greater than 0.";
    if (gsm.trim() && (!Number.isInteger(Number(gsm)) || Number(gsm) < 0)) e.gsm = "GSM must be a whole number.";
    if (isFeatured && orderError(featuredOrder)) e.featuredOrder = orderError(featuredOrder);
    if (isNewArrival && orderError(newArrivalOrder)) e.newArrivalOrder = orderError(newArrivalOrder);
    return e;
  };

  // Clear a field's error as soon as the operator fixes it — a corrected field
  // must not keep shouting "required".
  useEffect(() => {
    if (!Object.keys(errors).length) return;
    const fresh = validate();
    setErrors((cur) => {
      const next = { ...cur };
      let changed = false;
      for (const k of Object.keys(next) as (keyof Errors)[]) {
        if (k !== "form" && k !== "images" && !fresh[k]) { delete next[k]; changed = true; }
      }
      return changed ? next : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, sku, categoryId, price, moq, stock, len, wid, hei, gsm, isFeatured, featuredOrder, isNewArrival, newArrivalOrder]);

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      // Primary first; new files become "upload:N" tokens into imageUploads.
      const ordered = imgs.length ? [imgs[primary], ...imgs.filter((_, i) => i !== primary)] : [];
      const imageUploads: { name: string; mime: string; dataBase64: string }[] = [];
      const images: string[] = [];
      for (const img of ordered) {
        if (img.file) {
          imageUploads.push({ name: img.file.name, mime: img.file.type, dataBase64: await fileToBase64(img.file) });
          images.push(`upload:${imageUploads.length - 1}`);
        } else if (img.url) {
          images.push(img.url);
        }
      }
      const hasDims = len.trim() && wid.trim() && hei.trim();
      const input: ProductWriteInput = {
        name: name.trim(),
        sku: sku.trim(),
        categoryId,
        subcategoryId: subcategoryId || null,
        description: description.trim() || null,
        length: hasDims ? Number(len) : null,
        width: hasDims ? Number(wid) : null,
        height: hasDims ? Number(hei) : null,
        dimUnit: hasDims ? unit : null,
        gsm: gsm.trim() ? Number(gsm) : null,
        material: material.trim() || null,
        productType: productType.trim() || null,
        color: color.trim() || null,
        basePriceMinor: Math.round(Number(price) * 100),
        moq: Number(moq),
        stock: stock.trim() === "" ? 0 : Number(stock),
        lowStockLevel: lowLevel.trim() ? Number(lowLevel) : null,
        status,
        // Off ⇒ order is cleared; on with an empty order ⇒ sorted after ordered picks.
        isFeatured,
        featuredOrder: isFeatured && featuredOrder.trim() ? Number(featuredOrder) : null,
        isNewArrival,
        newArrivalOrder: isNewArrival && newArrivalOrder.trim() ? Number(newArrivalOrder) : null,
        images,
        imageUploads,
      };
      const saved = editing && product ? await saveProduct(product.id, input) : await createProduct(input);
      toast.success(editing ? "Product updated" : "Product created", `${saved.name} (${saved.sku}) saved to the catalog${images.length ? ` with ${images.length} image${images.length === 1 ? "" : "s"}` : ""}.`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      // Map server errors onto the field they belong to; keep the form intact.
      const next: Errors = {};
      if (err instanceof CatalogApiError) {
        if (err.code === "SKU_EXISTS") next.sku = "SKU already exists. Use a different SKU.";
        else if (err.code === "CATEGORY_NOT_FOUND" || err.code === "CATEGORY_REQUIRED" || err.code === "SUBCATEGORY_NOT_FOUND") next.category = err.message;
        else if (err.code?.startsWith("DIM")) next.dims = err.message;
        else if (["BAD_IMAGE_TYPE", "IMAGE_TOO_LARGE", "CORRUPT_IMAGE", "EMPTY_IMAGE", "IMAGE_NOT_UPLOADED", "PAYLOAD_TOO_LARGE"].includes(err.code ?? "")) next.images = describeCatalogError(err);
        else if (err.code === "VALIDATION") {
          for (const i of err.issues) {
            const p = i.path;
            if (p === "name") next.name = i.message;
            else if (p === "sku") next.sku = i.message;
            else if (p === "basePriceMinor") next.price = i.message;
            else if (p === "moq") next.moq = i.message;
            else if (p === "stock") next.stock = i.message;
            else if (["length", "width", "height", "dimUnit"].includes(p)) next.dims = i.message;
            else if (p === "gsm") next.gsm = i.message;
            else if (p === "featuredOrder") next.featuredOrder = i.message;
            else if (p === "newArrivalOrder") next.newArrivalOrder = i.message;
            else next.form = `${p || "field"}: ${i.message}`;
          }
          if (!Object.keys(next).length) next.form = describeCatalogError(err);
        } else next.form = describeCatalogError(err);
      } else next.form = describeCatalogError(err);
      setErrors(next);
      toast.error(editing ? "Couldn't save product" : "Couldn't create product", next.sku ?? next.category ?? next.images ?? next.form ?? "Please check the highlighted fields.");
    } finally {
      setBusy(false);
    }
  };

  const twoCol = "grid grid-cols-2 gap-3";

  return (
    <Drawer
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title={editing ? "Edit product" : "Add product"}
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          {errors.form && <span className="mr-auto text-xs text-red-600 dark:text-red-400">{errors.form}</span>}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>{editing ? "Save changes" : "Create product"}</Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Basic */}
        <Section title="Basic information">
          {editing && product && (
            <div className={twoCol}>
              <label className="block">
                <span className={LABEL}>Product ID</span>
                <input value={product.id} readOnly className={cn(FIELD, "font-mono opacity-70")} aria-label="Product ID (generated)" />
              </label>
              <div />
            </div>
          )}
          <label className="block">
            <span className={LABEL}>Product name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corrugated Mailer Box" className={cn(FIELD, errors.name && FIELD_ERR)} aria-invalid={!!errors.name} />
            <FieldError msg={errors.name} />
          </label>
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>SKU *</span>
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="MB-KRF-002" className={cn(FIELD, "font-mono", errors.sku && FIELD_ERR)} aria-invalid={!!errors.sku} />
              <FieldError msg={errors.sku} />
            </label>
            <label className="block">
              <span className={LABEL}>Category *</span>
              <Select value={categoryId} onChange={(v) => { setCategoryId(v); setSubcategoryId(""); }} className={cn("w-full", errors.category && FIELD_ERR)} aria-label="Category">
                <option value="">— Select a category —</option>
                {/* Active categories only — plus the product's current one, so an
                    edit still resolves after its category was deactivated. */}
                {categories.filter((c) => c.isActive || c.id === categoryId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (inactive)"}</option>
                ))}
              </Select>
              {categories.length === 0 && <span className="mt-1 block text-[11px] erp-text-faint">Loading categories from the database…</span>}
              {categories.length > 0 && !categories.some((c) => c.isActive) && <span className="mt-1 block text-[11px] erp-text-faint">No active category yet — <a href="/admin/catalog/categories" className="font-semibold text-primary-600 hover:underline">add one</a>.</span>}
              <FieldError msg={errors.category} />
            </label>
          </div>
          <div className={twoCol}>
            <label className="block">
              <span className={LABEL}>Subcategory</span>
              {(() => {
                const subs = (selectedCategory?.subcategories ?? []).filter((sc) => sc.isActive || sc.id === subcategoryId);
                const none = Boolean(selectedCategory) && subs.length === 0;
                return (
                  <>
                    <Select value={subcategoryId} onChange={setSubcategoryId} className="w-full" aria-label="Subcategory">
                      <option value="">{none ? "No subcategories in this category" : "— None —"}</option>
                      {subs.map((sc) => (
                        <option key={sc.id} value={sc.id}>{sc.name}{sc.isActive ? "" : " (inactive)"}</option>
                      ))}
                    </Select>
                    {none && <span className="mt-1 block text-[11px] erp-text-faint">Optional — this category has no active subcategories.</span>}
                  </>
                );
              })()}
            </label>
            <label className="block">
              <span className={LABEL}>Type</span>
              <input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="e.g. Mailer box, Cup, Pouch" className={FIELD} />
            </label>
          </div>
          <label className="block">
            <span className={LABEL}>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Short product description…" className={cn(FIELD, "h-auto py-2")} />
          </label>
        </Section>

        {/* Images */}
        <Section title="Images">
          {imgs.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-6">
              {imgs.map((img, i) => (
                <div key={img.key} className="group relative">
                  <div className={cn("h-20 w-20 overflow-hidden rounded-xl border", i === primary ? "border-primary-500 ring-2 ring-primary-100 dark:ring-primary-500/20" : "erp-border erp-surface-2")}>
                    <img src={img.preview} alt="" className="h-full w-full object-cover" />
                    {i === primary && <span className="absolute left-1 top-1 rounded bg-primary-500 px-1 text-[9px] font-bold text-white">PRIMARY</span>}
                    {img.file && <span className="absolute bottom-1 right-1 rounded bg-dark-900/70 px-1 text-[9px] font-semibold text-white">new</span>}
                  </div>
                  <div className="absolute inset-x-0 -bottom-6 flex justify-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button type="button" onClick={() => setPrimary(i)} aria-label="Set as primary" title="Set as primary" className="rounded p-0.5 erp-text-muted hover:text-primary-600">
                      <Star className={cn("h-3.5 w-3.5", i === primary && "fill-primary-500 text-primary-500")} />
                    </button>
                    <button type="button" onClick={() => moveImage(i, -1)} aria-label="Move left" className="rounded p-0.5 erp-text-muted hover:erp-text"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => moveImage(i, 1)} aria-label="Move right" className="rounded p-0.5 erp-text-muted hover:erp-text"><ChevronRight className="h-3.5 w-3.5" /></button>
                    <label aria-label="Replace image" title="Replace" className="cursor-pointer rounded p-0.5 erp-text-muted hover:erp-text">
                      <Upload className="h-3.5 w-3.5" />
                      <input type="file" accept={ACCEPT.join(",")} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) replaceImage(i, f); e.target.value = ""; }} />
                    </label>
                    <button type="button" onClick={() => removeImage(i)} aria-label="Remove image" className="rounded p-0.5 text-red-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
            className={cn("flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors", dragOver ? "border-primary-500 bg-primary-50/40" : "erp-border erp-surface-2", errors.images && "border-red-400")}
          >
            <ImagePlus className="h-5 w-5 erp-text-muted" aria-hidden />
            <p className="text-sm font-semibold erp-text">Drop images here or click to browse</p>
            <p className="text-[11px] erp-text-faint">JPG, PNG or WebP · up to 10 MB each · max {MAX_IMAGES} images</p>
            <input ref={fileRef} type="file" accept={ACCEPT.join(",")} multiple className="hidden" aria-label="Choose product images" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
          </div>
          <FieldError msg={errors.images} />
          <p className="flex items-center gap-1 text-[11px] erp-text-faint"><GripVertical className="h-3 w-3" aria-hidden /> The ★ primary image is shown in the catalog and to buyers. Images are stored when you save.</p>
        </Section>

        {/* Dimensions */}
        <Section title="Dimensions">
          <div className="grid grid-cols-4 gap-3">
            <label className="block"><span className={LABEL}>Length</span><input type="number" min={0} step="any" value={len} onChange={(e) => setLen(e.target.value)} className={cn(FIELD, errors.dims && FIELD_ERR)} /></label>
            <label className="block"><span className={LABEL}>Width</span><input type="number" min={0} step="any" value={wid} onChange={(e) => setWid(e.target.value)} className={cn(FIELD, errors.dims && FIELD_ERR)} /></label>
            <label className="block"><span className={LABEL}>Height</span><input type="number" min={0} step="any" value={hei} onChange={(e) => setHei(e.target.value)} className={cn(FIELD, errors.dims && FIELD_ERR)} /></label>
            <label className="block">
              <span className={LABEL}>Unit</span>
              <Select value={unit} onChange={(v) => setUnit(v as "in" | "cm" | "mm")} className="w-full" aria-label="Unit">
                <option value="cm">cm</option><option value="in">in</option><option value="mm">mm</option>
              </Select>
            </label>
          </div>
          <FieldError msg={errors.dims} />
        </Section>

        {/* Specifications */}
        <Section title="Specifications">
          <div className={twoCol}>
            <label className="block"><span className={LABEL}>Material</span><input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. Kraft, Corrugated E-flute" className={FIELD} /></label>
            <label className="block"><span className={LABEL}>GSM</span><input type="number" min={0} value={gsm} onChange={(e) => setGsm(e.target.value)} className={cn(FIELD, errors.gsm && FIELD_ERR)} /><FieldError msg={errors.gsm} /></label>
            <label className="block"><span className={LABEL}>Color</span><input value={color} onChange={(e) => setColor(e.target.value)} placeholder="e.g. Natural Kraft" className={FIELD} /></label>
          </div>
        </Section>

        {/* Commercial */}
        <Section title="Commercial">
          <div className={twoCol}>
            <label className="block"><span className={LABEL}>Price (₹) *</span><input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={cn(FIELD, errors.price && FIELD_ERR)} aria-invalid={!!errors.price} /><FieldError msg={errors.price} /></label>
            <label className="block"><span className={LABEL}>MOQ *</span><input type="number" min={1} value={moq} onChange={(e) => setMoq(e.target.value)} className={cn(FIELD, errors.moq && FIELD_ERR)} aria-invalid={!!errors.moq} /><FieldError msg={errors.moq} /></label>
          </div>
        </Section>

        {/* Inventory */}
        <Section title="Inventory">
          <div className={twoCol}>
            <label className="block"><span className={LABEL}>{editing ? "Stock quantity" : "Opening stock"}</span><input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} className={cn(FIELD, errors.stock && FIELD_ERR)} /><FieldError msg={errors.stock} /></label>
            <label className="block"><span className={LABEL}>Low stock level</span><input type="number" min={0} value={lowLevel} onChange={(e) => setLowLevel(e.target.value)} className={FIELD} /></label>
          </div>
          <p className="text-[11px] erp-text-faint">Stock status (In stock / Low / Out of stock) is derived from quantity and never changes the product status.</p>
        </Section>

        {/* Status */}
        <Section title="Product status">
          <div className="flex gap-2">
            {(["draft", "active"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold capitalize transition-colors",
                  status === s ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300" : "erp-border erp-text-muted hover:erp-surface-2",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {editing && product?.status === "archived" && <p className="text-[11px] text-amber-600">This product is archived — saving as Draft or Active will unarchive it.</p>}
        </Section>

        {/* Homepage visibility — stored in PostgreSQL, read by the storefront rails */}
        <Section title="Homepage visibility">
          <div className="space-y-3">
            <div className={cn("rounded-xl border p-4 transition-colors", isFeatured ? "border-primary-300 bg-primary-50/50 dark:border-primary-500/40 dark:bg-primary-500/5" : "erp-border")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold erp-text"><Star className={cn("h-4 w-4", isFeatured ? "fill-primary-500 text-primary-500" : "erp-text-faint")} aria-hidden /> Featured Product</p>
                  <p className="mt-0.5 text-xs erp-text-muted">Show this product in the homepage Featured Products section.</p>
                </div>
                <Switch checked={isFeatured} onChange={(v) => { setIsFeatured(v); if (!v) setFeaturedOrder(""); }} label="Featured Product" />
              </div>
              {isFeatured && (
                <label className="mt-3 block max-w-[220px]">
                  <span className={LABEL}>Featured display order</span>
                  <input type="number" min={1} step={1} inputMode="numeric" value={featuredOrder} onChange={(e) => setFeaturedOrder(e.target.value)} placeholder="e.g. 1" className={cn(FIELD, errors.featuredOrder && FIELD_ERR)} aria-invalid={!!errors.featuredOrder} />
                  <FieldError msg={errors.featuredOrder} />
                  <span className="mt-1 block text-[11px] erp-text-faint">Optional. Lower numbers show first; blank goes after ordered products.</span>
                </label>
              )}
            </div>

            <div className={cn("rounded-xl border p-4 transition-colors", isNewArrival ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-500/40 dark:bg-emerald-500/5" : "erp-border")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold erp-text"><Sparkles className={cn("h-4 w-4", isNewArrival ? "text-emerald-600" : "erp-text-faint")} aria-hidden /> Fresh on the Market</p>
                  <p className="mt-0.5 text-xs erp-text-muted">Show this product in the homepage Fresh on the Market section.</p>
                </div>
                <Switch checked={isNewArrival} onChange={(v) => { setIsNewArrival(v); if (!v) setNewArrivalOrder(""); }} label="Fresh on the Market" />
              </div>
              {isNewArrival && (
                <label className="mt-3 block max-w-[220px]">
                  <span className={LABEL}>New arrival display order</span>
                  <input type="number" min={1} step={1} inputMode="numeric" value={newArrivalOrder} onChange={(e) => setNewArrivalOrder(e.target.value)} placeholder="e.g. 1" className={cn(FIELD, errors.newArrivalOrder && FIELD_ERR)} aria-invalid={!!errors.newArrivalOrder} />
                  <FieldError msg={errors.newArrivalOrder} />
                  <span className="mt-1 block text-[11px] erp-text-faint">Optional. Lower numbers show first; blank goes after ordered products.</span>
                </label>
              )}
            </div>
            {status !== "active" && (isFeatured || isNewArrival) && <p className="text-[11px] text-amber-600">Only Active products are shown on the storefront — this one will appear once its status is Active.</p>}
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
