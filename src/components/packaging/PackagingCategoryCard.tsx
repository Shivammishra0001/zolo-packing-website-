import { Link } from "react-router-dom";
import { ArrowRight, Package } from "lucide-react";
import type { Category } from "@/data/products";
import { curatedCategoryImage } from "./category-images";

// ============================================================
// PackagingCategoryCard — the VISUAL DISCOVERY tile (§10).
//
// Deliberately richer than the circular quick-nav above it: a wide image
// stage, the category name, its description (or a product count when the
// admin has not written one) and an arrow affordance. The circles are for
// "I know where I'm going"; these cards are for "show me what you have".
//
// Layout contract: every card is the same height, the image area is a fixed
// 4:3 stage on mint with `object-contain` (packaging renders are never
// cropped), and the meta row is pinned to the bottom so a grid of these
// aligns perfectly regardless of description length.
// ============================================================

export function PackagingCategoryCard({ category }: { category: Category }) {
  // An image the admin uploaded for the category wins; otherwise the curated
  // packaging-TYPE artwork, then the representative product image from the
  // API; a lucide icon only if none exists.
  const image = (category.imageSource === "uploaded" ? category.image : null)
    ?? curatedCategoryImage(category.slug, category.name) ?? category.image ?? null;
  const count = category.count ?? 0;
  const blurb = category.description?.trim();

  return (
    <Link
      to={`/products?category=${category.slug}`}
      aria-label={`${category.name} packaging, ${count} ${count === 1 ? "product" : "products"}`}
      className="group card card-hover flex h-full flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
    >
      {/* Image stage — fixed ratio so every card in the grid matches.
          WHITE, not mint: several catalog renders are photographs with a baked
          white studio background, which read as a grey rectangle floating on a
          tinted stage. White lets those sit flush while transparent PNGs still
          look clean, so the grid holds one consistent image language (§31). */}
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden border-b border-dark-100 bg-white p-5">
        {image ? (
          <img
            src={image}
            alt=""
            width={220}
            height={165}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain transition-transform duration-200 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-500" aria-hidden>
            <Package className="h-7 w-7" strokeWidth={1.6} />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-1 text-[15px] font-bold leading-snug text-dark-900 transition-colors duration-150 group-hover:text-green-600">
          {category.name}
        </h3>
        {/* The admin's description when there is one; otherwise nothing —
            never a fabricated marketing line. */}
        {blurb && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-dark-500">{blurb}</p>}

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="text-xs font-semibold text-dark-500">
            {count} {count === 1 ? "product" : "products"}
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-50 text-green-600 transition-colors duration-150 group-hover:bg-green-500 group-hover:text-white" aria-hidden>
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
