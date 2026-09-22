import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Package, Search, X } from "lucide-react";
import { useBuyerProducts, isRealImageUrl, type StoreProduct } from "@/lib/products";
import { addStoreProductLine } from "@/lib/rfq-cart-store";
import { EmptyState } from "@/components/UI";

// ============================================================
// Product picker — "Select Product From Store" for the RFQ builder.
//
// Searches the buyer catalogue (already loaded client-side via useBuyerProducts)
// by name / SKU / category, lets the buyer browse category chips, and adds the
// chosen products straight into the RFQ cart (with their category for seller
// matching). Multi-select: pick several, then Done.
// ============================================================

export function ProductPickerModal({
  open,
  onClose,
  addedIds,
}: {
  open: boolean;
  onClose: () => void;
  /** Product ids already in the RFQ cart, shown as "Added". */
  addedIds: Set<string>;
}) {
  const products = useBuyerProducts();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Lock body scroll + focus search + Escape to close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  useEffect(() => { if (open) setJustAdded(new Set()); }, [open]);

  // Category chips from the catalogue's own category names.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.tags?.[0]) set.add(p.tags[0]);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => {
      if (cat !== "all" && p.tags?.[0] !== cat) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.sku ?? "").toLowerCase().includes(term) ||
        (p.tags?.[0] ?? "").toLowerCase().includes(term) ||
        (p.subcategory ?? "").toLowerCase().includes(term) ||
        (p.description ?? "").toLowerCase().includes(term)
      );
    });
  }, [products, q, cat]);

  if (!open) return null;

  const add = (p: StoreProduct) => {
    addStoreProductLine({ id: p.id, name: p.name, sku: p.sku, image: p.image, moq: p.moq, category: p.tags?.[0] });
    setJustAdded((s) => new Set(s).add(p.id));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Select a product from the store">
      <div className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="card relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[16px] rounded-b-none sm:rounded-[12px]">
        {/* Header + search */}
        <div className="shrink-0 border-b border-dark-200 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="h3 text-dark-900">Select product from store</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-dark-400 transition-colors duration-150 hover:bg-dark-50 hover:text-dark-800">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by product name or SKU…"
              aria-label="Search products"
              className="input pl-10"
            />
          </div>
          {categories.length > 0 && (
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
              {["all", ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  aria-pressed={cat === c}
                  className={`chip shrink-0 ${cat === c ? "chip-active" : ""}`}
                >
                  {c === "all" ? "All" : c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-dark-50/60 p-4 sm:p-5">
          {results.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No products match your search"
              message="Try a different name, SKU or category — or add a custom product instead."
              className="shadow-none"
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {results.map((p) => {
                const added = addedIds.has(p.id) || justAdded.has(p.id);
                const realImg = isRealImageUrl(p.image);
                return (
                  <li key={p.id} className="card-flat flex items-center gap-3 p-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-green-50">
                      {realImg ? (
                        <img src={p.image} alt={p.name} className="h-full w-full object-contain" loading="lazy" />
                      ) : (
                        <span className="text-2xl" aria-hidden>{p.emoji || "📦"}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-dark-900">{p.name}</p>
                      {p.sku && <p className="text-[11px] text-dark-400">SKU {p.sku}</p>}
                      {p.shortDesc && <p className="mt-0.5 line-clamp-2 text-xs text-dark-500">{p.shortDesc}</p>}
                    </div>
                    {added ? (
                      <span className="badge shrink-0 bg-green-100 text-green-600"><Check className="h-3 w-3" aria-hidden /> Added</span>
                    ) : (
                      <button type="button" onClick={() => add(p)} className="btn btn-secondary btn-sm shrink-0">
                        Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-dark-200 p-4 sm:p-5">
          <button type="button" onClick={onClose} className="btn btn-navy w-full">
            Done{justAdded.size > 0 ? ` · ${justAdded.size} added` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
