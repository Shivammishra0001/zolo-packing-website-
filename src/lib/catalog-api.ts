import type { CatalogProduct, ProductStatus, ProductVariant } from "@/admin/types";

// ============================================================
// Catalog API client — Express + Prisma + PostgreSQL (server/).
// Single mapping point between the DB row shape and CatalogProduct.
// Every write returns the DATABASE-SAVED record (not a local echo).
// ============================================================

export { API_BASE } from "./api-config";
import { API_BASE, describeNetworkError } from "./api-config";

interface DbProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  category: string;
  subcategory: string;
  status: ProductStatus;
  description: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimUnit: string | null;
  gsm: number | null;
  color: string | null;
  basePriceMinor: number;
  moq: number;
  stock: number;
  lowStockLevel: number | null;
  imageEmoji: string;
  images: string[];
  variants: unknown;
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
    status: row.status,
    description: row.description ?? undefined,
    dimensions:
      row.length != null && row.width != null && row.height != null
        ? { length: row.length, width: row.width, height: row.height, unit: (row.dimUnit ?? "in") as "in" | "cm" | "mm" }
        : undefined,
    gsm: row.gsm ?? undefined,
    color: row.color ?? undefined,
    basePrice: row.basePriceMinor / 100,
    moq: row.moq,
    stock: row.stock,
    lowStockLevel: row.lowStockLevel ?? undefined,
    imageEmoji: row.imageEmoji,
    images: row.images.length ? row.images : [row.imageEmoji],
    variants: (Array.isArray(row.variants) ? row.variants : []) as ProductVariant[],
    updatedAt: row.updatedAt,
  };
}

export function toDb(p: CatalogProduct): Record<string, unknown> {
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug ?? p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
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
    basePriceMinor: Math.round((p.basePrice ?? 0) * 100),
    moq: p.moq,
    stock: p.stock ?? 0,
    lowStockLevel: p.lowStockLevel ?? null,
    imageEmoji: p.imageEmoji,
    images: p.images ?? [p.imageEmoji],
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
    case 422: return "the data failed validation";
    case 503: return "the database is unavailable";
    default: return status >= 500 ? "the server hit an internal error" : `unexpected status ${status}`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch (e) {
    // fetch() rejects with a bare TypeError when the host is unreachable —
    // "Load failed" in Safari, "Failed to fetch" in Chrome. Neither names the
    // real problem, so replace it with one that does.
    throw new Error(describeNetworkError(e, `Request to ${path}`));
  }

  // A non-JSON body (an HTML error page from a proxy, say) must not surface as
  // a confusing parse error — report the status we actually received.
  const raw = await res.text();
  let body: { success?: boolean; error?: string; data?: unknown } = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(
        `Request to ${path} failed: server returned ${res.status} (${statusHint(res.status)}) ` +
        `with a non-JSON response. Check the API logs.`,
      );
    }
  }

  if (!res.ok || body.success === false) {
    // Prefer the server's own message; fall back to a status explanation.
    const detail = body.error ?? statusHint(res.status);
    throw new Error(`${detail} (HTTP ${res.status} on ${path})`);
  }
  return body.data as T;
}

export const catalogApi = {
  list: () => request<{ products: DbProduct[] }>("/products").then((d) => d.products.map(fromDb)),

  create: (p: CatalogProduct) =>
    request<{ product: DbProduct }>("/products", { method: "POST", body: JSON.stringify(toDb(p)) })
      .then((d) => fromDb(d.product)),

  /** Full-record PUT: idempotent persist of the current store state for one id. */
  save: (p: CatalogProduct) =>
    request<{ product: DbProduct }>(`/products/${p.id}`, { method: "PUT", body: JSON.stringify(toDb(p)) })
      .then((d) => fromDb(d.product)),

  /**
   * Bulk import. `mode` decides duplicate-SKU behavior:
   *   update — merge into the existing product (default)
   *   skip   — leave the existing product untouched
   *   create — import under a suffixed SKU, never overwriting
   */
  importBatch: (products: CatalogProduct[], mode: "update" | "skip" | "create") =>
    request<{ processed: number; created: number; updated: number; skipped: number; failed: number; errors: { sku: string; level?: string; error: string }[] }>(
      "/products/import",
      { method: "POST", body: JSON.stringify({ products: products.map(toDb), mode }) },
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
};
