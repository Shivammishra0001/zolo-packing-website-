export type ProductColor = { name: string; hex: string };

export type Product = {
  id: string;
  name: string;
  slug: string;
  category: string;
  subcategory?: string;
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
  name: string;
  slug: string;
  count: number;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  icon: string; // emoji
  count: number;
  subcategories: SubCategory[];
};

// This module now carries TYPES only. The demo data arrays that used to live
// here (PRODUCTS, CATEGORIES, TESTIMONIALS, BRANDS) are gone: products and
// categories come from the real API via src/admin/catalog-store.ts and
// src/lib/categories.ts, and marketing content is never hardcoded.
