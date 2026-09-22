import { useSyncExternalStore } from "react";
import { categoriesApi, type CategoryInput, type CategoryTreeNode } from "@/lib/api/categories";

// ============================================================
// Admin category store — the SAME canonical categories the storefront and the
// importer use (GET /api/v1/categories), hydrated from PostgreSQL.
//
// This replaces the hardcoded `categories: Category[] = []` in mock-data-ext,
// which is why Admin showed "Categories = 0" and the Edit Product dropdown
// rendered blank even though every product had a category.
// ============================================================

export type AdminSubcategory = CategoryTreeNode["subcategories"][number];
export type AdminCategory = CategoryTreeNode;

let tree: AdminCategory[] = [];
let hydrated = false;
let inFlight: Promise<void> | null = null;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * Load the category tree from the API. Concurrent callers share one request.
 * `force` bypasses the "already hydrated" check — used after an import so the
 * UI reflects newly created categories without a page reload.
 */
export async function hydrateCategories(force = false): Promise<void> {
  if (hydrated && !force) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Admin scope: inactive categories/subcategories are included so the
      // management page can show them and an Edit Product form can still
      // resolve a product whose category was deactivated later.
      const body = await categoriesApi.adminTree();
      tree = body.tree;
      hydrated = true;
      emit();
    } catch {
      /* keep whatever we had; callers show their own error state */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Reactive category tree. Empty until hydrateCategories() resolves. */
export function useCategories(): AdminCategory[] {
  return useSyncExternalStore(subscribe, () => tree, () => tree);
}

/** Non-reactive snapshot (event handlers, one-off reads). */
export const getCategories = (): AdminCategory[] => tree;

/** Flat "Category" + "Category / Sub" option list for form selects. */
export function categoryOptions(): { value: string; label: string }[] {
  return tree.flatMap((c) => [
    { value: c.name, label: c.name },
    ...c.subcategories.map((s) => ({ value: s.name, label: `${c.name} / ${s.name}` })),
  ]);
}

/** Create a category (or a subcategory when `parentId` is given). Admin-only on the server. */
export async function createCategory(name: string, parentId?: string): Promise<AdminCategory | null> {
  const category = await categoriesApi.create({ name, parentId: parentId ?? null });
  await hydrateCategories(true);
  return tree.find((c) => c.id === category.id) ?? null;
}

/** Full-form create / edit used by the Categories page. Refreshes the shared tree. */
export async function saveCategory(id: string | null, input: CategoryInput) {
  const saved = id ? await categoriesApi.update(id, input) : await categoriesApi.create(input);
  await hydrateCategories(true);
  return saved;
}

export async function setCategoryStatus(id: string, isActive: boolean) {
  const saved = await categoriesApi.setStatus(id, isActive);
  await hydrateCategories(true);
  return saved;
}

export async function reorderCategories(parentId: string | null, ids: string[]) {
  await categoriesApi.reorder(parentId, ids);
  await hydrateCategories(true);
}

/** Archive (soft). Throws ApiError CATEGORY_HAS_PRODUCTS while products reference it. */
export async function archiveCategory(id: string): Promise<{ productsAffected: number }> {
  const res = await categoriesApi.archive(id);
  await hydrateCategories(true);
  return res;
}
