import type { CatalogProduct, ProductStatus, ProductVariant } from "@/admin/types";

// ============================================================
// Catalog API client — Express + Prisma + PostgreSQL (server/).
// Single mapping point between the DB row shape and CatalogProduct.
// Every write returns the DATABASE-SAVED record (not a local echo).
//
// Writes are admin-only on the server, so every request carries the
// signed-in session's bearer token (same storage key the storefront client
// uses) and transparently refreshes it once on a 401.
// ============================================================

export { API_BASE } from "./api-config";
import { API_BASE, describeNetworkError } from "./api-config";
import { refreshStoreSession } from "./auth/refresh";

const TOKEN_KEY = "zolo.store.accessToken";

interface DbProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  category: string;
  subcategory: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  status: ProductStatus;
  description: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimUnit: string | null;
  gsm: number | null;
  color: string | null;
  material?: string | null;
  productType?: string | null;
  thickness?: string | null;
  sizeLabel?: string | null;
  basePriceMinor: number;
  moq: number;
  stock: number;
  lowStockLevel: number | null;
  imageEmoji: string;
  images: string[];
  variants: unknown;
  isFeatured?: boolean;
  featuredOrder?: number | null;
  isNewArrival?: boolean;
  newArrivalOrder?: number | null;
  createdAt?: string;
  updatedAt: string;
}

export function fromDb(row: DbProduct): CatalogProduct {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    categoryId: row.categoryId ?? null,
    subcategoryId: row.subcategoryId ?? null,
    status: row.status,
    description: row.description ?? undefined,
    dimensions:
      row.length != null && row.width != null && row.height != null
        ? { length: row.length, width: row.width, height: row.height, unit: (row.dimUnit ?? "in") as "in" | "cm" | "mm" }
        : undefined,
    gsm: row.gsm ?? undefined,
    color: row.color ?? undefined,
    material: row.material ?? undefined,
    productType: row.productType ?? undefined,
    thickness: row.thickness ?? undefined,
    sizeLabel: row.sizeLabel ?? undefined,
    basePrice: row.basePriceMinor / 100,
    moq: row.moq,
    stock: row.stock,
    lowStockLevel: row.lowStockLevel ?? undefined,
    imageEmoji: row.imageEmoji,
    images: row.images.length ? row.images : [row.imageEmoji],
    variants: (Array.isArray(row.variants) ? row.variants : []) as ProductVariant[],
    isFeatured: row.isFeatured ?? false,
    featuredOrder: row.featuredOrder ?? null,
    isNewArrival: row.isNewArrival ?? false,
    newArrivalOrder: row.newArrivalOrder ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A real, persistent image URL (stored file) — never a browser preview or emoji. */
const isStoredUrl = (s: string) => /^(https?:\/\/|\/)/.test(s) && !/^(blob:|data:)/.test(s);

/**
 * Payload for POST /products and PUT /products/:id. Money is integer paise;
 * `images` is the ordered gallery of stored URLs and/or "upload:N" tokens that
 * reference `imageUploads[N]` (base64), so new files are stored in the same
 * transaction as the row.
 */
export interface ProductWriteInput {
  name?: string;
  sku?: string;
  categoryId?: string | null;
  category?: string | null;
  subcategoryId?: string | null;
  subcategory?: string | null;
  description?: string | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  dimUnit?: "in" | "cm" | "mm" | null;
  gsm?: number | null;
  color?: string | null;
  material?: string | null;
  productType?: string | null;
  thickness?: string | null;
  sizeLabel?: string | null;
  basePriceMinor?: number;
  moq?: number;
  stock?: number;
  lowStockLevel?: number | null;
  status?: ProductStatus;
  isFeatured?: boolean;
  featuredOrder?: number | null;
  isNewArrival?: boolean;
  newArrivalOrder?: number | null;
  images?: string[];
  imageUploads?: { name: string; mime: string; dataBase64: string }[];
  variants?: ProductVariant[];
}

/** Full-record payload used by the store's optimistic mutators (stock/status/archive). */
export function toDb(p: CatalogProduct): ProductWriteInput {
  const images = (p.images ?? []).filter(isStoredUrl);
  return {
    sku: p.sku,
    name: p.name,
    ...(p.categoryId ? { categoryId: p.categoryId } : { category: p.category }),
    ...(p.subcategoryId ? { subcategoryId: p.subcategoryId } : { subcategory: p.subcategory ?? "General" }),
    status: p.status,
    description: p.description ?? null,
    length: p.dimensions?.length ?? null,
    width: p.dimensions?.width ?? null,
    height: p.dimensions?.height ?? null,
    dimUnit: p.dimensions?.unit ?? null,
    gsm: p.gsm ?? null,
    color: p.color ?? null,
    material: p.material ?? null,
    productType: p.productType ?? null,
    thickness: p.thickness ?? null,
    sizeLabel: p.sizeLabel ?? null,
    basePriceMinor: Math.round((p.basePrice ?? 0) * 100),
    moq: p.moq,
    stock: p.stock ?? 0,
    lowStockLevel: p.lowStockLevel ?? null,
    isFeatured: p.isFeatured ?? false,
    featuredOrder: p.isFeatured ? (p.featuredOrder ?? null) : null,
    isNewArrival: p.isNewArrival ?? false,
    newArrivalOrder: p.isNewArrival ? (p.newArrivalOrder ?? null) : null,
    images,
    variants: p.variants ?? [],
  };
}

/** Human-readable meaning for the status codes this API actually returns. */
function statusHint(status: number): string {
  switch (status) {
    case 400: return "the request was rejected as invalid";
    case 401: return "you are not signed in";
    case 403: return "you do not have permission";
    case 404: return "the endpoint or record was not found";
    case 409: return "that record already exists";
    case 413: return "the upload is too large";
    case 422: return "the data failed validation";
    case 503: return "the database is unavailable";
    default: return status >= 500 ? "the server hit an internal error" : `unexpected status ${status}`;
  }
}

/** Error carrying the server's code + field-level issues so forms can show them inline. */
export class CatalogApiError extends Error {
  status: number;
  code?: string;
  issues: { path: string; message: string }[];
  constructor(status: number, message: string, code?: string, issues: { path: string; message: string }[] = []) {
    super(message);
    this.name = "CatalogApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** Convert an API failure into the message an operator should see. */
export function describeCatalogError(e: unknown): string {
  if (e instanceof CatalogApiError) {
    switch (e.code) {
      case "SKU_EXISTS": return "SKU already exists. Use a different SKU.";
      case "CATEGORY_NOT_FOUND": case "CATEGORY_REQUIRED": case "SUBCATEGORY_NOT_FOUND": return e.message;
      case "BAD_IMAGE_TYPE": return `Invalid image format — ${e.message}`;
      case "IMAGE_TOO_LARGE": return `Image too large — ${e.message}`;
      case "CORRUPT_IMAGE": return `Invalid image file — ${e.message}`;
      case "VALIDATION": return e.issues.length ? `Validation failed: ${e.issues.map((i) => `${i.path || "field"} — ${i.message}`).join("; ")}` : "Validation failed.";
      case "UNAUTHENTICATED": return "Authentication failed — please sign in again.";
      case "FORBIDDEN": return "You don't have permission to manage the catalog.";
      case "PAYLOAD_TOO_LARGE": return "Upload too large — reduce the image sizes.";
      default:
        if (e.status === 401) return "Authentication failed — please sign in again.";
        if (e.status >= 500) return `Database/server error — ${e.message}`;
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    // fetch() rejects with a bare TypeError when the host is unreachable —
    // "Load failed" in Safari, "Failed to fetch" in Chrome. Neither names the
    // real problem, so replace it with one that does.
    throw new Error(describeNetworkError(e, `Request to ${path}`));
  }

  // Expired access token → one shared refresh, then retry once.
  if (res.status === 401 && token && !retried && (await refreshStoreSession())) {
    return request<T>(path, init, true);
  }

  // A non-JSON body (an HTML error page from a proxy, say) must not surface as
  // a confusing parse error — report the status we actually received.
  const raw = await res.text();
  let body: { success?: boolean; error?: string; code?: string; issues?: { path: string; message: string }[]; data?: unknown } = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new CatalogApiError(res.status, `Request to ${path} failed: server returned ${res.status} (${statusHint(res.status)}) with a non-JSON response. Check the API logs.`);
    }
  }

  if (!res.ok || body.success === false) {
    throw new CatalogApiError(res.status, body.error ?? statusHint(res.status), body.code, body.issues ?? []);
  }
  return body.data as T;
}

export interface ProductListQuery {
  page?: number;
  limit?: number;
  categoryId?: string;
  subcategoryId?: string;
  status?: ProductStatus | "";
  productType?: string;
  color?: string;
  size?: string;
  q?: string;
  sort?: "newest" | "oldest" | "name_asc" | "name_desc";
}
export interface ProductPage {
  products: CatalogProduct[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export const catalogApi = {
  list: () => request<{ products: DbProduct[] }>("/products").then((d) => d.products.map(fromDb)),

  /**
   * ONE page of products, filtered/sorted in PostgreSQL. This is what the
   * admin category views use (8 per page) — never the full catalog.
   */
  page: (query: ProductListQuery) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    return request<{ products: DbProduct[]; total: number; page: number; limit: number; pages: number }>(`/products?${qs.toString()}`)
      .then((d) => ({ ...d, products: d.products.map(fromDb) }) as ProductPage);
  },

  /** Distinct type / colour / size values for the filter dropdowns of one category. */
  facets: (query: { categoryId?: string; subcategoryId?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
    return request<{ types: string[]; colors: string[]; sizes: string[] }>(`/products/facets?${qs.toString()}`);
  },

  /** Bulk lifecycle change (active / draft / archived) for the multi-select toolbar. */
  bulkStatus: (ids: string[], status: ProductStatus) =>
    request<{ requested: number; updated: number; status: ProductStatus }>("/products/bulk-status", { method: "POST", body: JSON.stringify({ ids, status }) }),

  /** Create ONE product (admin form). Returns the database-saved record. */
  create: (input: ProductWriteInput) =>
    request<{ product: DbProduct }>("/products", { method: "POST", body: JSON.stringify(input) })
      .then((d) => fromDb(d.product)),

  /** Partial update — only the supplied fields change. */
  update: (id: string, input: ProductWriteInput) =>
    request<{ product: DbProduct }>(`/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) })
      .then((d) => fromDb(d.product)),

  /** Full-record persist of the current store state for one id. */
  save: (p: CatalogProduct) =>
    request<{ product: DbProduct }>(`/products/${encodeURIComponent(p.id)}`, { method: "PUT", body: JSON.stringify(toDb(p)) })
      .then((d) => fromDb(d.product)),

  /**
   * Bulk import. `mode` decides duplicate-SKU behavior:
   *   update — merge into the existing product (default)
   *   skip   — leave the existing product untouched
   *   create — import under a suffixed SKU, never overwriting
   */
  importBatch: (products: CatalogProduct[], mode: "update" | "skip" | "create", meta: { fileName?: string; fileSizeBytes?: number; imagesMatched?: number; createMissingCategories?: boolean } = {}) =>
    request<{ processed: number; created: number; updated: number; skipped: number; failed: number; categoriesCreated?: number; subcategoriesCreated?: number; importId: string | null; errors: { sku: string; level?: string; error: string }[] }>(
      "/products/import",
      { method: "POST", body: JSON.stringify({ products: products.map(importRow), mode, fileName: meta.fileName, fileSizeBytes: meta.fileSizeBytes, imagesMatched: meta.imagesMatched, createMissingCategories: meta.createMissingCategories === true }) },
    ),

  uploadImage: (name: string, mime: string, dataBase64: string) =>
    request<{ url: string }>("/uploads", { method: "POST", body: JSON.stringify({ name, mime, dataBase64 }) })
      .then((d) => d.url),

  /** Attach an image to one product and return the updated row. */
  setProductImage: (id: string, name: string, mime: string, dataBase64: string, replace = false) =>
    request<{ product: DbProduct; url: string }>(`/products/${encodeURIComponent(id)}/image`, {
      method: "POST",
      body: JSON.stringify({ name, mime, dataBase64, replace }),
    }),

  /** Attach many images at once, matched to products by SKU. */
  bulkImages: (images: { sku: string; name: string; mime: string; dataBase64: string }[]) =>
    request<{ processed: number; matched: number; unmatched: number; invalid: number; errors: { sku: string; level?: string; error: string }[] }>(
      "/products/images/bulk",
      { method: "POST", body: JSON.stringify({ images }) },
    ),

  /** Soft-delete many products (archived, so order history stays intact). */
  bulkDelete: (ids: string[]) =>
    request<{ requested: number; deleted: number }>("/products/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  // Category writes live in lib/api/categories.ts (categoriesApi).
};

/** Importer row shape (the bulk importer accepts denormalised names + image URLs). */
function importRow(p: CatalogProduct): Record<string, unknown> {
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory ?? "General",
    status: p.status,
    description: p.description ?? null,
    length: p.dimensions?.length ?? null,
    width: p.dimensions?.width ?? null,
    height: p.dimensions?.height ?? null,
    dimUnit: p.dimensions?.unit ?? null,
    gsm: p.gsm ?? null,
    color: p.color ?? null,
    material: p.material ?? null,
    productType: p.productType ?? null,
    thickness: p.thickness ?? null,
    sizeLabel: p.sizeLabel ?? null,
    basePriceMinor: Math.round((p.basePrice ?? 0) * 100),
    moq: p.moq,
    stock: p.stock ?? 0,
    lowStockLevel: p.lowStockLevel ?? null,
    images: (p.images ?? []).filter(isStoredUrl),
    variants: p.variants ?? [],
  };
}
