import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, LayoutGrid, List, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { describeApiError } from "@/lib/api/client";
import { catalogApi, type ProductListQuery } from "@/lib/catalog-api";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Badge, Button, Dialog, PageHeader, SearchInput, Select, Toolbar } from "../../components/ui";
import { EmptyState, Panel } from "../../components/Panel";
import { TableSkeleton } from "../../components/DataTable";
import { hydrateCategories, useCategories } from "../../categories-store";
import { hydrateCatalog } from "../../catalog-store";
import { PRODUCT_STATUS } from "../../statuses-ext";
import type { CatalogProduct, ProductStatus } from "../../types";
import { MediaThumb, priceLabel, ProductFormDrawer } from "./CatalogComponents";
import { normalizeProductColors, normalizeProductSizes, summarizeOptions } from "@/lib/product-options";

// ============================================================
// Product Catalog → Categories → [Manage] one category (or subcategory).
//
// Exactly PAGE_SIZE products per page, fetched from GET /products with
// ?page=&limit=8 plus every filter/sort in the query string — the browser
// never holds more than one page, so 50k products cost the same as 50.
// Counts in the header come from the category tree (DB counts).
// ============================================================

export const PAGE_SIZE = 8;

type Sort = NonNullable<ProductListQuery["sort"]>;
type View = "grid" | "list";

function pageNumbers(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set<number>([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of [...set].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

export default function CategoryProductsPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const categories = useCategories();
  useEffect(() => { void hydrateCategories(); }, []);

  // The route id can be a category or a subcategory (both live in one table).
  const category = useMemo(() => categories.find((c) => c.id === id) ?? categories.find((c) => c.subcategories.some((s) => s.id === id)), [categories, id]);
  const subcategory = useMemo(() => category?.subcategories.find((s) => s.id === id) ?? null, [category, id]);
  const isSub = Boolean(subcategory);

  // ---- query state lives in the URL so pages/filters survive refresh ----
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = params.get("q") ?? "";
  const status = (params.get("status") ?? "") as ProductStatus | "";
  const sub = isSub ? subcategory!.id : (params.get("sub") ?? "");
  const productType = params.get("type") ?? "";
  const color = params.get("color") ?? "";
  const size = params.get("size") ?? "";
  const sort = (params.get("sort") as Sort) || "newest";
  const view = (params.get("view") as View) || "grid";
  const setParam = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  };

  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  // Debounced search → URL → fetch.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParam({ q: search.trim() || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const [data, setData] = useState<{ products: CatalogProduct[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ types: string[]; colors: string[]; sizes: string[] }>({ types: [], colors: [], sizes: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // null = closed; { product: null } = create; { product } = edit.
  const [form, setForm] = useState<{ product: CatalogProduct | null } | null>(null);
  const [confirm, setConfirm] = useState<{ action: "delete" | "archive"; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);

  const scope = useMemo(() => (isSub ? { subcategoryId: subcategory!.id } : sub ? { subcategoryId: sub } : { categoryId: id }), [isSub, subcategory, sub, id]);

  const load = useCallback(async () => {
    const mine = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const res = await catalogApi.page({ ...scope, page, limit: PAGE_SIZE, q, status, productType, color, size, sort });
      if (mine !== reqId.current) return;
      setData({ products: res.products, total: res.total, pages: res.pages });
      // Landed past the last page (e.g. after deletes) → step back.
      if (page > res.pages && res.pages >= 1) setParam({ page: String(res.pages) }, false);
    } catch (e) {
      if (mine !== reqId.current) return;
      setError(describeApiError(e).message);
    } finally { if (mine === reqId.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, page, q, status, productType, color, size, sort]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(new Set()); }, [page, q, status, sub, productType, color, size, sort]);
  useEffect(() => {
    if (!id) return;
    catalogApi.facets(isSub ? { subcategoryId: id } : { categoryId: id }).then(setFacets).catch(() => setFacets({ types: [], colors: [], sizes: [] }));
  }, [id, isSub]);

  /** After any write: this page, the category counts and the shared catalog store. */
  const refresh = async () => { await Promise.all([load(), hydrateCategories(true)]); void hydrateCatalog(); };

  const products = data?.products ?? [];
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  const toggleOne = (pid: string) => setSelected((s) => { const n = new Set(s); if (n.has(pid)) n.delete(pid); else n.add(pid); return n; });

  const bulkStatus = async (ids: string[], next: ProductStatus) => {
    setBusy(true);
    try {
      const r = await catalogApi.bulkStatus(ids, next);
      toast.success(`${r.updated} product${r.updated === 1 ? "" : "s"} ${next === "active" ? "activated" : next === "draft" ? "deactivated" : "archived"}`);
      setSelected(new Set());
      await refresh();
    } catch (e) { toast.error("Couldn't update", describeApiError(e).message); }
    finally { setBusy(false); }
  };
  const bulkDelete = async (ids: string[]) => {
    setBusy(true);
    try {
      const r = await catalogApi.bulkDelete(ids);
      toast.success(`${r.deleted} product${r.deleted === 1 ? "" : "s"} deleted`, "Removed from the catalog; order history is kept.");
      setSelected(new Set()); setConfirm(null);
      await refresh();
    } catch (e) { toast.error("Couldn't delete", describeApiError(e).message); }
    finally { setBusy(false); }
  };

  if (!id) return null;
  const title = subcategory?.name ?? category?.name ?? "Category";
  const total = data?.total ?? (subcategory ?? category)?.productCount ?? 0;
  const pages = data?.pages ?? 1;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const selectedIds = [...selected];

  const ProductActions = ({ p }: { p: CatalogProduct }) => (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => setForm({ product: p })} aria-label={`Edit ${p.name}`} title="Edit" className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2"><Pencil className="h-3.5 w-3.5" /></button>
      {p.status === "archived"
        ? <button type="button" onClick={() => void bulkStatus([p.id], "active")} aria-label={`Unarchive ${p.name}`} title="Unarchive" className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2"><ArchiveRestore className="h-3.5 w-3.5" /></button>
        : <button type="button" onClick={() => setConfirm({ action: "archive", ids: [p.id] })} aria-label={`Archive ${p.name}`} title="Archive" className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2"><Archive className="h-3.5 w-3.5" /></button>}
      {p.status === "active"
        ? <button type="button" onClick={() => void bulkStatus([p.id], "draft")} aria-label={`Deactivate ${p.name}`} title="Deactivate (draft)" className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2"><PowerOff className="h-3.5 w-3.5" /></button>
        : p.status === "draft" && <button type="button" onClick={() => void bulkStatus([p.id], "active")} aria-label={`Activate ${p.name}`} title="Activate" className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2"><Power className="h-3.5 w-3.5" /></button>}
      <button type="button" onClick={() => setConfirm({ action: "delete", ids: [p.id] })} aria-label={`Delete ${p.name}`} title="Delete" className="flex h-7 w-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );

  return (
    <div className="shell-admin flex min-h-0 flex-col gap-4">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Catalog", to: "/admin/catalog" }, { label: "Categories", to: "/admin/catalog/categories" }, ...(subcategory && category ? [{ label: category.name, to: `/admin/catalog/categories/${category.id}` }] : []), { label: title }]}
        title={title}
        subtitle={<span data-testid="product-count">{total.toLocaleString("en-IN")} Product{total === 1 ? "" : "s"}{!isSub && category ? ` · ${category.subcategoryCount} Subcategor${category.subcategoryCount === 1 ? "y" : "ies"}` : ""}</span>}
        actions={<>
          <div className="flex rounded-lg border erp-border p-0.5" role="group" aria-label="View">
            <button type="button" onClick={() => setParam({ view: null }, false)} aria-pressed={view === "grid"} aria-label="Grid view" className={cn("flex h-8 w-8 items-center justify-center rounded-md", view === "grid" ? "erp-surface-2 erp-text" : "erp-text-muted")}><LayoutGrid className="h-4 w-4" /></button>
            <button type="button" onClick={() => setParam({ view: "list" }, false)} aria-pressed={view === "list"} aria-label="List view" className={cn("flex h-8 w-8 items-center justify-center rounded-md", view === "list" ? "erp-surface-2 erp-text" : "erp-text-muted")}><List className="h-4 w-4" /></button>
          </div>
          <Button variant="primary" onClick={() => setForm({ product: null })}>Add Product</Button>
        </>}
      />

      {/* Subcategory chips (category view only) — counts are DB counts from the tree */}
      {!isSub && category && category.subcategories.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Subcategories">
          <button type="button" onClick={() => setParam({ sub: null })} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", !sub ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300" : "erp-border erp-text-muted hover:erp-surface-2")}>All · {category.productCount}</button>
          {category.subcategories.map((s) => (
            <button key={s.id} type="button" onClick={() => setParam({ sub: s.id })} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", sub === s.id ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300" : "erp-border erp-text-muted hover:erp-surface-2")}>{s.name} · {s.productCount}</button>
          ))}
        </div>
      )}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search products…" className="w-full sm:w-72" aria-label="Search products" />
        <Select value={status} onChange={(v) => setParam({ status: v })} aria-label="Status filter">
          <option value="">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option>
        </Select>
        {facets.types.length > 0 && (
          <Select value={productType} onChange={(v) => setParam({ type: v })} aria-label="Product type filter">
            <option value="">All types</option>{facets.types.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        )}
        {facets.colors.length > 0 && (
          <Select value={color} onChange={(v) => setParam({ color: v })} aria-label="Color filter">
            <option value="">All colors</option>{facets.colors.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        {facets.sizes.length > 0 && (
          <Select value={size} onChange={(v) => setParam({ size: v })} aria-label="Size filter">
            <option value="">All sizes</option>{facets.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
        <Select value={sort} onChange={(v) => setParam({ sort: v === "newest" ? null : v })} aria-label="Sort" className="sm:ml-auto">
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option>
        </Select>
      </Toolbar>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm dark:border-primary-500/30 dark:bg-primary-500/10" role="region" aria-label="Bulk actions">
          <span className="font-bold erp-text">{selected.size} selected</span>
          <Button size="sm" icon={Power} disabled={busy} onClick={() => void bulkStatus(selectedIds, "active")}>Activate</Button>
          <Button size="sm" icon={PowerOff} disabled={busy} onClick={() => void bulkStatus(selectedIds, "draft")}>Deactivate</Button>
          <Button size="sm" icon={Archive} disabled={busy} onClick={() => setConfirm({ action: "archive", ids: selectedIds })}>Archive</Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={() => setConfirm({ action: "delete", ids: selectedIds })}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Panel bodyClassName="p-0">
        {/* Scrollable content area — the page itself never grows with the catalog */}
        <div className="max-h-[calc(100vh-22rem)] min-h-[20rem] overflow-y-auto">
          {error && <EmptyState title="Couldn't load products" message={error} action={<Button onClick={() => void load()}>Retry</Button>} />}
          {!error && loading && !data && <div className="p-4"><TableSkeleton rows={4} cols={5} /></div>}
          {!error && data && products.length === 0 && <EmptyState title="No products" message={q || status || productType || color || size ? "No products match these filters." : "This category has no products yet."} />}
          {!error && data && products.length > 0 && view === "grid" && (
            <div className="p-4">
              <label className="mb-3 flex items-center gap-2 text-xs font-semibold erp-text-muted">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all on this page" className="h-3.5 w-3.5 accent-primary-500" /> Select all on this page
              </label>
              <div className={cn("grid-cards grid gap-3 sm:grid-cols-2 xl:grid-cols-4", loading && "opacity-60")} data-testid="product-grid">
                {products.map((p) => {
                  const ps = PRODUCT_STATUS[p.status];
                  const sizes = summarizeOptions(normalizeProductSizes(p.sizeLabel, p.dimensions), 2);
                  const colors = summarizeOptions(normalizeProductColors(p.color), 2);
                  return (
                    <article key={p.id} className={cn("relative flex flex-col rounded-xl border erp-border erp-surface p-3", selected.has(p.id) && "ring-2 ring-primary-400")} data-product-card={p.id}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.name}`} className="absolute left-3 top-3 z-10 h-4 w-4 accent-primary-500" />
                      <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg erp-surface-2">
                        <MediaThumb src={p.images?.[0] ?? p.imageEmoji} imgClass="h-full w-full object-contain" textClass="text-3xl" />
                      </div>
                      <div className="mt-2 min-w-0 flex-1">
                        <div className="truncate text-sm font-bold erp-text" title={p.name}>{p.name}</div>
                        <div className="truncate font-mono text-[11px] erp-text-faint">{p.sku}</div>
                        {p.subcategory && p.subcategory !== "General" && <div className="truncate text-[11px] erp-text-muted">{p.subcategory}</div>}
                        {sizes && <div className="truncate text-[11px] erp-text-muted" title={p.sizeLabel ?? undefined}>Sizes: {sizes}</div>}
                        {colors && <div className="truncate text-[11px] erp-text-muted" title={p.color ?? undefined}>Colors: {colors}</div>}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold erp-text">{priceLabel(p.basePrice)}</span>
                        <Badge tone={ps.tone}>{ps.label}</Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t erp-border-soft pt-2">
                        <span className="text-[11px] erp-text-muted">Stock {p.stock ?? 0}</span>
                        <ProductActions p={p} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
          {!error && data && products.length > 0 && view === "list" && (
            <div className={cn("overflow-x-auto", loading && "opacity-60")}>
              <table className="w-full text-sm" data-testid="product-table">
                <thead className="sticky top-0 z-10 erp-surface-2"><tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                  <th className="px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all on this page" className="h-3.5 w-3.5 accent-primary-500" /></th>
                  <th className="px-3 py-2">Image</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Subcategory</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Stock</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {products.map((p) => {
                    const ps = PRODUCT_STATUS[p.status];
                    return (
                      <tr key={p.id} className={cn("border-b erp-border-soft last:border-0 erp-hover", selected.has(p.id) && "bg-primary-50/60 dark:bg-primary-500/5")}>
                        <td className="px-3 py-2"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.name}`} className="h-3.5 w-3.5 accent-primary-500" /></td>
                        <td className="px-3 py-2"><span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md erp-surface-2"><MediaThumb src={p.images?.[0] ?? p.imageEmoji} imgClass="h-full w-full object-cover" textClass="text-lg" /></span></td>
                        <td className="max-w-56 truncate px-3 py-2 font-semibold erp-text" title={p.name}>{p.name}</td>
                        <td className="px-3 py-2 font-mono text-xs erp-text-muted">{p.sku}</td>
                        <td className="px-3 py-2 erp-text-muted">{p.category}</td>
                        <td className="px-3 py-2 erp-text-muted">{p.subcategory === "General" ? "—" : p.subcategory}</td>
                        <td className="whitespace-nowrap px-3 py-2 erp-text">{priceLabel(p.basePrice)}</td>
                        <td className="px-3 py-2 erp-text">{p.stock ?? 0}</td>
                        <td className="px-3 py-2"><Badge tone={ps.tone}>{ps.label}</Badge></td>
                        <td className="px-3 py-2"><div className="flex justify-end"><ProductActions p={p} /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination: ← Previous 1 2 3 … Next → */}
        {data && total > 0 && (
          <nav className="flex flex-wrap items-center justify-between gap-3 border-t erp-border px-4 py-3" aria-label="Pagination">
            <p className="text-xs erp-text-muted">Products <span className="font-semibold erp-text">{from}–{to}</span> of <span className="font-semibold erp-text">{total}</span></p>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) }, false)}>Previous</Button>
              {pageNumbers(page, pages).map((n, i) => n === "…"
                ? <span key={`e${i}`} className="px-1 text-xs erp-text-faint">…</span>
                : <button key={n} type="button" onClick={() => setParam({ page: n === 1 ? null : String(n) }, false)} aria-current={n === page ? "page" : undefined} className={cn("h-8 min-w-8 rounded-md px-2 text-xs font-semibold", n === page ? "bg-primary-500 text-white" : "erp-text-muted hover:erp-surface-2")}>{n}</button>)}
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setParam({ page: String(page + 1) }, false)}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </nav>
        )}
      </Panel>

      {category && !isSub && category.subcategories.length > 0 && (
        <p className="text-xs erp-text-faint">Open a subcategory directly: {category.subcategories.map((s, i) => <span key={s.id}>{i > 0 && " · "}<Link to={`/admin/catalog/categories/${s.id}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">{s.name}</Link></span>)}</p>
      )}

      <ProductFormDrawer product={form?.product ?? null} open={!!form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void refresh(); }} />

      <Dialog
        open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.action === "delete" ? `Delete ${confirm.ids.length} product${confirm.ids.length === 1 ? "" : "s"}?` : `Archive ${confirm?.ids.length ?? 0} product${confirm?.ids.length === 1 ? "" : "s"}?`}
        description={confirm?.action === "delete"
          ? "Deleted products disappear from the catalog and the storefront. Order history and images are kept (soft delete)."
          : "Archived products are hidden from the storefront and active lists. All data is kept and they can be unarchived anytime."}
        footer={<>
          <Button onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
          {confirm?.action === "delete"
            ? <Button variant="danger" icon={Trash2} loading={busy} onClick={() => void bulkDelete(confirm.ids)}>Delete</Button>
            : <Button variant="primary" icon={Archive} loading={busy} onClick={() => confirm && bulkStatus(confirm.ids, "archived").then(() => setConfirm(null))}>Archive</Button>}
        </>}
      />
    </div>
  );
}
