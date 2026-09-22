import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api-config";

// ============================================================
// useParentCategories — ONE request for every homepage category surface.
//
// The circular quick-nav, the visual discovery cards and the product tabs all
// need the same list, so they share this hook instead of each fetching
// /categories (§34: "Do not create one API call per category/product").
//
// It asks the server for `?level=parent`, which returns TOP-LEVEL categories
// only (parentId === null). Subcategories are untouched in the database and
// still power filtering, the admin, the importer and category pages — they are
// simply not offered as independent entry points on the homepage.
//
// Nothing here is hardcoded: names, slugs, images and counts all come from the
// database, so a category renamed or added in the admin appears automatically.
// ============================================================

export interface ParentCategory {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  image: string | null;
  imageSource: "uploaded" | "product" | null;
  description: string | null;
}

export type CategoriesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: ParentCategory[] };

interface ApiCategory {
  id: string;
  name: string;
  slug: string;
  productCount?: number;
  image?: string | null;
  imageSource?: "uploaded" | "product" | null;
  description?: string | null;
  isActive?: boolean;
  parentId?: string | null;
}

// Module-level cache so mounting three sections in the same page costs one
// network request. Short TTL: the homepage is not a live dashboard.
let cache: { at: number; value: ParentCategory[] } | null = null;
let inflight: Promise<ParentCategory[]> | null = null;
const TTL = 60_000;

async function fetchParentCategories(): Promise<ParentCategory[]> {
  const res = await fetch(`${API_BASE}/categories?level=parent`);
  const body = await res.json();
  const tree: ApiCategory[] | undefined = body?.data?.tree;
  if (!body?.success || !Array.isArray(tree)) throw new Error("bad response");
  return tree
    // The server already excludes archived rows and orders by the admin's
    // sortOrder. Defensive `!parentId` keeps this correct even if an older
    // server ignores ?level=parent.
    .filter((c) => (c.isActive ?? true) && !c.parentId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      productCount: c.productCount ?? 0,
      image: c.image ?? null,
      imageSource: c.imageSource ?? null,
      description: c.description ?? null,
    }));
}

export function useParentCategories(): CategoriesState & { reload: () => void } {
  const [state, setState] = useState<CategoriesState>(() =>
    cache && Date.now() - cache.at < TTL ? { status: "ready", categories: cache.value } : { status: "loading" },
  );

  const load = useCallback(async (force = false) => {
    if (!force && cache && Date.now() - cache.at < TTL) {
      setState({ status: "ready", categories: cache.value });
      return;
    }
    setState({ status: "loading" });
    try {
      // Coalesce concurrent mounts onto a single request.
      inflight ??= fetchParentCategories();
      const categories = await inflight;
      cache = { at: Date.now(), value: categories };
      setState({ status: "ready", categories });
    } catch {
      // An API failure is an ERROR state, never a silent empty category list.
      setState({ status: "error" });
    } finally {
      inflight = null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { ...state, reload: () => void load(true) };
}
