import { Link } from "react-router-dom";
import { ArrowRight, Package } from "lucide-react";
import type { ParentCategory } from "@/lib/use-parent-categories";
import { curatedCategoryImage } from "./category-images";

// ============================================================
// CategoryCircleNav — the FAST path into the catalog.
//
// Deliberately different in job from PackagingCategorySection (the large
// visual cards below it): this strip is pure navigation — a glanceable row of
// circular category avatars that gets a shopper into /products?category=<slug>
// in one tap. No descriptions, no counts, minimal ink.
//
// Data: top-level categories only (parentId === null), from the shared
// useParentCategories() hook — one API call, shared with the card section.
// Nothing is hardcoded; subcategories are untouched in the database and still
// drive filtering, the admin and the importer.
//
// Layout: a single horizontal row that scrolls on mobile (never wraps to 2–3
// rows) and centres itself on desktop when the categories fit.
// ============================================================

export function CategoryCircleNav({ categories }: { categories: ParentCategory[] }) {
  if (categories.length === 0) return null;

  return (
    <div
      // ONE row, always. It scrolls horizontally when the categories outrun the
      // shell (§9: "Do NOT wrap into 2–3 rows on mobile") and centres itself
      // when they fit, so the strip never becomes a second card grid.
      // `scroll-px-4` keeps a snapped tile clear of the gutter instead of
      // flush against the viewport edge; the negative margin + padding pair
      // lets the strip bleed to the screen edge while its first and last
      // tiles still rest on the shell's gutter.
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-1 overflow-x-auto px-4 pb-1 sm:gap-2 lg:mx-0 lg:justify-center lg:px-0"
      role="list"
      aria-label="Shop by category"
    >
      {categories.map((c) => {
        const image = (c.imageSource === "uploaded" ? c.image : null) ?? curatedCategoryImage(c.slug, c.name) ?? c.image;
        return (
          <Link
            key={c.id}
            to={`/products?category=${c.slug}`}
            role="listitem"
            className="group flex w-[88px] shrink-0 snap-start flex-col items-center gap-2 rounded-xl p-2 outline-none transition-colors hover:bg-green-50 focus-visible:ring-2 focus-visible:ring-green-500 sm:w-[104px]"
          >
            {/* Circular stage: fixed size, contained image, soft mint ground. */}
            {/* White stage: many catalog renders carry a baked white studio
                background, which shows as a grey square on a tinted circle. */}
            <span className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full border border-dark-200 bg-white p-2.5 transition-[border-color,transform] duration-200 group-hover:border-green-300 group-hover:-translate-y-0.5 motion-reduce:transform-none sm:h-[92px] sm:w-[92px] sm:p-3">
              {image ? (
                <img
                  src={image}
                  alt=""
                  width={92}
                  height={92}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain"
                />
              ) : (
                <Package className="h-8 w-8 text-green-500" strokeWidth={1.5} aria-hidden />
              )}
            </span>
            <span className="line-clamp-2 text-center text-xs font-semibold leading-tight text-dark-700 transition-colors group-hover:text-green-600 sm:text-[13px]">
              {c.name}
            </span>
          </Link>
        );
      })}

      {/* "All categories" terminator — same rhythm as a category, clearly not one. */}
      <Link
        to="/categories"
        role="listitem"
        className="group flex w-[88px] shrink-0 snap-start flex-col items-center gap-2 rounded-xl p-2 outline-none transition-colors hover:bg-green-50 focus-visible:ring-2 focus-visible:ring-green-500 sm:w-[104px]"
      >
        <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-dashed border-dark-300 bg-white transition-[border-color,transform] duration-200 group-hover:border-green-400 group-hover:-translate-y-0.5 motion-reduce:transform-none sm:h-[92px] sm:w-[92px]">
          <ArrowRight className="h-6 w-6 text-dark-400 transition-colors group-hover:text-green-600" aria-hidden />
        </span>
        <span className="text-center text-xs font-semibold leading-tight text-dark-700 transition-colors group-hover:text-green-600 sm:text-[13px]">
          View all
        </span>
      </Link>
    </div>
  );
}
