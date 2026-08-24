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
  rating: number;
  reviews: number;
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

// ---------- Category data ----------
// Demo/sample categories removed. Categories now come from real data; empty
// until real categories are added. Consumers (.find/.filter/.map) handle empty.
export const CATEGORIES: Category[] = [];

// ---------- Product data ----------
// Demo/sample products removed permanently. The storefront reads real
// products from the shared catalog store (src/admin/catalog-store.ts),
// which hydrates from the product API when available. No hardcoded products.
export const PRODUCTS: Product[] = [];

// Marketing reference content removed (was demo). Empty until real content exists.
export const TESTIMONIALS: { name: string; role: string; quote: string; avatar: string; rating: number }[] = [];

export const BRANDS: string[] = [];
