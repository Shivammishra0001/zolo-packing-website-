import { CampaignStrip } from "@/components/marketing/campaigns";
import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  LayoutGrid,
  LayoutList,
  Search,
} from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { useCategoryTree, productMatchesCategory, productMatchesSubcategory, findCategoryNodes, mainCategories } from "../lib/categories";
import { ProductCard } from "../components/NewProductCard";
import { SectionHeader, Chip } from "../components/UI";

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
  const [grid, setGrid] = useState<3 | 4>(4);
  const [showFilters, setShowFilters] = useState(false);

  // Unified product source: admin catalog store (includes manual + bulk-imported
  // products, active + visible only), backed by the live :5001 API. Same source
  // the admin catalog uses — single source of truth.
  const productsList = useBuyerProducts();
  // Categories are derived from the products themselves — no hardcoded list to
  // drift out of sync with the catalog after an import.
  const CATEGORIES = useCategoryTree(productsList);

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

  return (
    <main className="py-10">
      <div className="shell">
        {/* Admin-managed promotion (Marketing → Campaigns → Product Listing). */}
        <CampaignStrip placement="product_listing" className="mb-6" />
        {/* Breadcrumb */}
        <div className="mb-6 text-xs text-dark-500">
          <span>Home</span> <span className="mx-2">/</span>
          <span className="text-dark-700 font-medium">
            {activeCategory ? activeCategory.name : "All Products"}
          </span>
          {subcategory && (
            <>
              <span className="mx-2">/</span>
              <span className="text-dark-900 font-semibold capitalize">{subLabel}</span>
            </>
          )}
        </div>

        {/* Mobile category selector — horizontal scroll, always visible.
            The desktop sidebar is hidden on small screens, so without this
            there is no way to browse categories on a phone. */}
        <div className="lg:hidden -mx-4 mb-5 px-4">
          <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none}">
            <button
              onClick={() => updateCategory("")}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
                category === "" ? "bg-dark-900 text-white border-dark-900" : "bg-white text-dark-600 border-dark-200"
              }`}
            >
              All ({productsList.length})
            </button>
            {mainCategories(CATEGORIES).map((c) => (
              <button
                key={c.slug}
                onClick={() => updateCategory(c.slug === category ? "" : c.slug)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors whitespace-nowrap ${
                  category === c.slug ? "bg-dark-900 text-white border-dark-900" : "bg-white text-dark-600 border-dark-200"
                }`}
              >
                {c.icon} {c.name} ({c.count})
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
          <SectionHeader
            eyebrow={activeCategory ? "Category" : "Catalog"}
            title={
              activeCategory ? (
                <>{activeCategory.name}</>
              ) : (
                <>All <span className="grad-text">packaging</span> products</>
              )
            }
            subtitle={
              activeCategory
                ? `${activeCategory.count} products in this category.`
                : `Browse ${productsList.length}+ premium packaging products.`
            }
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGrid(3)}
              className={`p-2 rounded-lg ${grid === 3 ? "bg-dark-100 text-dark-900" : "text-dark-400"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setGrid(4)}
              className={`p-2 rounded-lg ${grid === 4 ? "bg-dark-100 text-dark-900" : "text-dark-400"}`}
            >
              <LayoutList className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <aside className={`space-y-6 ${showFilters ? "block" : "hidden lg:block"}`}>
            <div className="bg-white rounded-2xl border border-dark-100 p-5 card-shadow sticky top-20">
              <div className="flex items-center justify-between mb-4">
                <div className="font-display font-bold text-dark-900">Filters</div>
                <button onClick={clearAllFilters} className="text-xs text-primary-500 font-semibold hover:underline">
                  Clear all
                </button>
              </div>

              {/* Search */}
              <div className="relative mb-5">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dark-400" />
                <input
                  value={search}
                  onChange={(e) => updateSearch(e.target.value)}
                  placeholder="Search products..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-dark-200 text-sm focus:border-primary-500 outline-none"
                />
              </div>

              {/* Categories */}
              <div className="mb-5">
                <div className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-3">Category</div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => updateCategory("")}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm ${
                      category === "" ? "bg-dark-50 font-semibold text-dark-900" : "text-dark-600 hover:bg-dark-50"
                    }`}
                  >
                    <span>All categories</span>
                    <span className="text-xs text-dark-400">{productsList.length}</span>
                  </button>
                  {/* MAIN category filter: top-level categories only (parentId
                      null in the database). Subcategories are never listed here
                      as independent options — picking "Boxes" already includes
                      every product in its subcategories, because each product
                      carries its parent categoryId. Subcategories still exist
                      in Admin, the importer, the Categories page and product
                      breadcrumbs. */}
                  {mainCategories(CATEGORIES).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => updateCategory(c.id === category ? "" : c.id)}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm ${
                        category === c.id ? "bg-dark-50 font-semibold text-dark-900" : "text-dark-600 hover:bg-dark-50"
                      }`}
                    >
                      <span className="line-clamp-1">{c.name}</span>
                      <span className="text-xs text-dark-400">{c.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Material */}
              <div className="mb-5">
                <div className="text-xs font-bold uppercase tracking-wider text-dark-500 mb-3">Material</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {allMaterials.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMaterial(material === m ? "" : m)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-sm ${
                        material === m ? "bg-dark-50 font-semibold text-dark-900" : "text-dark-600 hover:bg-dark-50"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rating facet removed — no real review data exists yet, so a
                  star filter over a fabricated constant score filtered nothing
                  honestly. It returns when reviews are live. */}
            </div>
          </aside>

          {/* Main listing */}
          <div>
            {/* Sort bar */}
            <div className="bg-white rounded-2xl border border-dark-100 p-3 mb-5 flex items-center justify-between gap-3 flex-wrap card-shadow">
              <div className="flex items-center gap-2 text-sm text-dark-600">
                <span className="font-semibold text-dark-900">{filtered.length}</span> products
                {category && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-dark-100 text-xs font-medium">
                    {activeCategory?.name}
                    <button onClick={() => updateCategory("")} className="hover:text-primary-500">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {subcategory && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-xs font-medium capitalize">
                    {subLabel}
                    <button onClick={() => updateSubcategory("")} className="hover:text-primary-500" aria-label="Clear subcategory"><X className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dark-200 text-sm font-medium"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
                </button>
                <div className="relative">
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="appearance-none pl-3 pr-9 py-1.5 rounded-lg border border-dark-200 text-sm font-medium focus:border-primary-500 outline-none bg-white"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-dark-400" />
                </div>
              </div>
            </div>

            {/* Active filter chips */}
            {material && (
              <div className="flex flex-wrap gap-2 mb-5">
                <Chip active onClick={() => setMaterial("")}>
                  {material} <X className="h-3 w-3 inline ml-1" />
                </Chip>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dark-100 p-16 text-center card-shadow">
                <div className="text-5xl mb-4">🔍</div>
                <div className="font-display text-xl font-bold text-dark-900 mb-2">No products found</div>
                <div className="text-dark-500 text-sm">Try adjusting your filters or search terms.</div>
              </div>
            ) : (
              <div className={grid === 3 ? "grid-cards-lg" : "grid-cards"}>
                {filtered.map((p, i) => (
                  <ProductCard key={p.id} product={p} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
