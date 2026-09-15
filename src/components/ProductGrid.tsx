import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProductCard } from "./NewProductCard";
import type { StoreProduct } from "@/lib/products";

// ============================================================
// ProductGrid — a `grid-cards` auto-fill grid that always shows COMPLETE rows.
//
// The column count comes from CSS (the fluid `.grid-cards` utility), so it
// changes with the viewport: 2 on a phone, 4 at 1280px, 8 at 2560px. A fixed
// `slice(0, 8)` therefore left one orphan card on a second row at 7 columns.
// This component measures the resolved column count (ResizeObserver, no
// layout math of its own) and renders `rows × columns` products, capped at
// `maxRows`, so every showcase row is full on every screen.
// ============================================================

export function ProductGrid({
  products,
  maxRows = 1,
  className = "",
  large = false,
}: {
  /** Candidate pool — pass more than you expect to show. */
  products: StoreProduct[];
  /** Maximum number of full rows to render. */
  maxRows?: number;
  className?: string;
  /** Use the larger-card variant (`grid-cards-lg`). */
  large?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // auto-fill reports every track even when the grid is empty, so the
    // measurement is valid before the first card renders (no flash).
    const measure = () => setCols(getComputedStyle(el).gridTemplateColumns.split(" ").length || 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = useMemo(() => {
    if (!cols) return [];
    if (products.length <= cols) return products;
    const rows = Math.max(1, Math.min(maxRows, Math.floor(products.length / cols)));
    return products.slice(0, rows * cols);
  }, [products, cols, maxRows]);

  return (
    <div ref={ref} className={`${large ? "grid-cards-lg" : "grid-cards"} ${className}`.trim()}>
      {visible.map((p, i) => (
        <ProductCard key={p.id} product={p} index={i} />
      ))}
    </div>
  );
}
