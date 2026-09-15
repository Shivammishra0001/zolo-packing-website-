// Circular skeleton placeholders — shown while the category API resolves so
// the section never flashes a large blank white area.
export function PackagingCategorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-5 overflow-hidden px-1 pt-8" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="carousel-item flex flex-col items-center gap-3">
          <div className="aspect-square w-[86%] animate-pulse rounded-full bg-dark-100" />
          <div className="h-3 w-20 animate-pulse rounded bg-dark-100" />
        </div>
      ))}
    </div>
  );
}
