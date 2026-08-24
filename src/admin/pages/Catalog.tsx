import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Ban,
  Boxes,
  Copy,
  Eye,
  FileDown,
  FilterX,
  MoreHorizontal,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, Panel } from "../components/Panel";
import {
  Badge,
  Button,
  Dialog,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Tabs,
  Toolbar,
  type TabItem,
} from "../components/ui";
// Canonical categories from PostgreSQL (NOT the empty mock array, which is
// why this page used to report "Categories = 0").
import { useCategories, hydrateCategories, createCategory, type AdminCategory } from "../categories-store";
import { API_BASE } from "@/lib/api-config";
import { addProduct, hydrateCatalog, useCatalog } from "../catalog-store";
import { catalogApi } from "@/lib/catalog-api";
import { PRODUCT_STATUS, STOCK_STATUS } from "../statuses-ext";
import type { CatalogProduct, ProductStatus, StockStatus } from "../types";
import {
  ArchiveDialog,
  ImageLightbox,
  MarkOutOfStockDialog,
  ProductDetailsDrawer,
  MediaThumb,
  ProductFormDrawer,
  UpdateStockDialog,
  dimsLabel,
  priceLabel,
  productImages,
} from "./catalog/CatalogComponents";
import { BulkImportButton } from "./catalog/BulkImport";
import { BulkImageUploadDialog, UploadImageDialog } from "./catalog/ImageUpload";
import { GenerateFromImagesButton } from "./catalog/GenerateFromImages";

const PAGE_SIZE = 8;

// ---------- CSV export ----------

function exportCsv(products: CatalogProduct[]) {
  const header = ["ID", "Name", "SKU", "Category", "Dimensions", "GSM", "Color", "Price", "Stock", "Stock Status", "Product Status"];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = products.map((p) =>
    [p.id, p.name, p.sku, p.category, dimsLabel(p), p.gsm ?? "", p.color ?? "", p.basePrice, p.stock ?? 0, p.stockStatus ?? "", p.status]
      .map(escape)
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zolo-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Row "More" menu ----------

function RowMenu({
  product,
  onUpdateStock,
  onMarkOOS,
  onDuplicate,
  onArchive,
}: {
  product: CatalogProduct;
  onUpdateStock: () => void;
  onMarkOOS: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const archived = product.status === "archived";
  const item = "flex w-full min-h-10 items-center gap-2.5 px-3 py-2 text-left text-sm erp-text hover:erp-surface-2";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`More actions for ${product.name}`}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
          {archived ? (
            <button role="menuitem" className={item} onClick={() => { setOpen(false); onArchive(); }}>
              <ArchiveRestore className="h-4 w-4 erp-text-faint" aria-hidden /> Unarchive
            </button>
          ) : (
            <>
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onUpdateStock(); }}>
                <PackageCheck className="h-4 w-4 erp-text-faint" aria-hidden /> Update Stock
              </button>
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onMarkOOS(); }}>
                <Ban className="h-4 w-4 erp-text-faint" aria-hidden /> Mark Out of Stock
              </button>
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onDuplicate(); }}>
                <Copy className="h-4 w-4 erp-text-faint" aria-hidden /> Duplicate
              </button>
              <div className="my-1 border-t erp-border-soft" />
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onArchive(); }}>
                <Archive className="h-4 w-4 erp-text-faint" aria-hidden /> Archive
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Summary chips ----------

type SummaryKey = "all" | "active" | "low_stock" | "out_of_stock" | "archived";

function SummaryChips({
  products,
  active,
  onSelect,
}: {
  products: CatalogProduct[];
  active: SummaryKey;
  onSelect: (k: SummaryKey) => void;
}) {
  const counts = useMemo(
    () => ({
      all: products.length,
      active: products.filter((p) => p.status === "active").length,
      low_stock: products.filter((p) => p.stockStatus === "low_stock").length,
      out_of_stock: products.filter((p) => p.stockStatus === "out_of_stock").length,
      archived: products.filter((p) => p.status === "archived").length,
    }),
    [products],
  );
  const chips: { key: SummaryKey; label: string; tone?: string }[] = [
    { key: "all", label: "All Products" },
    { key: "active", label: "Active", tone: "text-emerald-600 dark:text-emerald-400" },
    { key: "low_stock", label: "Low Stock", tone: "text-amber-600 dark:text-amber-400" },
    { key: "out_of_stock", label: "Out of Stock", tone: "text-red-600 dark:text-red-400" },
    { key: "archived", label: "Archived", tone: "erp-text-muted" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={() => onSelect(c.key)}
          aria-pressed={active === c.key}
          className={cn(
            "flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-colors",
            active === c.key ? "border-primary-500 ring-1 ring-primary-200 dark:ring-primary-500/30" : "erp-border erp-surface hover:erp-surface-2",
          )}
        >
          <span className="text-xs font-semibold erp-text-muted">{c.label}</span>
          <span className={cn("font-display text-xl font-extrabold", c.tone ?? "erp-text")}>{counts[c.key]}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- Products tab ----------

function ProductsTab() {
  const toast = useToast();
  const products = useCatalog();

  const [summary, setSummary] = useState<SummaryKey>("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [stockStatus, setStockStatus] = useState<StockStatus | "all">("all");
  const [productStatus, setProductStatus] = useState<ProductStatus | "all">("all");
  const [page, setPage] = useState(1);

  // Drawer / dialog targets
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null);
  const [formProduct, setFormProduct] = useState<CatalogProduct | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<CatalogProduct | null>(null);
  const [oosProduct, setOosProduct] = useState<CatalogProduct | null>(null);
  const [archiveProduct, setArchiveProduct] = useState<CatalogProduct | null>(null);
  const [lightbox, setLightbox] = useState<{ product: CatalogProduct; index: number } | null>(null);

  // Multi-select for bulk actions. Holds product ids; kept as a Set so
  // select-all over a large page stays O(n).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [imageTarget, setImageTarget] = useState<CatalogProduct | null>(null);
  const [bulkImagesOpen, setBulkImagesOpen] = useState(false);

  const categories = useCategories();
  useEffect(() => { void hydrateCategories(); }, []);
  const catOptions = useMemo(() => ["all", ...categories.map((c) => c.name)], [categories]);
  const filtersActive =
    search.trim() !== "" || category !== "all" || stockStatus !== "all" || productStatus !== "all" || summary !== "all";

  // Summary chip → base filter
  const summaryFilter = (p: CatalogProduct): boolean => {
    switch (summary) {
      case "active": return p.status === "active";
      case "low_stock": return p.stockStatus === "low_stock";
      case "out_of_stock": return p.stockStatus === "out_of_stock";
      case "archived": return p.status === "archived";
      default: return summary === "all";
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!summaryFilter(p)) return false;
      if (category !== "all" && p.category !== category) return false;
      if (stockStatus !== "all" && p.stockStatus !== stockStatus) return false;
      if (productStatus !== "all" && p.status !== productStatus) return false;
      if (term) {
        const hay = `${p.name} ${p.id} ${p.sku} ${p.category} ${p.color ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, search, category, stockStatus, productStatus, summary]);

  const pageCount = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const current = Math.min(page, pageCount);
  const paged = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // ---- Selection helpers -------------------------------------------------
  // "Select all" applies to the CURRENT PAGE only — selecting rows the user
  // cannot see (and then deleting them) is exactly the accident to avoid.
  const pageIds = paged.map((p) => p.id);
  const selectedOnPage = pageIds.filter((id) => selected.has(id));
  const allPageSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const runBulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const res = await catalogApi.bulkDelete(ids);
      await hydrateCatalog();
      clearSelection();
      setBulkDeleteOpen(false);
      toast.success(
        `${res.deleted} product${res.deleted === 1 ? "" : "s"} deleted`,
        "Archived — existing orders keep their history.",
      );
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "Could not delete the selected products.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setSearch(""); setCategory("all"); setStockStatus("all"); setProductStatus("all"); setSummary("all"); resetPage();
  };

  const duplicate = (p: CatalogProduct) => {
    const id = `PRD-${Math.floor(1100 + Math.random() * 800)}`;
    addProduct({
      ...p,
      id,
      name: `${p.name} (Copy)`,
      sku: `${p.sku}-C`,
      status: "draft",
      stock: 0,
      stockStatus: "out_of_stock",
      updatedAt: new Date().toISOString(),
    });
    toast.success("Duplicated", `Created a draft copy of ${p.name}.`);
  };

  return (
    <div className="space-y-4">
      <SummaryChips products={products} active={summary} onSelect={(k) => { setSummary(k); resetPage(); }} />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); resetPage(); }}
          placeholder="Search product name, ID or SKU…"
          className="w-full sm:w-72"
        />
        <Select value={category} onChange={(v) => { setCategory(v); resetPage(); }} aria-label="Filter by category">
          {catOptions.map((c) => (
            <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>
          ))}
        </Select>
        <Select value={stockStatus} onChange={(v) => { setStockStatus(v as StockStatus | "all"); resetPage(); }} aria-label="Filter by stock status">
          <option value="all">All stock</option>
          <option value="in_stock">In Stock</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
        </Select>
        <Select value={productStatus} onChange={(v) => { setProductStatus(v as ProductStatus | "all"); resetPage(); }} aria-label="Filter by product status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
        {filtersActive && (
          <Button size="sm" variant="ghost" icon={FilterX} onClick={clearFilters}>
            Clear Filters
          </Button>
        )}
        <Button size="sm" variant="secondary" icon={Upload} className="ml-auto" onClick={() => setBulkImagesOpen(true)}>
          Bulk Upload Images
        </Button>
      </Toolbar>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState icon={Boxes} title="No products" message="Nothing matches your search and filters." />
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b erp-border bg-primary-50/70 px-4 py-2.5 dark:bg-primary-500/10">
              <span className="text-sm font-semibold erp-text">
                {selected.size} product{selected.size === 1 ? "" : "s"} selected
              </span>
              <button onClick={clearSelection} className="text-xs font-semibold erp-text-muted hover:underline">
                Clear selection
              </button>
              <div className="ml-auto">
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => setBulkDeleteOpen(true)}>
                  Delete Selected
                </Button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Products</caption>
              <thead>
                <tr className="border-b erp-border text-left">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        // Indeterminate when only some rows on this page are picked.
                        if (el) el.indeterminate = selectedOnPage.length > 0 && !allPageSelected;
                      }}
                      onChange={toggleAllOnPage}
                      aria-label={allPageSelected ? "Deselect all products on this page" : "Select all products on this page"}
                      className="h-4 w-4 cursor-pointer rounded border-dark-300 accent-primary-600"
                    />
                  </th>
                  {["Image", "SKU / ID", "Product", "Dimensions", "GSM", "Color", "Price", "Stock", "Stock Status", "Image", "Product", "Actions"].map((h, i) => (
                    <th
                      key={`${h}-${i}`}
                      scope="col"
                      className={cn(
                        "px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint",
                        (i === 3 || i === 4) && "hidden lg:table-cell",
                        i === 5 && "hidden xl:table-cell",
                        i === 9 && "hidden md:table-cell",
                        i === 11 && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => {
                  const ps = PRODUCT_STATUS[p.status];
                  const ss = p.stockStatus ? STOCK_STATUS[p.stockStatus] : null;
                  const imgs = productImages(p);
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-b erp-border-soft last:border-0 erp-hover",
                        selected.has(p.id) && "bg-primary-50/60 dark:bg-primary-500/10",
                      )}
                    >
                      {/* Row selection */}
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleOne(p.id)}
                          aria-label={`Select ${p.name}`}
                          className="h-4 w-4 cursor-pointer rounded border-dark-300 accent-primary-600"
                        />
                      </td>
                      {/* Image */}
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setLightbox({ product: p, index: 0 })}
                          aria-label={`Preview images of ${p.name}`}
                          className="relative flex h-11 w-11 items-center justify-center overflow-visible rounded-lg border erp-border erp-surface-2 text-2xl transition-colors hover:border-primary-500"
                        >
                          <MediaThumb src={imgs[0]} imgClass="h-full w-full rounded-lg object-cover" />
                          {imgs.length > 1 && (
                            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-dark-900 px-1 text-[9px] font-bold text-white dark:bg-dark-700">
                              {imgs.length}
                            </span>
                          )}
                        </button>
                      </td>
                      {/* SKU / ID */}
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs font-semibold erp-text">{p.sku}</div>
                        <div className="font-mono text-[11px] erp-text-faint">{p.id}</div>
                      </td>
                      {/* Product */}
                      <td className="px-3 py-2">
                        <button onClick={() => setDetailProduct(p)} className="text-left font-semibold erp-text hover:text-primary-600 dark:hover:text-primary-400">
                          {p.name}
                        </button>
                        <div className="text-[11px] erp-text-faint">{p.category}</div>
                      </td>
                      {/* Dimensions */}
                      <td className="hidden px-3 py-2 erp-text-muted lg:table-cell">{dimsLabel(p)}</td>
                      {/* GSM */}
                      <td className="hidden px-3 py-2 tabular-nums erp-text-muted lg:table-cell">{p.gsm ?? "—"}</td>
                      {/* Color */}
                      <td className="hidden px-3 py-2 erp-text-muted xl:table-cell">{p.color ?? "—"}</td>
                      {/* Price */}
                      <td className="px-3 py-2 tabular-nums font-semibold erp-text">{priceLabel(p.basePrice)}</td>
                      {/* Stock qty */}
                      <td className="px-3 py-2 tabular-nums erp-text-muted">{(p.stock ?? 0).toLocaleString("en-IN")}</td>
                      {/* Stock status */}
                      <td className="px-3 py-2">{ss && <Badge tone={ss.tone} dot>{ss.label}</Badge>}</td>
                      {/* Image status — surfaces products still needing a picture */}
                      <td className="hidden px-3 py-2 md:table-cell">
                        {imgs.length > 0 && /^https?:\/\//i.test(imgs[0])
                          ? <Badge tone="success">Image</Badge>
                          : <Badge tone="warning">Missing</Badge>}
                      </td>
                      {/* Product status */}
                      <td className="px-3 py-2"><Badge tone={ps.tone}>{ps.label}</Badge></td>
                      {/* Actions */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            onClick={() => setDetailProduct(p)}
                            aria-label={`View ${p.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            onClick={() => { setFormProduct(p); setFormOpen(true); }}
                            aria-label={`Edit ${p.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            onClick={() => setImageTarget(p)}
                            aria-label={`Upload image for ${p.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
                          >
                            <Upload className="h-4 w-4" aria-hidden />
                          </button>
                          <RowMenu
                            product={p}
                            onUpdateStock={() => setStockProduct(p)}
                            onMarkOOS={() => setOosProduct(p)}
                            onDuplicate={() => duplicate(p)}
                            onArchive={() => setArchiveProduct(p)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={current} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
        </Panel>
      )}

      <UploadImageDialog product={imageTarget} open={imageTarget !== null} onClose={() => setImageTarget(null)} />
      <BulkImageUploadDialog open={bulkImagesOpen} onClose={() => setBulkImagesOpen(false)} />

      {/* Bulk delete confirmation — deliberately explicit about what happens */}
      <Dialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`Delete ${selected.size} product${selected.size === 1 ? "" : "s"}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={bulkDeleting} onClick={runBulkDelete}>
              Delete Product{selected.size === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <p className="text-sm erp-text-muted">
          This removes {selected.size === 1 ? "this product" : "these products"} from the catalog and the storefront.
        </p>
        <p className="mt-2 text-sm erp-text-muted">
          Products are <span className="font-semibold erp-text">archived, not erased</span> — existing orders and
          invoices keep their history intact.
        </p>
      </Dialog>

      {/* Details drawer */}
      <ProductDetailsDrawer
        product={detailProduct}
        open={detailProduct !== null}
        onClose={() => setDetailProduct(null)}
        onEdit={(p) => { setDetailProduct(null); setFormProduct(p); setFormOpen(true); }}
        onUpdateStock={(p) => setStockProduct(p)}
        onMarkOOS={(p) => setOosProduct(p)}
        onArchive={(p) => setArchiveProduct(p)}
        onOpenImage={(p, i) => setLightbox({ product: p, index: i })}
      />

      {/* Add / Edit form drawer */}
      <ProductFormDrawer product={formProduct} open={formOpen} onClose={() => { setFormOpen(false); setFormProduct(null); }} />

      {/* Stock update */}
      {stockProduct && (
        <UpdateStockDialog product={stockProduct} open onClose={() => setStockProduct(null)} />
      )}
      {/* Mark out of stock */}
      {oosProduct && (
        <MarkOutOfStockDialog product={oosProduct} open onClose={() => setOosProduct(null)} />
      )}
      {/* Archive / unarchive */}
      {archiveProduct && (
        <ArchiveDialog product={archiveProduct} open onClose={() => setArchiveProduct(null)} />
      )}
      {/* Lightbox */}
      {lightbox && (
        <ImageLightbox product={lightbox.product} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

// ---------- Categories tab ----------

type CatRow = AdminCategory & { archived?: boolean };

function CategoriesTab() {
  const toast = useToast();
  // Real categories from PostgreSQL — the same rows the importer upserts and
  // the storefront renders. Previously this was local useState seeded from an
  // empty mock array, so nothing here ever persisted.
  const categories = useCategories();
  const [dialog, setDialog] = useState<{ mode: "add" | "edit"; row?: CatRow } | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void hydrateCategories(); }, []);

  const rows: CatRow[] = categories.map((c) => ({ ...c, archived: !c.isActive }));

  const openAdd = () => { setName(""); setParentId(""); setDialog({ mode: "add" }); };
  const openEdit = (row: CatRow) => { setName(row.name); setParentId(""); setDialog({ mode: "edit", row }); };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      if (dialog?.mode === "add") {
        await createCategory(trimmed, parentId || undefined);
        toast.success("Category created", parentId ? `Added “${trimmed}” as a subcategory.` : `Created “${trimmed}”.`);
      } else {
        // Renaming is not exposed yet — it would orphan slugs referenced by
        // storefront URLs. Tracked separately.
        toast.error("Renaming not available", "Create the new category and re-assign products instead.");
      }
      setDialog(null);
    } catch (e) {
      toast.error("Could not save the category", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (row: CatRow) => {
    if (row.archived) {
      toast.error("Reactivation not available", "Re-import or create the category to restore it.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/categories/${row.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!body?.success) throw new Error(body?.error ?? "Request failed");
      await hydrateCategories(true);
      toast.success("Category archived", `${row.name} — ${body.data.productsAffected} product(s) still reference it.`);
    } catch (e) {
      toast.error("Could not archive", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const field = "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";

  return (
    <div className="space-y-4">
      <Toolbar>
        <span className="text-xs erp-text-faint">{rows.filter((r) => !r.archived).length} active categories</span>
        <Button size="sm" variant="primary" icon={Plus} className="ml-auto" onClick={openAdd}>
          Add Category
        </Button>
      </Toolbar>
      <Panel bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b erp-border text-left">
                {["Category", "Subcategories", "Products", "Status", "Actions"].map((h, i) => (
                  <th key={h} scope="col" className={cn("px-4 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint", i === 4 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={cn("border-b erp-border-soft last:border-0 erp-hover", c.archived && "opacity-60")}>
                  <td className="px-4 py-3 font-semibold erp-text">{c.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {c.subcategories.length === 0 ? (
                        <span className="text-xs erp-text-faint">—</span>
                      ) : (
                        c.subcategories.map((s) => (
                          <span key={s.id} className="rounded-md erp-surface-2 px-1.5 py-0.5 text-[11px] font-medium erp-text-muted">
                            {s.name} <span className="erp-text-faint">({s.productCount})</span>
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold erp-text">{c.productCount}</td>
                  <td className="px-4 py-3">
                    {c.archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="success">Active</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-0.5">
                      <button onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button onClick={() => toggleArchive(c)} aria-label={c.archived ? `Restore ${c.name}` : `Archive ${c.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
                        {c.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === "edit" ? "Edit category" : "Add category"}
        description={dialog?.mode === "edit" ? "Rename this category." : "Create a new product category."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim()} loading={busy} onClick={save}>
              {dialog?.mode === "edit" ? "Save" : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Category name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sustainable Packaging" className={field} autoFocus />
          </label>
          {dialog?.mode === "add" && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Parent category (optional)</span>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={field}>
                <option value="">— Top-level category —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] erp-text-faint">
                Choose a parent to create a subcategory (e.g. Boxes → Gift Boxes).
              </span>
            </label>
          )}
        </div>
      </Dialog>
    </div>
  );
}

// Real bulk import (parse/validate/preview/import) lives in ./BulkImport.

// ---------- Page ----------

export default function Catalog() {
  const toast = useToast();
  const products = useCatalog();
  const [tab, setTab] = useState("products");
  const [addOpen, setAddOpen] = useState(false);

  const liveCategories = useCategories();
  useEffect(() => { void hydrateCategories(); }, []);

  const tabs: TabItem[] = [
    { key: "products", label: "Products", count: products.length, icon: Package },
    // Real count from PostgreSQL — this is the "Categories = 0" bug.
    { key: "categories", label: "Categories", count: liveCategories.length, icon: Boxes },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Catalog" }]}
        title="Product Catalog"
        subtitle="Compact product management — specs, stock and status at a glance."
        actions={
          <>
            <Button
              variant="secondary"
              icon={FileDown}
              onClick={() => { exportCsv(products); toast.success("Export ready", "Catalog CSV downloaded."); }}
            >
              Bulk Export
            </Button>
            <GenerateFromImagesButton />
            <BulkImportButton />
            <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>Add Product</Button>
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "products" && <ProductsTab />}
      {tab === "categories" && <CategoriesTab />}

      {/* Add product (create mode) */}
      <ProductFormDrawer product={null} open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
