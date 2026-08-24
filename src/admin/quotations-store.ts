import { useSyncExternalStore } from "react";
import { rfqs as seed } from "./mock-data";
import type { Rfq } from "./types";

// ============================================================
// Quotations (RFQ) store — subscribable, seeded from mock data so cart→RFQ
// conversions and admin actions appear live in both admin and buyer views.
// FRONTEND-ONLY. TODO(backend): back with GET/POST /api/quotations.
// ============================================================

let store: Rfq[] = [...seed];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useQuotations(): Rfq[] {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

export function getQuotations(): Rfq[] {
  return store;
}

export function nextQuotationId(): string {
  const nums = store.map((r) => Number(r.id.replace(/\D/g, ""))).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 3100) + 1;
  return `RFQ-${next}`;
}

/** Prepend a new RFQ (e.g. converted from a buyer cart). */
export function addQuotation(rfq: Rfq): Rfq {
  store = [rfq, ...store];
  emit();
  return rfq;
}
