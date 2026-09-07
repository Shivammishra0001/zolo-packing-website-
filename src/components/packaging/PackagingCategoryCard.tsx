import { Link } from "react-router-dom";
import type { Category } from "@/data/products";
import { curatedCategoryImage } from "./category-images";

// ============================================================
// PackagingCategoryCard — a single "floating image over a circle" category.
//
// Structure (NOT a rectangular product card):
//   floating packaging PNG  ← extends above the circle for a 3D effect
//   soft circular background
//   category name below
//
// No product count / price / MOQ / seller / rating — image + name only.
// The whole tile is one link to the existing catalog route
// (/products?category=<slug>), so no duplicate routing is introduced.
// ============================================================

export function PackagingCategoryCard({ category }: { category: Category }) {
  // Prefer a curated, packaging-TYPE-relevant PNG; fall back to the category's
  // representative product image from the API; emoji only if neither exists.
  const image = curatedCategoryImage(category.slug, category.name) ?? category.image ?? null;
  const hasImage = Boolean(image);

  return (
    <Link
      to={`/products?category=${category.slug}`}
      aria-label={`${category.name} packaging`}
      className="group flex w-[150px] shrink-0 flex-col items-center rounded-2xl px-2 pt-8 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      {/* Circle + floating image */}
      <div className="relative flex h-[130px] w-[130px] items-center justify-center">
        <div
          className="absolute inset-0 rounded-full border border-dark-100 bg-dark-50 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)] transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          aria-hidden
        />
        {hasImage ? (
          <img
            src={image as string}
            alt={`${category.name} packaging`}
            width={140}
            height={140}
            loading="lazy"
            decoding="async"
            // Floats above the circle (negative top) and lifts on hover.
            className="relative -top-6 h-[140px] w-[140px] object-contain drop-shadow-[0_14px_20px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span
            className="relative -top-3 select-none text-6xl transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-hover:scale-[1.04] motion-reduce:transition-none"
            aria-hidden
          >
            {category.icon}
          </span>
        )}
      </div>

      {/* Name only — no metadata */}
      <span className="mt-1 text-center font-display text-sm font-semibold leading-tight text-dark-900 transition-colors duration-200 group-hover:text-primary-600">
        {category.name}
      </span>
    </Link>
  );
}
