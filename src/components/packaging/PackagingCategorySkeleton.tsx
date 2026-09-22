// Card-shaped skeleton placeholders — shown while the category API resolves so
// the section never flashes a large blank area. Mirrors PackagingCategoryCard:
// square image stage → name line → count line.
export function PackagingCategorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="-mx-1 flex gap-3 overflow-hidden px-1 pb-2 pt-1 sm:gap-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="carousel-item card-flat overflow-hidden">
          <div className="skeleton aspect-square w-full rounded-none" />
          <div className="space-y-2 px-3 py-3">
            <div className="skeleton h-3.5 w-4/5" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
