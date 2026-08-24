import { useSyncExternalStore } from "react";
import { API_BASE } from "@/lib/api-config";

// ============================================================
// Admin category store — the SAME canonical categories the storefront and the
// importer use (GET /api/v1/categories), hydrated from PostgreSQL.
//
// This replaces the hardcoded `categories: Category[] = []` in mock-data-ext,
// which is why Admin showed "Categories = 0" and the Edit Product dropdown
// rendered blank even though every product had a category.
// ============================================================

export interface AdminSubcategory {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount: number;
}

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount: number;
  subcategories: AdminSubcategory[];
}

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
      const res = await fetch(`${API_BASE}/categories`);
      const body = await res.json();
      if (body?.success && Array.isArray(body.data?.tree)) {
        tree = body.data.tree as AdminCategory[];
        hydrated = true;
        emit();
      }
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

/** Create a category (or a subcategory when `parentId` is given). */
export async function createCategory(name: string, parentId?: string): Promise<AdminCategory | null> {
  const res = await fetch(`${API_BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentId }),
  });
  const body = await res.json();
  if (!body?.success) throw new Error(body?.error ?? "Could not create the category.");
  await hydrateCategories(true);
  return body.data.category ?? null;
}
