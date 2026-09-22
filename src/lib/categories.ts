import { useCallback, useMemo, useSyncExternalStore } from "react";
import { API_BASE } from "./api-config";
import type { Category, SubCategory } from "@/data/products";
import type { StoreProduct } from "./products";

// ============================================================
// Storefront category tree.
//
// The CANONICAL tree comes from GET /api/v1/categories: the rows the admin
// manages under Product Catalog → Categories, already filtered to active +
// non-archived and sorted by the admin's display order. Nothing about the
// taxonomy is written in code — names, slugs, order, images and visibility all
// come from PostgreSQL.
//
// Until that request resolves (or if the API is unreachable) a fallback tree
// is DERIVED from the products already on screen, so the nav is never empty on
// first paint. Grouping uses each product's own category / subcategory columns.
// ============================================================

/** URL-safe slug; must match the slug the Listing/route params use. */
export const slugifyCategory = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Emoji slot kept for the Category type; the storefront renders images now. */
const iconFor = (_name: string): string => "";

/**
 * A subcategory's short URL slug: its DB slug without the parent prefix
 * ("boxes-gift-boxes" under "boxes" → "gift-boxes"), so category pages read
 * /category/boxes/gift-boxes. Admin-edited slugs without the prefix pass through.
 */
export const subPathSlug = (parentSlug: string, slug: string): string =>
  slug.startsWith(`${parentSlug}-`) ? slug.slice(parentSlug.length + 1) : slug;

/**
 * Build the category tree from a product list.
 *
 * Categories and subcategories are keyed case-insensitively so "Boxes",
 * "boxes" and " BOXES " collapse into one node, matching how the backend
 * importer resolves them. Counts are real product counts — never hardcoded.
 */
// ---- Canonical tree (server) ----------------------------------------------

interface ApiSub { id: string; name: string; slug: string; productCount: number; image?: string | null }
interface ApiCategory {
  id: string; name: string; slug: string; description?: string | null; productCount: number;
  image?: string | null; imageSource?: "uploaded" | "product" | null; subcategories: ApiSub[];
}

let canonicalTree: Category[] = [];
let canonicalLoaded = false;
let canonicalInFlight: Promise<void> | null = null;
const canonicalListeners = new Set<() => void>();

/** Fetch the canonical tree. `force` refetches (after an admin change / on focus). */
export async function hydrateCategoryTree(force = false): Promise<void> {
  if (canonicalLoaded && !force) return;
  if (canonicalInFlight) return canonicalInFlight;
  canonicalInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      const body = await res.json();
      const tree: ApiCategory[] | undefined = body?.data?.tree;
      if (body?.success && Array.isArray(tree)) {
        // Server order = the admin's display order. Active rows only (the
        // server already excludes inactive/archived ones).
        canonicalTree = tree.map((c) => ({
          id: c.slug,
          dbId: c.id,
          name: c.name,
          slug: c.slug,
          icon: iconFor(c.name),
          count: c.productCount,
          description: c.description ?? null,
          image: c.image ?? null,
          imageSource: c.imageSource ?? null,
          subcategories: c.subcategories.map((s) => ({
            id: s.id, name: s.name, slug: s.slug, pathSlug: subPathSlug(c.slug, s.slug), count: s.productCount, image: s.image ?? null,
          })),
        }));
        canonicalLoaded = true;
        canonicalListeners.forEach((l) => l());
      }
    } catch {
      /* offline → the derived fallback below still renders something */
    } finally {
      canonicalInFlight = null;
    }
  })();
  return canonicalInFlight;
}

// Admin changes reach open storefront tabs without a rebuild: refetch when the
// tab regains focus (cheap, and the server marks the response no-store).
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => { if (canonicalLoaded) void hydrateCategoryTree(true); });
}

function useCanonicalCategories(): Category[] {
  const subscribe = useCallback((fn: () => void) => {
    canonicalListeners.add(fn);
    void hydrateCategoryTree();
    return () => { canonicalListeners.delete(fn); };
  }, []);
  return useSyncExternalStore(subscribe, () => canonicalTree, () => canonicalTree);
}

export function buildCategoryTree(products: StoreProduct[]): Category[] {
  const byCategory = new Map<
    string,
    { name: string; count: number; subs: Map<string, { name: string; count: number }> }
  >();

  for (const p of products) {
    const rawCat = (p.tags?.[0] ?? "").trim() || "Other";
    const key = rawCat.toLowerCase();
    let node = byCategory.get(key);
    if (!node) {
      node = { name: rawCat, count: 0, subs: new Map() };
      byCategory.set(key, node);
    }
    node.count++;

    const rawSub = (p.subcategory ?? "").trim();
    // "General" is the importer's placeholder for "no subcategory given" — it
    // is not a real customer-facing grouping, so it never becomes a filter.
    if (rawSub && rawSub.toLowerCase() !== "general") {
      const subKey = rawSub.toLowerCase();
      const sub = node.subs.get(subKey);
      if (sub) sub.count++;
      else node.subs.set(subKey, { name: rawSub, count: 1 });
    }
  }

  return [...byCategory.values()]
    .map((node): Category => ({
      id: slugifyCategory(node.name),
      name: node.name,
      slug: slugifyCategory(node.name),
      icon: iconFor(node.name),
      count: node.count,
      subcategories: [...node.subs.values()]
        .map((s): SubCategory => ({ name: s.name, slug: slugifyCategory(s.name), pathSlug: slugifyCategory(s.name), count: s.count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    // Biggest categories first, so the busiest aisles lead the nav.
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Reactive category tree.
 *
 * Prefers the CANONICAL tree served by GET /api/v1/categories (the same rows
 * Admin and the importer use, with real DB product counts). Falls back to
 * deriving from the product list only until that request resolves, so the nav
 * is never empty on first paint.
 */
export function useCategoryTree(products: StoreProduct[]): Category[] {
  const canonical = useCanonicalCategories();
  const derived = useMemo(() => buildCategoryTree(products), [products]);
  return canonical.length > 0 ? canonical : derived;
}

/**
 * Resolve a category-page path to tree nodes. `sub` may be the short path slug
 * ("gift-boxes") or the full DB slug ("boxes-gift-boxes").
 */
/**
 * The MAIN customer-facing category list: top-level categories only, i.e.
 * rows whose parentId is null in the Category table (the tree endpoint nests
 * children under `subcategories`, so a top-level node is one that is not
 * itself a child). Never hardcoded names — a category the admin creates
 * tomorrow appears automatically; a subcategory never appears on its own.
 */
export function mainCategories(tree: Category[]): Category[] {
  return tree.filter((c) => !(c as Category & { parentId?: string | null }).parentId);
}

export function findCategoryNodes(tree: Category[], categorySlug: string, sub?: string): { category?: Category; subcategory?: SubCategory } {
  const category = tree.find((c) => c.slug === categorySlug || c.id === categorySlug)
    // A subcategory slug used at the top level still resolves to its parent.
    ?? tree.find((c) => c.subcategories.some((s) => s.slug === categorySlug || s.pathSlug === categorySlug));
  if (!category) return {};
  const wanted = sub || (category.slug !== categorySlug && category.id !== categorySlug ? categorySlug : "");
  const subcategory = wanted ? category.subcategories.find((s) => s.pathSlug === wanted || s.slug === wanted) : undefined;
  return { category, subcategory };
}

/**
 * Does a product belong to `categorySlug` (a category OR subcategory slug)?
 *
 * With the canonical tree the match is by Category table id — the product's
 * real categoryId / subcategoryId — so renamed or admin-edited slugs keep
 * working. Without it (derived fallback tree / offline) it falls back to the
 * product's own category names.
 */
export function productMatchesCategory(p: StoreProduct, categorySlug: string, tree: Category[] = canonicalTree): boolean {
  if (!categorySlug) return true;
  const { category, subcategory } = findCategoryNodes(tree, categorySlug);
  if (category?.dbId && (p.categoryId || p.subcategoryId)) {
    if (subcategory?.id) return p.subcategoryId === subcategory.id;
    return p.categoryId === category.dbId;
  }
  const cat = slugifyCategory(p.tags?.[0] ?? "");
  const sub = slugifyCategory(p.subcategory ?? "");
  return cat === categorySlug || sub === categorySlug || `${cat}-${sub}` === categorySlug;
}

/** Does a product belong to this subcategory (short or DB slug) within `categorySlug`? */
export function productMatchesSubcategory(p: StoreProduct, categorySlug: string, subSlug: string, tree: Category[] = canonicalTree): boolean {
  if (!subSlug) return true;
  const { subcategory } = findCategoryNodes(tree, categorySlug, subSlug);
  if (subcategory?.id && p.subcategoryId !== undefined) return p.subcategoryId === subcategory.id;
  return slugifyCategory(p.subcategory ?? "") === subSlug || slugifyCategory(p.subcategory ?? "") === subPathSlug(categorySlug, subSlug);
}
