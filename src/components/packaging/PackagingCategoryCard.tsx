import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import type { Category } from "@/data/products";
import { curatedCategoryImage } from "./category-images";

// ============================================================
// PackagingCategoryCard — one category tile on the design system.
//
//   card-flat  →  square image stage on green-50 (object-contain, never
//                 cropped)  →  name + product count.
//
// Every tile has equal visual weight; hover is a subtle lift. The whole tile
// is one link to the existing catalog route (/products?category=<slug>), so no
// duplicate routing is introduced.
// ============================================================

export function PackagingCategoryCard({ category }: { category: Category }) {
  // An image the admin uploaded for the category wins; otherwise the curated
  // packaging-TYPE artwork, then the representative product image from the
  // API; a lucide icon only if none exists.
  const image = (category.imageSource === "uploaded" ? category.image : null)
    ?? curatedCategoryImage(category.slug, category.name) ?? category.image ?? null;
  const hasImage = Boolean(image);
  const count = category.count ?? 0;

  return (
    <Link
      to={`/products?category=${category.slug}`}
      aria-label={`${category.name} packaging, ${count} ${count === 1 ? "product" : "products"}`}
      className="group carousel-item card-flat card-hover flex flex-col overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
    >
      {/* Image stage */}
      <div className="relative flex aspect-square w-full items-center justify-center bg-green-50 p-4">
        {hasImage ? (
          <img
            src={image as string}
            alt=""
            width={160}
            height={160}
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

      {/* Name + product count */}
      <div className="flex flex-1 flex-col px-3 py-3">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-dark-900 transition-colors duration-150 group-hover:text-green-600">
          {category.name}
        </span>
        <span className="mt-1 text-xs font-medium text-dark-500">
          {count} {count === 1 ? "product" : "products"}
        </span>
      </div>
    </Link>
  );
}
