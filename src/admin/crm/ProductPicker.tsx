import { useEffect, useMemo, useRef, useState } from "react";
import { Package, X } from "lucide-react";
import { useCatalog } from "../catalog-store";
import { inrMinor } from "../format";

// ============================================================
// Product picker for the order builder (§11).
//
// An order line can be a catalog product OR free text (§12: custom packaging
// jobs that do not exist in the catalog). This is a combobox rather than a
// <select>: the admin types what they remember — part of a name, a SKU — and
// either picks a match or keeps their own words.
//
// Choosing a product fills the name, SKU and unit price from the catalog. The
// price stays EDITABLE afterwards, because B2B prices are negotiated and the
// catalog figure is only a starting point; the line keeps `productId` so the
// order still links to the real product.
//
// Reads the already-hydrated admin catalog store — no extra request per line
// (§34, §56).
// ============================================================

export interface PickedProduct {
  id: string;
  name: string;
  sku: string;
  /** Catalog price in paise. */
  unitPriceMinor: number;
}

const MAX_RESULTS = 8;

export function ProductPicker({
  value,
  productId,
  onChange,
  onPick,
  onClear,
  id,
  placeholder = "Search catalog, or type a custom item",
}: {
  /** The line's current item name (free text or a picked product's name). */
  value: string;
  /** Set when a catalog product is attached to this line. */
  productId: string | null;
  /** Free-text edit — clears any attached product upstream. */
  onChange: (name: string) => void;
  onPick: (p: PickedProduct) => void;
  onClear: () => void;
  id?: string;
  placeholder?: string;
}) {
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Only sellable products are offered; an archived or draft product would
  // create an order line the catalog no longer honours.
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const sellable = catalog.filter((p) => p.status === "active");
    if (!q) return sellable.slice(0, MAX_RESULTS);
    return sellable
      .filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [catalog, value]);

  useEffect(() => { setHighlight(0); }, [value]);

  // Click-away closes the list without disturbing what was typed.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (p: (typeof catalog)[number]) => {
    onPick({
      id: p.id,
      name: p.name,
      sku: p.sku ?? "",
      // The store keeps basePrice in RUPEES; every API money field is paise.
      unitPriceMinor: Math.round((p.basePrice ?? 0) * 100),
    });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(matches[highlight]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  const field = "w-full rounded-lg border erp-border erp-surface px-2.5 py-1.5 text-sm erp-text outline-none focus:border-primary-500";

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          id={id}
          className={`${field} truncate ${productId ? "pr-[5.5rem]" : "pr-8"}`}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
        />
        {productId ? (
          <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Catalog
            </span>
            <button
              type="button"
              onClick={onClear}
              aria-label="Detach catalog product and keep the text"
              className="flex h-5 w-5 items-center justify-center rounded erp-text-muted hover:erp-surface-2"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ) : (
          <Package className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 erp-text-faint" aria-hidden />
        )}
      </div>

      {open && matches.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border erp-border erp-surface py-1 shadow-xl"
          role="listbox"
        >
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(p)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${i === highlight ? "erp-surface-2" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate erp-text">{p.name}</span>
                  <span className="block truncate font-mono text-[11px] erp-text-muted">{p.sku}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums erp-text">
                  {inrMinor(Math.round((p.basePrice ?? 0) * 100))}
                </span>
              </button>
            </li>
          ))}
          {/* Free text is a first-class choice, not a failure to match. */}
          <li className="border-t erp-border px-3 pb-1 pt-1.5 text-[11px] erp-text-faint">
            Keep typing to enter a custom item instead
          </li>
        </ul>
      )}
    </div>
  );
}
