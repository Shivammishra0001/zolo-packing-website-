export type ProductColor = { name: string; hex: string };

export type Product = {
  id: string;
  name: string;
  slug: string;
  category: string;
  subcategory?: string;
  /** Category table ids (null for legacy rows without a link). */
  categoryId?: string | null;
  subcategoryId?: string | null;
moq: number; // minimum order quantity
  unit: string;
  image: string; // gradient/emoji based
  emoji: string;
  accent: string;
  description: string;
  shortDesc: string;
sizes: string[];
  materials: string[];
  /** Only present when real review data exists — never fabricated. */
  rating?: number;
  reviews?: number;
  tags: string[];
  bestseller?: boolean;
  newArrival?: boolean;
  inStock: boolean;
  features: string[];
};

export type SubCategory = {
  /** Category table id (absent for the product-derived fallback tree). */
  id?: string;
  name: string;
  /** DB slug, globally unique (e.g. "boxes-gift-boxes"). */
  slug: string;
  /** Short slug used in URLs under the parent (e.g. "gift-boxes"). */
  pathSlug: string;
  count: number;
  image?: string | null;
};

export type Category = {
  /** Slug (the storefront's stable handle for URLs and filters). */
  id: string;
  /** Category table id (absent for the product-derived fallback tree). */
  dbId?: string;
  name: string;
  slug: string;
  icon: string; // legacy emoji slot, unused
  count: number;
  description?: string | null;
  /** Admin-uploaded image, else a representative product image, else null. */
  image?: string | null;
  /** Where `image` came from — "uploaded" images win over curated artwork. */
  imageSource?: "uploaded" | "product" | null;
  subcategories: SubCategory[];
};

// This module now carries TYPES only. The demo data arrays that used to live
// here (PRODUCTS, CATEGORIES, TESTIMONIALS, BRANDS) are gone: products and
// categories come from the real API via src/admin/catalog-store.ts and
// src/lib/categories.ts, and marketing content is never hardcoded.
