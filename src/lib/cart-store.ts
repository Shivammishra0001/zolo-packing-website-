import { useSyncExternalStore } from "react";
import { cartApi, type CartLine } from "./api/commerce";
import { ApiError } from "./api/client";

// ============================================================
// Buyer cart store — a reactive cache over the REAL backend cart
// (GET/POST/PATCH/DELETE /api/v1/cart). The cart is owned by the authenticated
// buyer server-side; this store mirrors it and re-hydrates on load/login.
//
// Totals shown here are an optimistic local estimate; the AUTHORITATIVE totals
// (tax, discount, shipping, grand total) always come from the server via
// orderApi.quote() on the cart/checkout pages.
// ============================================================

const GST_RATE = 0.18;
const FREE_SHIP_THRESHOLD_MINOR = 1_000_00; // ₹1,000

// Re-exported so existing imports keep resolving; a line is a server CartLine.
export type CartItem = CartLine;
type StoredItem = CartLine;

let items: StoredItem[] = [];
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function setItems(next: StoredItem[]) {
  items = next;
  emit();
}

// ---------- Hydration ----------

/** Load the cart from the server. Call on app load and after login. */
export async function hydrateCart(): Promise<void> {
  try {
    const view = await cartApi.get();
    hydrated = true;
    setItems(view.items);
  } catch (err) {
    // 401 (guest) → empty cart, not an error worth surfacing.
    if (err instanceof ApiError && err.status === 401) setItems([]);
    hydrated = true;
  }
}

/** Reset local cart state (e.g. on logout). */
export function resetCart(): void {
  hydrated = false;
  setItems([]);
}

// ---------- Read ----------

export function useCart(): StoredItem[] {
  return useSyncExternalStore(subscribe, () => items, () => items);
}

export interface CartTotals {
  totalProducts: number;
  totalQuantity: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  grandTotalMinor: number;
}

/** Optimistic local totals for quick display. Server quote is authoritative. */
export function computeTotals(list: StoredItem[]): CartTotals {
  const subtotalMinor = list.reduce((s, it) => s + it.unitPriceMinor * it.quantity, 0);
  const discountMinor = 0;
  const taxable = subtotalMinor - discountMinor;
  const taxMinor = Math.round(taxable * GST_RATE);
  const shippingMinor = subtotalMinor === 0 || subtotalMinor >= FREE_SHIP_THRESHOLD_MINOR ? 0 : 5_00;
  return {
    totalProducts: list.length,
    totalQuantity: list.reduce((s, it) => s + it.quantity, 0),
    subtotalMinor,
    discountMinor,
    taxMinor,
    shippingMinor,
    grandTotalMinor: taxable + taxMinor + shippingMinor,
  };
}

export function lineTotalMinor(it: StoredItem): number {
  return it.unitPriceMinor * it.quantity;
}

// ---------- Mutators (async, API-backed; each returns the fresh cart) ----------

export async function addToCart(input: {
  productId: string;
  variant?: string | null;
  quantity: number;
}): Promise<void> {
  const view = await cartApi.add({ productId: input.productId, variant: input.variant ?? null, quantity: input.quantity });
  hydrated = true;
  setItems(view.items);
}

export async function setQuantity(id: string, quantity: number): Promise<void> {
  const q = Math.max(1, Math.round(quantity) || 1);
  const view = await cartApi.update(id, q);
  setItems(view.items);
}

export async function incrementQuantity(id: string, by = 1): Promise<void> {
  const line = items.find((it) => it.id === id);
  if (!line) return;
  await setQuantity(id, line.quantity + by);
}

export async function decrementQuantity(id: string, by = 1): Promise<void> {
  const line = items.find((it) => it.id === id);
  if (!line) return;
  await setQuantity(id, Math.max(1, line.quantity - by));
}

export async function removeFromCart(id: string): Promise<void> {
  const view = await cartApi.remove(id);
  setItems(view.items);
}

export async function clearCart(): Promise<void> {
  const view = await cartApi.clear();
  setItems(view.items);
}

/** Non-reactive snapshot. */
export function getCartItems(): StoredItem[] {
  return items;
}

export function isCartHydrated(): boolean {
  return hydrated;
}

// Hydrate once on module load in the browser (guest → empty, buyer → their cart).
if (typeof window !== "undefined") void hydrateCart();
