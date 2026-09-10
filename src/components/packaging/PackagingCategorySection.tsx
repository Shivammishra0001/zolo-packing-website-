import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, PackageX, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/api-config";
import type { Category } from "@/data/products";
import { PackagingCategoryCard } from "./PackagingCategoryCard";
import { PackagingCategorySkeleton } from "./PackagingCategorySkeleton";

// ============================================================
// "Shop by packaging type" — premium circular category showcase.
//
// Data flow: GET /api/v1/categories (the same canonical endpoint the nav uses)
// → active categories with a representative product image → circular cards →
// click → /products?category=<slug> (the existing catalog route, reused).
//
// Distinct states: loading (circular skeletons), error (retry), empty (never
// shown for an API failure). No product counts / price / MOQ anywhere.
// ============================================================

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: Category[] };

interface ApiSub { productCount: number }
interface ApiCategory { id: string; name: string; slug: string; productCount: number; image?: string | null; icon?: string | null; isActive?: boolean; subcategories: ApiSub[] }

const EMOJI_FALLBACK: Record<string, string> = {
  boxes: "📦", containers: "🫙", "food packaging": "🍱", tapes: "🎗️", tubes: "🧴",
  mailers: "✉️", bags: "🛍️", "flexible packaging": "🧃", "packaging accessories": "🏷️",
  drinkware: "☕", packaging: "📦", "digital files": "🖼️",
};

export function PackagingCategorySection() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const scroller = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`${API_BASE}/categories`);
      const body = await res.json();
      const tree: ApiCategory[] | undefined = body?.data?.tree;
      if (!body?.success || !Array.isArray(tree)) throw new Error("bad response");
      const categories: Category[] = tree
        // Active + shoppable only; admin-disabled/empty categories never appear.
        .filter((c) => (c.isActive ?? true) && c.productCount > 0)
        .map((c) => ({
          id: c.slug,
          name: c.name,
          slug: c.slug,
          icon: c.icon || EMOJI_FALLBACK[c.name.trim().toLowerCase()] || "📦",
          count: c.productCount,
          image: c.image ?? null,
          subcategories: [],
        }));
      setState({ status: "ready", categories });
    } catch {
      // An API failure is an ERROR, never an empty category list.
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateArrows = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    updateArrows();
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [state.status, updateArrows]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    // Scroll roughly one viewport of cards; respects reduced-motion via CSS.
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 300), behavior: "smooth" });
  };

  const showArrows = state.status === "ready" && state.categories.length > 0;

  return (
    <section className="py-20 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Header — unchanged layout: eyebrow, title, subtitle, View all */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div className="w-full min-w-0 sm:w-auto">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600">
              <span className="mr-2 inline-block h-1 w-6 rounded-full bg-primary-500" />
              Categories
            </div>
            <h2 className="font-display text-[1.6rem] font-extrabold leading-[1.1] tracking-tight text-balance text-dark-900 sm:text-4xl lg:text-5xl">
              Shop by <span className="grad-text">packaging type</span>
            </h2>
            <p className="mt-3 text-lg text-dark-500">Explore our full catalog of premium packaging solutions</p>
          </div>
          <div className="flex items-center gap-2">
            {showArrows && (
              <>
                <button
                  type="button"
                  onClick={() => scrollBy(-1)}
                  disabled={atStart}
                  aria-label="Previous categories"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-dark-200 text-dark-700 transition hover:border-primary-400 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollBy(1)}
                  disabled={atEnd}
                  aria-label="Next categories"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-dark-200 text-dark-700 transition hover:border-primary-400 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
            <Link to="/categories" className="inline-flex items-center gap-1 text-sm font-bold text-dark-900 hover:text-primary-600">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {state.status === "loading" && <PackagingCategorySkeleton />}

        {state.status === "error" && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dark-200 py-12 text-center">
            <PackageX className="h-8 w-8 text-dark-300" aria-hidden />
            <p className="text-sm font-semibold text-dark-600">Unable to load packaging categories</p>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-full border border-dark-200 px-4 py-2 text-sm font-bold text-dark-700 hover:border-primary-400 hover:text-primary-600"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          </div>
        )}

        {state.status === "ready" && state.categories.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-dark-200 py-12 text-center">
            <PackageX className="h-8 w-8 text-dark-300" aria-hidden />
            <p className="text-sm font-semibold text-dark-600">No packaging categories yet</p>
            <p className="text-xs text-dark-400">Categories added in the catalog will appear here.</p>
          </div>
        )}

        {state.status === "ready" && state.categories.length > 0 && (
          // Only THIS strip scrolls horizontally — never the page. Snap + hidden
          // scrollbar; touch/swipe works natively on mobile.
          <div
            ref={scroller}
            className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-2 motion-reduce:scroll-auto"
            role="list"
            aria-label="Packaging categories"
          >
            {state.categories.map((c) => (
              <div key={c.id} role="listitem" className="snap-start">
                <PackagingCategoryCard category={c} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
