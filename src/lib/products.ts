import { useMemo } from "react";
import { useCatalog, getProduct as getCatalogProductById } from "@/admin/catalog-store";
import type { CatalogProduct } from "@/admin/types";
import type { Product } from "@/data/products";

// ============================================================
// Unified product source for the BUYER website.
//
// Admin catalog (catalog-store) is the SINGLE source of truth. This adapter
// maps CatalogProduct → the storefront `Product` shape the buyer UI consumes,
// so Admin edits / bulk imports appear on Home, Listing, Details, Cart.
//
// There is NO hardcoded demo-product fallback: if the catalog is empty the
// storefront shows an empty / not-found state, never fake products.
//
// TODO(backend): when the product API exists, catalog-store becomes a cache of
// GET /api/products and this adapter is unchanged.
// ============================================================

const CATEGORY_SLUG: Record<string, string> = {
  "Mailer Boxes": "mailer",
  "Rigid Boxes": "rigid",
  "Folding Cartons": "cartons",
  "Corrugated Shippers": "shipping",
  "Flexible Pouches": "pouches",
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** True when a product should appear on the buyer website. */
export function isBuyerVisible(p: CatalogProduct): boolean {
  // Only ACTIVE products are visible. Out-of-stock ACTIVE products stay visible
  // (shown as unavailable); DRAFT and ARCHIVED are hidden.
  return p.status === "active";
}

/** Map an admin CatalogProduct to the storefront Product shape. */
export function toStoreProduct(p: CatalogProduct): Product & {
  /** carried through so the buyer UI can gate Add-to-Cart / Buy-Now */
  sku: string;
  stockStatus: CatalogProduct["stockStatus"];
  priceMinor: number;
} {
  const images = p.images && p.images.length ? p.images : [p.imageEmoji];
  const dims = p.dimensions;
  const inStock = (p.stock ?? 0) > 0 && p.stockStatus !== "out_of_stock";
  return {
    id: p.id,
    name: p.name,
    slug: p.slug ?? slugify(p.name),
    category: CATEGORY_SLUG[p.category] ?? slugify(p.category),
    subcategory: p.subcategory,
    moq: p.moq,
    unit: "pcs",
    image: images[0],
    emoji: images[0],
    accent: "#f97316",
    description: p.description ?? `${p.name} — premium custom packaging.`,
    shortDesc: p.description?.slice(0, 80) ?? p.name,
    sizes: dims ? [`${dims.length}×${dims.width}×${dims.height} ${dims.unit}`] : ["Standard"],
    materials: [p.color ?? "Kraft", ...(p.gsm ? [`${p.gsm} GSM`] : [])],
    rating: 4.6,
    reviews: 24,
    tags: [p.category],
    bestseller: p.basePrice >= 40,
    newArrival: false,
    inStock,
    features: [
      dims ? `Dimensions ${dims.length}×${dims.width}×${dims.height} ${dims.unit}` : "Custom sizing",
      p.gsm ? `${p.gsm} GSM board` : "Premium board",
      p.color ? `Colour: ${p.color}` : "Custom colours",
      `MOQ ${p.moq.toLocaleString("en-IN")}`,
    ],
    // extras
    sku: p.sku,
    stockStatus: p.stockStatus,
    priceMinor: Math.round(p.basePrice * 100),
  };
}

export type StoreProduct = ReturnType<typeof toStoreProduct>;

/** Reactive buyer-visible product list (from the unified catalog store). */
export function useBuyerProducts(): StoreProduct[] {
  const all = useCatalog();
  return useMemo(() => all.filter(isBuyerVisible).map(toStoreProduct), [all]);
}

/** Reactive lookup by slug. Returns undefined when no real product matches
 *  (the caller shows a "not found" state — never a hardcoded demo product). */
export function useBuyerProductBySlug(slug: string | undefined): StoreProduct | undefined {
  const products = useBuyerProducts();
  return useMemo(() => {
    if (!slug) return undefined;
    return products.find((p) => p.slug === slug);
  }, [products, slug]);
}

/** Non-reactive snapshot by id — for cart/event handlers. */
export function getStoreProduct(id: string): StoreProduct | undefined {
  const p = getCatalogProductById(id);
  return p ? toStoreProduct(p) : undefined;
}
