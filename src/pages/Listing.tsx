import { CampaignStrip } from "@/components/marketing/campaigns";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal, X, LayoutGrid, LayoutList, Search } from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { isCatalogHydrated } from "../admin/catalog-store";
import { useCategoryTree, productMatchesCategory, productMatchesSubcategory, findCategoryNodes, mainCategories } from "../lib/categories";
import { ProductCard } from "../components/NewProductCard";
import { Breadcrumb, Button, EmptyState, Select, SkeletonGrid, cx } from "../components/UI";

const SORT_OPTIONS = [
  { value: "popular", label: "Featured" },
  { value: "latest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "name-asc", label: "Name: A–Z" },
  { value: "name-desc", label: "Name: Z–A" },
  // "Best Rated" removed: there is no real review data yet, and ranking by a
  // fabricated constant rating was meaningless.
];

/** Radio-style filter row: label + count, green when selected. */
function FilterRow({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150",
        active ? "bg-green-100 font-semibold text-green-700" : "text-dark-600 hover:bg-dark-50 hover:text-dark-900",
      )}
    >
      <span className="line-clamp-1">{children}</span>
      {count != null && <span className={cx("shrink-0 text-xs tabular-nums", active ? "text-green-600" : "text-dark-400")}>{count}</span>}
    </button>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-dark-100 pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-dark-500">{title}</div>
      {children}
    </div>
  );
}

export default function Listing() {
  const [params, setParams] = useSearchParams();
  const catParam = params.get("category") || "";
  const subcatParam = params.get("subcategory") || "";
  const sortParam = params.get("sort") || "popular";

  const [category, setCategory] = useState(catParam);
  const [subcategory, setSubcategory] = useState(subcatParam);
  const [sort, setSort] = useState(sortParam);
  const [search, setSearch] = useState(params.get("search") || "");
  const [material, setMaterial] = useState<string>("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = useState(false);

  // Unified product source: admin catalog store (includes manual + bulk-imported
  // products, active + visible only), backed by the live :5001 API. Same source
  // the admin catalog uses — single source of truth.
  const productsList = useBuyerProducts();
  // Categories are derived from the products themselves — no hardcoded list to
  // drift out of sync with the catalog after an import.
  const CATEGORIES = useCategoryTree(productsList);
  // First fetch still in flight → skeletons instead of a false "no products".
  const loading = !isCatalogHydrated() && productsList.length === 0;

  useEffect(() => {
    setSearch(params.get("search") || "");
  }, [params]);

  useEffect(() => {
    const cat = params.get("category") || "";
    setCategory(cat);
  }, [params]);

  useEffect(() => {
    setSubcategory(params.get("subcategory") || "");
  }, [params]);

  // Lock page scroll while the mobile filter sheet is open.
  useEffect(() => {
    if (!showFilters) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [showFilters]);

  const updateSearch = (val: string) => {
    setSearch(val);
    const nextParams = new URLSearchParams(params.toString());
    if (val.trim()) nextParams.set("search", val.trim());
    else nextParams.delete("search");
    setParams(nextParams);
  };

  const updateCategory = (val: string) => {
    setCategory(val);
    setSubcategory("");
    const nextParams = new URLSearchParams(params.toString());
    if (val) {
      nextParams.set("category", val);
      nextParams.delete("subcategory");
    } else {
      nextParams.delete("category");
      nextParams.delete("subcategory");
    }
    setParams(nextParams);
  };

  /** Subcategory drill-down; keeps the parent category in the URL. */
  const updateSubcategory = (val: string) => {
    setSubcategory(val);
    const nextParams = new URLSearchParams(params.toString());
    if (val) nextParams.set("subcategory", val);
    else nextParams.delete("subcategory");
    setParams(nextParams);
  };

  const clearAllFilters = () => {
    setCategory("");
    setSubcategory("");
    setMaterial("");
    setSearch("");
    setParams({});
  };

  const allMaterials = useMemo(
    () => Array.from(new Set(productsList.flatMap((p) => p.materials))).slice(0, 10),
    [productsList],
  );

  const filtered = useMemo(() => {
    let list = [...productsList];
    // Category / subcategory filters resolve through the admin-managed tree
    // (match by Category id), so renamed or re-slugged categories keep working.
    if (category) list = list.filter((p) => productMatchesCategory(p, category, CATEGORIES));
    if (subcategory) list = list.filter((p) => productMatchesSubcategory(p, category, subcategory, CATEGORIES));
    if (search) {
      // Search spans name, SKU, category, subcategory and description so
      // "box", "tape" and "ZOLO-TAP-001" all find their products.
      const q = search.toLowerCase().trim();
      list = list.filter((p) =>
        [p.name, p.sku, p.tags?.[0], p.subcategory, p.description]
          .some((f) => String(f ?? "").toLowerCase().includes(q)),
      );
    }
    if (material) list = list.filter((p) => p.materials.includes(material));

    switch (sort) {
      case "latest": list.sort((a, b) => productsList.indexOf(b) - productsList.indexOf(a)); break;
      // Quotation-based products (priceMinor 0) sort last on price-ascending
      // rather than pretending to be the cheapest items in the catalog.
      case "price-asc": list.sort((a, b) => (a.priceMinor || Infinity) - (b.priceMinor || Infinity)); break;
      case "price-desc": list.sort((a, b) => b.priceMinor - a.priceMinor); break;
      case "name-asc": list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": list.sort((a, b) => b.name.localeCompare(a.name)); break;
      // "Featured" keeps catalog order — no fake popularity signal exists.
      case "popular": default: break;
    }
    return list;
  }, [productsList, category, subcategory, search, material, sort, CATEGORIES]);

  const { category: activeCategory, subcategory: activeSub } = findCategoryNodes(CATEGORIES, category, subcategory);
  const subLabel = activeSub?.name ?? subcategory.replace(/-/g, " ");
  const hasActiveFilters = Boolean(category || subcategory || material || search);
  const pageTitle = activeSub ? subLabel : activeCategory ? activeCategory.name : "All products";

  const breadcrumbItems = [
    { label: "Home", to: "/" },
    ...(activeCategory || subcategory
      ? [{ label: "Products", to: "/products" }, { label: activeCategory ? activeCategory.name : "All Products", to: `/products?category=${category}` }]
      : [{ label: "Products" }]),
    ...(subcategory ? [{ label: subLabel }] : []),
  ];

  /* Shared filter content — rendered in the desktop sidebar AND the mobile
     sheet so both always offer exactly the same options. */
  const filterContent = (
    <div className="space-y-4">
      <FilterSection title="Category">
        <div role="radiogroup" aria-label="Category" className="space-y-0.5">
          <FilterRow active={category === ""} onClick={() => updateCategory("")} count={productsList.length}>
            All categories
          </FilterRow>
          {/* MAIN category filter: top-level categories only (parentId null in
              the database). Subcategories are never listed here as independent
              options — picking "Boxes" already includes every product in its
              subcategories, because each product carries its parent categoryId.
              Subcategories still exist in Admin, the importer, the Categories
              page and product breadcrumbs. */}
          {mainCategories(CATEGORIES).map((c) => (
            <FilterRow key={c.id} active={category === c.id} onClick={() => updateCategory(c.id === category ? "" : c.id)} count={c.count}>
              {c.name}
            </FilterRow>
          ))}
        </div>
      </FilterSection>

      {allMaterials.length > 0 && (
        <FilterSection title="Material">
          <div role="radiogroup" aria-label="Material" className="space-y-0.5">
            <FilterRow active={material === ""} onClick={() => setMaterial("")}>Any material</FilterRow>
            {allMaterials.map((m) => (
              <FilterRow key={m} active={material === m} onClick={() => setMaterial(material === m ? "" : m)}>
                {m}
              </FilterRow>
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection title="Sort">
        <div role="radiogroup" aria-label="Sort" className="space-y-0.5">
          {SORT_OPTIONS.map((o) => (
            <FilterRow key={o.value} active={sort === o.value} onClick={() => setSort(o.value)}>
              {o.label}
            </FilterRow>
          ))}
        </div>
      </FilterSection>

      {/* Rating facet removed — no real review data exists yet, so a star
          filter over a fabricated constant score filtered nothing honestly.
          It returns when reviews are live. */}
    </div>
  );

  const activeChips: { key: string; label: string; onClear: () => void }[] = [
    ...(activeCategory ? [{ key: "category", label: activeCategory.name, onClear: () => updateCategory("") }] : []),
    ...(subcategory ? [{ key: "subcategory", label: subLabel, onClear: () => updateSubcategory("") }] : []),
    ...(material ? [{ key: "material", label: material, onClear: () => setMaterial("") }] : []),
    ...(search ? [{ key: "search", label: `“${search}”`, onClear: () => updateSearch("") }] : []),
  ];

  return (
    <main className="section-sm">
      <div className="shell">
        {/* Admin-managed promotion (Marketing → Campaigns → Product Listing). */}
        <CampaignStrip placement="product_listing" className="mb-6" />

        <Breadcrumb items={breadcrumbItems} className="mb-4" />

        {/* Title row */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h1 className="h2 text-dark-900 capitalize">{pageTitle}</h1>
          <p className="text-sm text-dark-500" aria-live="polite">
            {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "product" : "products"}`}
          </p>
        </div>

        {/* Toolbar */}
        <div className="card-flat mt-4 flex flex-wrap items-center gap-2 p-3 sm:gap-3">
          <label className="relative min-w-0 flex-1 basis-full sm:basis-auto">
            <span className="sr-only">Search products</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => updateSearch(e.target.value)}
              placeholder="Search products, SKUs…"
              className="input pl-9"
            />
          </label>

          <div className="flex flex-1 items-center gap-2 sm:flex-none">
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="btn btn-outline btn-sm lg:hidden"
              aria-haspopup="dialog"
              aria-expanded={showFilters}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters
              {activeChips.length > 0 && <span className="badge bg-green-500 text-white">{activeChips.length}</span>}
            </button>

            <label className="min-w-0 flex-1 sm:w-48 sm:flex-none">
              <span className="sr-only">Sort products</span>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-[2.375rem] py-1.5 text-sm">
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </label>

            <div className="hidden items-center rounded-lg border border-dark-200 p-0.5 sm:flex" role="group" aria-label="Layout">
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-pressed={view === "grid"}
                aria-label="Grid view"
                className={cx("flex h-8 w-8 items-center justify-center rounded-md transition-colors", view === "grid" ? "bg-green-100 text-green-700" : "text-dark-400 hover:text-dark-900")}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                aria-label="Larger cards"
                className={cx("flex h-8 w-8 items-center justify-center rounded-md transition-colors", view === "list" ? "bg-green-100 text-green-700" : "text-dark-400 hover:text-dark-900")}
              >
                <LayoutList className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr] lg:gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block">
            <div className="card sticky top-24 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="font-display font-bold text-dark-900">Filters</div>
                {hasActiveFilters && (
                  <button type="button" onClick={clearAllFilters} className="text-xs font-semibold text-green-600 hover:underline">
                    Clear all
                  </button>
                )}
              </div>
              {filterContent}
            </div>
          </aside>

          {/* Results */}
          <div className="min-w-0">
            {activeChips.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onClear}
                    className="chip chip-active h-8 px-3 text-xs capitalize"
                    aria-label={`Clear ${chip.key} filter: ${chip.label}`}
                  >
                    {chip.label} <X className="h-3 w-3" aria-hidden />
                  </button>
                ))}
                <button type="button" onClick={clearAllFilters} className="text-xs font-semibold text-dark-500 hover:text-dark-900">
                  Clear all
                </button>
              </div>
            )}

            {loading ? (
              <SkeletonGrid />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No products match your filters."
                message="Try a different category, material or search term."
                action={<Button variant="outline" onClick={clearAllFilters}>Clear filters</Button>}
              />
            ) : (
              <div className={view === "list" ? "grid-cards-lg" : "grid-cards"}>
                {filtered.map((p, i) => (
                  <ProductCard key={p.id} product={p} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter sheet */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            key="filter-sheet"
            className="fixed inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <button
              type="button"
              aria-label="Close filters"
              onClick={() => setShowFilters(false)}
              className="absolute inset-0 h-full w-full bg-navy-950/50"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-[16px] bg-white"
            >
              <div className="flex items-center justify-between border-b border-dark-100 px-4 py-3">
                <div className="font-display font-bold text-dark-900">Filters</div>
                <div className="flex items-center gap-3">
                  {hasActiveFilters && (
                    <button type="button" onClick={clearAllFilters} className="text-xs font-semibold text-green-600 hover:underline">
                      Clear all
                    </button>
                  )}
                  <button type="button" onClick={() => setShowFilters(false)} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-dark-500 hover:bg-dark-50">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{filterContent}</div>
              <div className="border-t border-dark-100 p-4">
                <Button className="w-full" onClick={() => setShowFilters(false)}>
                  Show {filtered.length} {filtered.length === 1 ? "product" : "products"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
