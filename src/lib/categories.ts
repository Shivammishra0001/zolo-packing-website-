import { useCallback, useMemo, useSyncExternalStore } from "react";
import { API_BASE } from "./api-config";
import type { Category, SubCategory } from "@/data/products";
import type { StoreProduct } from "./products";

// ============================================================
// Storefront category tree — DERIVED FROM REAL PRODUCTS.
//
// `CATEGORIES` in src/data/products.ts is a permanently empty array (the demo
// data was removed), so the Listing sidebar rendered nothing and every
// category filter silently failed. Rather than reintroduce a hardcoded list —
// which would drift from the catalog the moment an import ran — the tree is
// computed from the products the API actually returns.
//
// Grouping uses each product's own `category` / `subcategory` columns, which
// the importer already normalizes and links to the Category table. Nothing is
// invented and no product is reassigned.
// ============================================================

/** URL-safe slug; must match the slug the Listing/route params use. */
export const slugifyCategory = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Emoji per category. Presentation only — it never affects grouping, and an
 * unlisted category simply falls back to the generic package icon.
 */
const CATEGORY_ICON: Record<string, string> = {
  boxes: "📦",
  containers: "🫙",
  "food packaging": "🍱",
  tapes: "🎗️",
  tubes: "🧴",
  mailers: "✉️",
  bags: "🛍️",
  "flexible packaging": "🧃",
  "packaging accessories": "🏷️",
  drinkware: "☕",
  packaging: "📦",
  "digital files": "🖼️",
};

const iconFor = (name: string): string => CATEGORY_ICON[name.trim().toLowerCase()] ?? "📦";

/**
 * Build the category tree from a product list.
 *
 * Categories and subcategories are keyed case-insensitively so "Boxes",
 * "boxes" and " BOXES " collapse into one node, matching how the backend
 * importer resolves them. Counts are real product counts — never hardcoded.
 */
// ---- Canonical tree (server) ----------------------------------------------

interface ApiSub { id: string; name: string; slug: string; productCount: number }
interface ApiCategory { id: string; name: string; slug: string; productCount: number; subcategories: ApiSub[] }

let canonicalTree: Category[] = [];
let canonicalLoaded = false;
let canonicalInFlight: Promise<void> | null = null;
const canonicalListeners = new Set<() => void>();

/** Fetch the canonical tree. `force` refetches after an import. */
export async function hydrateCategoryTree(force = false): Promise<void> {
  if (canonicalLoaded && !force) return;
  if (canonicalInFlight) return canonicalInFlight;
  canonicalInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      const body = await res.json();
      const tree: ApiCategory[] | undefined = body?.data?.tree;
      if (body?.success && Array.isArray(tree)) {
        canonicalTree = tree
          // Only surface categories that actually have shoppable products.
          .filter((c) => c.productCount > 0)
          .map((c) => ({
            id: c.slug,
            name: c.name,
            slug: c.slug,
            icon: iconFor(c.name),
            count: c.productCount,
            subcategories: c.subcategories
              .filter((s) => s.productCount > 0)
              .map((s) => ({ name: s.name, slug: slugifyCategory(s.name), count: s.productCount })),
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
        .map((s): SubCategory => ({ name: s.name, slug: slugifyCategory(s.name), count: s.count }))
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
 * Does a product belong to `categorySlug`?
 *
 * Accepts a category slug OR a subcategory slug, so /products?category=cans
 * works even though "Metal Cans" is a subcategory of Containers — the
 * customer-facing names in the brief live at both levels of the real taxonomy.
 */
export function productMatchesCategory(p: StoreProduct, categorySlug: string): boolean {
  if (!categorySlug) return true;
  const cat = slugifyCategory(p.tags?.[0] ?? "");
  const sub = slugifyCategory(p.subcategory ?? "");
  return cat === categorySlug || sub === categorySlug;
}
