import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight, PackageX } from "lucide-react";
import { API_BASE } from "@/lib/api-config";
import type { Category } from "@/data/products";
import { EmptyState, ErrorState, SectionHeader } from "@/components/UI";
import { PackagingCategoryCard } from "./PackagingCategoryCard";
import { PackagingCategorySkeleton } from "./PackagingCategorySkeleton";

// ============================================================
// "Shop by packaging type" — category showcase on the mint band.
//
// Data flow: GET /api/v1/categories (the same canonical endpoint the nav uses)
// → active categories with a representative product image → cards →
// click → /products?category=<slug> (the existing catalog route, reused).
//
// Distinct states: loading (skeleton cards), error (retry), empty (never
// shown for an API failure).
// ============================================================

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: Category[] };

interface ApiSub { productCount: number }
interface ApiCategory { id: string; name: string; slug: string; productCount: number; image?: string | null; imageSource?: "uploaded" | "product" | null; isActive?: boolean; subcategories: ApiSub[] }

const arrowClass =
  "flex h-10 w-10 items-center justify-center rounded-full border border-dark-200 bg-white text-dark-700 transition-colors hover:border-green-500 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-dark-200 disabled:hover:text-dark-700";

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
      // The server already returns active, non-archived categories in the
      // admin's display order. Only categories with something to shop show.
      const categories: Category[] = tree
        .filter((c) => (c.isActive ?? true) && c.productCount > 0)
        .map((c) => ({
          id: c.slug,
          dbId: c.id,
          name: c.name,
          slug: c.slug,
          icon: "",
          count: c.productCount,
          image: c.image ?? null,
          imageSource: c.imageSource ?? null,
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
    <section className="section bg-green-50">
      <div className="shell">
        <SectionHeader
          eyebrow="Categories"
          title="Shop by packaging type"
          subtitle="Explore our full catalog of premium packaging solutions"
          className="mb-6"
          action={
            <div className="flex items-center gap-2">
              {showArrows && (
                <>
                  <button
                    type="button"
                    onClick={() => scrollBy(-1)}
                    disabled={atStart}
                    aria-label="Previous categories"
                    className={arrowClass}
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollBy(1)}
                    disabled={atEnd}
                    aria-label="Next categories"
                    className={arrowClass}
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </button>
                </>
              )}
              <Link to="/categories" className="btn btn-ghost btn-sm">
                View all <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          }
        />

        {state.status === "loading" && <PackagingCategorySkeleton />}

        {state.status === "error" && (
          <ErrorState
            title="Unable to load packaging categories"
            message="Please check your connection and try again."
            onRetry={() => void load()}
          />
        )}

        {state.status === "ready" && state.categories.length === 0 && (
          <EmptyState
            icon={PackageX}
            title="No packaging categories yet"
            message="Categories added in the catalog will appear here."
          />
        )}

        {state.status === "ready" && state.categories.length > 0 && (
          // Only THIS strip scrolls horizontally — never the page. Snap + hidden
          // scrollbar; touch/swipe works natively on mobile. The 4px inset keeps
          // the card lift/border from clipping at the strip edges.
          <div
            ref={scroller}
            className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-2 pt-1 motion-reduce:scroll-auto sm:gap-4"
            role="list"
            aria-label="Packaging categories"
          >
            {state.categories.map((c) => (
              <div key={c.id} role="listitem" className="flex snap-start">
                <PackagingCategoryCard category={c} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
