import { useSyncExternalStore } from "react";
import { catalogApi, toDb, type ProductWriteInput } from "@/lib/catalog-api";
import { deriveStockStatus } from "./statuses-ext";
import type { CatalogProduct, ProductStatus, StockStatus } from "./types";

// ============================================================
// Catalog store — reactive cache over the REAL persistence layer
// (Express + Prisma + PostgreSQL in server/).
//
// Reads: hydrated from GET /api/v1/products on load — a page refresh refetches
// from the database, never resets to static data.
// Writes:
//   • create/edit (the product form) AWAIT the API and insert the
//     DATABASE-SAVED record — the server generates the id, so an optimistic
//     placeholder could never be reconciled and used to leave a phantom row.
//   • quick actions (stock, status, archive) stay optimistic for instant UI and
//     are reconciled with the saved response; failures surface via
//     onCatalogPersistError (never silently swallowed).
// ============================================================

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Ensure coherent derived fields (stockStatus, slug) on every record. */
function normalize(p: CatalogProduct): CatalogProduct {
  const stock = p.stock ?? p.variants.reduce((s, v) => s + v.stock, 0);
  const low = p.lowStockLevel ?? Math.max(Math.round(p.moq / 2), 1);
  return {
    ...p,
    stock,
    lowStockLevel: low,
    slug: p.slug ?? slugify(p.name),
    stockStatus: p.stockStatus ?? deriveStockStatus(stock, low),
  };
}

let products: CatalogProduct[] = [];
let hydrated = false;

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Persist-error surfacing ----------

type PersistErrorHandler = (message: string) => void;
const errorHandlers = new Set<PersistErrorHandler>();

/** Subscribe UI (e.g. a toast) to persistence failures. Returns unsubscribe. */
export function onCatalogPersistError(fn: PersistErrorHandler) {
  errorHandlers.add(fn);
  return () => errorHandlers.delete(fn);
}

function reportPersistError(context: string, err: unknown) {
  const msg = `${context}: ${err instanceof Error ? err.message : String(err)}`;
  console.error("[catalog:persist]", msg);
  for (const h of errorHandlers) h(msg);
}

// ---------- Hydration (DB → store) ----------

export async function hydrateCatalog(): Promise<void> {
  try {
    const fresh = await catalogApi.list();
    products = fresh.map(normalize);
    hydrated = true;
    emit();
  } catch (err) {
    // API down: keep whatever we have (empty on first load → real empty states).
    reportPersistError("Couldn't load products from the database", err);
  }
}

// Hydrate once on module load — refresh always refetches from PostgreSQL.
if (typeof window !== "undefined") void hydrateCatalog();

export function isCatalogHydrated(): boolean {
  return hydrated;
}

// ---------- Read hooks ----------

/** All products (admin view — includes archived). Reactive. */
export function useCatalog(): CatalogProduct[] {
  return useSyncExternalStore(subscribe, () => products, () => products);
}

/** Buyer-facing products: active only. Reactive. */
export function useBuyerCatalog(): CatalogProduct[] {
  const all = useCatalog();
  return all.filter((p) => p.status === "active");
}

/** One product by id (reactive). */
export function useCatalogProduct(id: string | undefined): CatalogProduct | undefined {
  const all = useCatalog();
  return all.find((p) => p.id === id);
}

/** Non-reactive snapshot reads (event handlers / services). */
export function getProduct(id: string): CatalogProduct | undefined {
  return products.find((p) => p.id === id);
}

export function getProductBySku(sku: string): CatalogProduct | undefined {
  const s = sku.trim().toLowerCase();
  return products.find((p) => p.sku.toLowerCase() === s);
}

// ---------- Mutators ----------

const nowIso = () => new Date().toISOString();

/** Reconcile one record with the database-saved copy the API returned. */
function reconcile(saved: CatalogProduct) {
  const next = normalize(saved);
  products = products.some((p) => p.id === next.id)
    ? products.map((p) => (p.id === next.id ? next : p))
    : [next, ...products];
  emit();
}

/** Persist the CURRENT store state of `id` (full-record PUT). */
function persist(id: string, context: string) {
  const current = products.find((p) => p.id === id);
  if (!current) return;
  catalogApi
    .save(current)
    .then(reconcile)
    .catch((err) => reportPersistError(context, err));
}

function replace(id: string, patch: (p: CatalogProduct) => CatalogProduct, context: string) {
  products = products.map((p) => (p.id === id ? normalize(patch(p)) : p));
  emit();
  persist(id, context);
}

/** Set an absolute stock quantity; stockStatus re-derives automatically. */
export function updateStock(id: string, newStock: number) {
  replace(id, (p) => ({
    ...p,
    stock: Math.max(0, Math.round(newStock)),
    stockStatus: undefined,
    updatedAt: nowIso(),
  }), "Saving stock update failed");
}

/** Pin a product to Out of Stock without touching its lifecycle status. */
export function markOutOfStock(id: string) {
  replace(id, (p) => ({
    ...p,
    stock: 0,
    stockStatus: "out_of_stock" as StockStatus,
    updatedAt: nowIso(),
  }), "Saving out-of-stock failed");
}

/** Archive (hide from active + buyer views); preserves all data. */
export function archiveProduct(id: string) {
  replace(id, (p) => ({ ...p, status: "archived" as ProductStatus, updatedAt: nowIso() }), "Archiving failed");
}

/** Unarchive → back to Active. Stock preserved; 0 stays Out of Stock. */
export function unarchiveProduct(id: string) {
  replace(id, (p) => ({
    ...p,
    status: "active" as ProductStatus,
    stockStatus: undefined,
    updatedAt: nowIso(),
  }), "Unarchiving failed");
}

/** Set lifecycle status directly (Draft ⇄ Active from the edit form). */
export function setProductStatus(id: string, status: ProductStatus) {
  replace(id, (p) => ({ ...p, status, updatedAt: nowIso() }), "Saving status failed");
}

/**
 * Create a product from the admin form. Waits for PostgreSQL, then inserts the
 * saved record (server-generated id, stored image URLs). Throws on failure —
 * the form shows the error and keeps the operator's input.
 */
export async function createProduct(input: ProductWriteInput): Promise<CatalogProduct> {
  const saved = await catalogApi.create(input);
  reconcile(saved);
  return saved;
}

/** Edit a product from the admin form (partial update, awaited, reconciled). */
export async function saveProduct(id: string, input: ProductWriteInput): Promise<CatalogProduct> {
  const saved = await catalogApi.update(id, input);
  reconcile(saved);
  return saved;
}

/** Create a product from an existing CatalogProduct shape (e.g. "Duplicate"). Awaited. */
export async function addProduct(p: CatalogProduct): Promise<CatalogProduct> {
  return createProduct(toDb(p));
}

/** Patch arbitrary editable fields (quick actions; optimistic + reconciled). */
export function updateProduct(id: string, patch: Partial<CatalogProduct>) {
  replace(id, (p) => ({ ...p, ...patch, updatedAt: nowIso() }), "Saving product failed");
}
