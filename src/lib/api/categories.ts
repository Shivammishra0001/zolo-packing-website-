// Typed client for Product Catalog → Categories.
// Reads are public (the storefront tree); writes are admin-only on the server.
import { request } from "./client";

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** What to show: the uploaded image, else a representative product image. */
  image: string | null;
  imageSource: "uploaded" | "product" | null;
  sortOrder: number;
  isActive: boolean;
  archived: boolean;
  parentId: string | null;
  parentName: string | null;
  parentSlug: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface CategoryTreeNode extends CategoryNode {
  subcategoryCount: number;
  subcategories: CategoryNode[];
}
export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string | null;
  image?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  parentId?: string | null;
}

const enc = encodeURIComponent;

export const categoriesApi = {
  /** Public tree: active + non-archived, in display order. */
  tree: () => request<{ categories: CategoryNode[]; tree: CategoryTreeNode[] }>("/categories", { auth: false }),
  /** Admin tree: inactive rows included (admin token required, otherwise the public tree comes back). */
  adminTree: () => request<{ categories: CategoryNode[]; tree: CategoryTreeNode[] }>("/categories?scope=admin"),
  get: (id: string) => request<CategoryNode & { subcategories: CategoryNode[] }>(`/categories/${enc(id)}`),
  create: (body: CategoryInput) => request<{ category: CategoryNode }>("/categories", { method: "POST", body }).then((d) => d.category),
  update: (id: string, body: Partial<CategoryInput>) => request<{ category: CategoryNode }>(`/categories/${enc(id)}`, { method: "PATCH", body }).then((d) => d.category),
  setStatus: (id: string, isActive: boolean) => request<{ category: CategoryNode }>(`/categories/${enc(id)}/status`, { method: "PATCH", body: { isActive } }).then((d) => d.category),
  setPosition: (id: string, position: number) => request<{ order: string[] }>(`/categories/${enc(id)}/order`, { method: "PATCH", body: { position } }),
  /** Persist a whole sibling order (drag & drop). parentId null = top level. */
  reorder: (parentId: string | null, ids: string[]) => request<{ order: string[] }>("/categories/reorder", { method: "POST", body: { parentId, ids } }),
  /** Archive (soft). 409 CATEGORY_HAS_PRODUCTS while products reference it. */
  archive: (id: string) => request<{ id: string; archived: boolean; productsAffected: number }>(`/categories/${enc(id)}`, { method: "DELETE" }),
};
