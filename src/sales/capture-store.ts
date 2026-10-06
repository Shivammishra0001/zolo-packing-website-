import { useSyncExternalStore } from "react";
import type { CustomerSnapshot, CaptureItem } from "@/lib/api/sales";

// ============================================================
// Order-capture draft.
//
// Held OUTSIDE React and mirrored to sessionStorage: a rep is on a phone, on
// mobile data, often standing in a warehouse. Losing a half-entered order to a
// backgrounded tab or a dropped connection is the worst thing this app could
// do to them, so the draft survives a reload and is cleared only once the
// server has confirmed the order.
//
// sessionStorage rather than localStorage: a draft belongs to this sitting,
// not forever, and must not leak into the next customer's order.
// ============================================================

const KEY = "zolo.salesDraft";

/** One line being captured. Mirrors CaptureItem plus UI-only display fields. */
export interface DraftLine extends CaptureItem {
  /** What the rep sees in the list; the API only needs productId or itemName. */
  displayName: string;
  unit: string;
}

export interface Draft {
  customerId: string | null;
  customerName: string | null;
  snapshot: CustomerSnapshot | null;
  lines: DraftLine[];
  notes: string;
  /** Collected at the payment step; recorded against the order after creation. */
  payment: {
    mode: "full" | "advance" | "later";
    amountMinor: number;
    method: "cash" | "upi" | "bank_transfer" | "cheque" | "card" | "other";
    reference: string;
  };
  samples: { fileName: string; mime: string; dataBase64: string }[];
}

const EMPTY: Draft = {
  customerId: null,
  customerName: null,
  snapshot: null,
  lines: [],
  notes: "",
  payment: { mode: "later", amountMinor: 0, method: "cash", reference: "" },
  samples: [],
};

let draft: Draft = { ...EMPTY };
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function persist() {
  try {
    // Sample bytes can be megabytes of base64 and would blow the quota, so the
    // draft is stored without them. Re-taking a photo is a far smaller loss
    // than losing the whole order.
    const { samples, ...rest } = draft;
    sessionStorage.setItem(KEY, JSON.stringify({ ...rest, samples: [] }));
  } catch {
    /* private mode or quota — the draft still works for this session */
  }
}

function set(next: Partial<Draft>) {
  draft = { ...draft, ...next };
  persist();
  emit();
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      draft = { ...EMPTY, ...parsed, samples: [], lines: Array.isArray(parsed.lines) ? parsed.lines : [] };
    }
  } catch {
    draft = { ...EMPTY };
  }
}

export function useDraft(): Draft {
  hydrate();
  return useSyncExternalStore(subscribe, () => draft, () => draft);
}

export const getDraft = () => {
  hydrate();
  return draft;
};

export function selectCustomer(id: string, name: string, snapshot: CustomerSnapshot | null) {
  hydrate();
  set({ customerId: id, customerName: name, snapshot });
}

export function addLine(line: DraftLine) {
  hydrate();
  set({ lines: [...draft.lines, line] });
}

export function updateLine(index: number, patch: Partial<DraftLine>) {
  hydrate();
  set({ lines: draft.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
}

export function removeLine(index: number) {
  hydrate();
  set({ lines: draft.lines.filter((_, i) => i !== index) });
}

export function setNotes(notes: string) {
  set({ notes });
}

export function setPayment(patch: Partial<Draft["payment"]>) {
  hydrate();
  set({ payment: { ...draft.payment, ...patch } });
}

export function addSample(sample: { fileName: string; mime: string; dataBase64: string }) {
  hydrate();
  set({ samples: [...draft.samples, sample] });
}

export function removeSample(index: number) {
  hydrate();
  set({ samples: draft.samples.filter((_, i) => i !== index) });
}

/** Called only after the server confirms the order. */
export function clearDraft() {
  draft = { ...EMPTY };
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** Subtotal in paise. The SERVER computes the authoritative total. */
export const subtotalMinor = (d: Draft) =>
  d.lines.reduce((n, l) => n + l.quantity * l.unitPriceMinor, 0);
