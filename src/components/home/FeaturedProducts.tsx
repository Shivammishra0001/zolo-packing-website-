import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { StoreProduct } from "@/lib/products";
import type { ParentCategory } from "@/lib/use-parent-categories";
import { ProductGrid } from "@/components/ProductGrid";
import { EmptyState, SectionHeader, SkeletonGrid } from "@/components/UI";

// ============================================================
// FeaturedProducts — the homepage product-discovery rail (§11).
//
// IMPORTANT — what this section is NOT: it is not "Best Sellers". The catalog
// has no sales-rank, rating or review data (see lib/products.ts:105), and §17/
// §18/§35 forbid fabricating any of it. The rail therefore shows the products
// an admin explicitly marked FEATURED, in the admin's order — real data,
// honestly labelled.
//
// Category tabs are built from the products actually in the rail, intersected
// with the live top-level categories, so a tab never leads to an empty grid
// and no category name is hardcoded. Filtering is client-side over an already
// loaded array — no extra API call per tab (§34).
// ============================================================

const ALL = "__all__";

export function FeaturedProducts({
  products,
  categories,
  loading,
}: {
  /** Already-filtered Featured pool, in the admin's order. */
  products: StoreProduct[];
  /** Live top-level categories (parentId === null). */
  categories: ParentCategory[];
  loading: boolean;
}) {
  const [active, setActive] = useState<string>(ALL);

  // Only offer a tab when the rail actually holds products for it. `category`
  // on a StoreProduct is the category SLUG, which is what the tabs match on.
  const tabs = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    return categories.filter((c) => present.has(c.slug));
  }, [products, categories]);

  const visible = useMemo(
    () => (active === ALL ? products : products.filter((p) => p.category === active)),
    [products, active],
  );

  // A tab that was active can stop existing when the pool changes; fall back.
  const activeExists = active === ALL || tabs.some((t) => t.slug === active);
  const shown = activeExists ? visible : products;

  return (
    <section className="section bg-white" aria-label="Featured products">
      <div className="shell">
        <SectionHeader
          eyebrow="Featured"
          title="Featured products"
          subtitle="Hand-picked packaging from our catalog"
          className="mb-5"
          action={
            <Link to="/products" className="btn btn-ghost btn-sm">
              View all products <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />

        {/* Category tabs — only rendered when there is a real choice to make. */}
        {!loading && tabs.length > 1 && (
          <div
            className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0"
            role="tablist"
            aria-label="Filter featured products by category"
          >
            <button
              type="button"
              role="tab"
              aria-selected={active === ALL}
              onClick={() => setActive(ALL)}
              className={`chip shrink-0 ${active === ALL ? "chip-active" : ""}`}
            >
              All
            </button>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active === t.slug}
                onClick={() => setActive(t.slug)}
                className={`chip shrink-0 ${active === t.slug ? "chip-active" : ""}`}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <SkeletonGrid count={4} />
        ) : shown.length === 0 ? (
          <EmptyState
            title="No featured products yet"
            message="Products marked as Featured in the catalog will appear here."
            action={
              <Link to="/products" className="btn btn-secondary btn-sm">
                Browse all products
              </Link>
            }
          />
        ) : (
          <ProductGrid products={shown} maxRows={2} />
        )}
      </div>
    </section>
  );
}
