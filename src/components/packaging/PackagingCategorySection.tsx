import { Link } from "react-router-dom";
import { ArrowRight, PackageX } from "lucide-react";
import { useParentCategories, type ParentCategory } from "@/lib/use-parent-categories";
import { EmptyState, ErrorState, SectionHeader } from "@/components/UI";
import { CategoryCircleNav } from "./CategoryCircleNav";
import { PackagingCategoryCard } from "./PackagingCategoryCard";
import { PackagingCategorySkeleton } from "./PackagingCategorySkeleton";

// ============================================================
// Category discovery band — TWO surfaces with two different jobs (§9 + §10):
//
//   1. CategoryCircleNav  — compact circular strip: the FAST way to jump into
//                           a category. Glanceable, one tap, no descriptions.
//   2. Category cards     — larger tiles for VISUAL discovery: image, name,
//                           product count.
//
// Both read the same `useParentCategories()` result, so the pair costs ONE
// API call. Only TOP-LEVEL categories (parentId === null) appear — subcategories
// remain in the database, the admin, the importer and the catalog filters.
//
// States: loading (skeleton), error (retry — never a silent empty list),
// empty (intentional message).
// ============================================================

/** Two full desktop rows of discovery cards (4 columns × 2). */
const CARD_LIMIT = 8;

/** A grid of large discovery cards: 2 columns on a phone, 3 on a tablet,
 *  4 on desktop — a fixed column count (not auto-fill) so the rows are always
 *  even and the section never ends in a ragged orphan row. */
function CategoryCards({ categories }: { categories: ParentCategory[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {categories.map((c) => (
        <PackagingCategoryCard
          key={c.id}
          category={{
            id: c.slug,
            dbId: c.id,
            name: c.name,
            slug: c.slug,
            icon: "",
            count: c.productCount,
            image: c.image,
            imageSource: c.imageSource,
            subcategories: [],
          }}
        />
      ))}
    </div>
  );
}

export function PackagingCategorySection() {
  const state = useParentCategories();
  // Only categories a shopper can actually buy from. A category with zero
  // products is a dead end on the homepage — it stays in the database, the
  // admin and /categories, it is simply not advertised as an entry point.
  const ready = state.status === "ready" ? state.categories.filter((c) => c.productCount > 0) : [];

  return (
    <section className="section bg-green-50" aria-label="Shop by category">
      <div className="shell">
        <SectionHeader
          eyebrow="Categories"
          title="Shop by category"
          subtitle="Find the right packaging for how you ship"
          className="mb-6"
          action={
            <Link to="/categories" className="btn btn-ghost btn-sm">
              View all categories <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          }
        />

        {state.status === "loading" && <PackagingCategorySkeleton />}

        {state.status === "error" && (
          <ErrorState
            title="Unable to load categories"
            message="Please check your connection and try again."
            onRetry={state.reload}
          />
        )}

        {state.status === "ready" && ready.length === 0 && (
          <EmptyState
            icon={PackageX}
            title="No categories yet"
            message="Categories added in the catalog will appear here."
          />
        )}

        {state.status === "ready" && ready.length > 0 && (
          <>
            {/* Quick navigation first — the shortest path to a category. */}
            <CategoryCircleNav categories={ready} />

            {/* Visual discovery below, separated by a hairline so the two
                surfaces read as "jump there" vs "browse these". Capped at two
                desktop rows: the circles above already cover every category,
                so the grid stays a bounded showcase rather than an
                ever-growing wall as the catalog expands. */}
            <div className="mt-7 border-t border-green-200 pt-7">
              <CategoryCards categories={ready.slice(0, CARD_LIMIT)} />

              {ready.length > CARD_LIMIT && (
                <div className="mt-5 flex justify-center">
                  <Link to="/categories" className="btn btn-secondary btn-sm">
                    View all {ready.length} categories <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
