import { useSyncExternalStore } from "react";
import { rfqApi, type CreateRfqInput, type Rfq } from "./api/rfq";

// ============================================================
// RFQ cart — the buyer's staging area for a quotation request.
//
// This is what makes ONE RFQ hold MANY products: the buyer adds several
// products here, then submits the whole collection as a single RFQ
// (RFQ-1001 with Product A x5000, B x10000, C x2000) rather than firing off
// one request per product.
//
// Deliberately CLIENT-SIDE until submit: an RFQ draft is not a server
// resource, and persisting every keystroke would litter the database with
// abandoned drafts. It survives reloads via localStorage; submitting posts the
// whole thing once, transactionally, to POST /api/v1/rfqs.
// ============================================================

const STORAGE_KEY = "zolo.rfqCart";

export interface RfqCartLine {
  productId: string;
  productName: string;
  sku?: string;
  image?: string;
  quantity: number;
  unit?: string;
  /** Free-form per-line requirements (dimensions, gsm, material, printing). */
  specs?: Record<string, unknown>;
  notes?: string;
}

let lines: RfqCartLine[] = [];
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Private mode / quota — the cart still works for this session.
  }
}

function setLines(next: RfqCartLine[]) {
  lines = next;
  persist();
  emit();
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Trust nothing from storage: a hand-edited entry must not reach the API.
    lines = Array.isArray(parsed)
      ? parsed.filter(
          (l): l is RfqCartLine =>
            l && typeof l.productId === "string" && typeof l.productName === "string" && Number.isFinite(l.quantity),
        )
      : [];
  } catch {
    lines = [];
  }
}

/** Reactive view of the RFQ cart. */
export function useRfqCart(): RfqCartLine[] {
  hydrate();
  return useSyncExternalStore(subscribe, () => lines, () => lines);
}

export function getRfqCart(): RfqCartLine[] {
  hydrate();
  return lines;
}

export function rfqCartCount(): number {
  hydrate();
  return lines.length;
}

/**
 * Add a product, or merge into the line that is already there.
 *
 * Merging is what keeps a repeat "Add to RFQ" from turning one product into
 * two lines of the same thing.
 */
export function addToRfq(line: RfqCartLine) {
  hydrate();
  const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
  const existing = lines.findIndex((l) => l.productId === line.productId);
  if (existing >= 0) {
    const next = [...lines];
    next[existing] = { ...next[existing], ...line, quantity: next[existing].quantity + qty };
    setLines(next);
    return;
  }
  setLines([...lines, { ...line, quantity: qty }]);
}

export function updateRfqQuantity(productId: string, quantity: number) {
  hydrate();
  const qty = Math.floor(Number(quantity) || 0);
  if (qty <= 0) return removeFromRfq(productId);
  setLines(lines.map((l) => (l.productId === productId ? { ...l, quantity: qty } : l)));
}

export function updateRfqLine(productId: string, patch: Partial<RfqCartLine>) {
  hydrate();
  setLines(lines.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
}

export function removeFromRfq(productId: string) {
  hydrate();
  setLines(lines.filter((l) => l.productId !== productId));
}

export function clearRfqCart() {
  setLines([]);
}

/**
 * Submit the whole cart as ONE RFQ, then clear it.
 *
 * The cart is only cleared after the server confirms, so a failed request
 * leaves the buyer's work intact to retry.
 */
export async function submitRfq(meta: Omit<CreateRfqInput, "items"> = {}): Promise<Rfq> {
  hydrate();
  if (lines.length === 0) throw new Error("Add at least one product before requesting a quotation");
  const rfq = await rfqApi.create({
    ...meta,
    items: lines.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      sku: l.sku,
      quantity: l.quantity,
      unit: l.unit,
      specs: l.specs,
      notes: l.notes,
    })),
  });
  clearRfqCart();
  return rfq;
}
