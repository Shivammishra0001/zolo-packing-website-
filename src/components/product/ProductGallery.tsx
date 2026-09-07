import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ============================================================
// ProductGallery — professional multi-image gallery for the Product Detail page.
//
// Layout (desktop): a vertical thumbnail rail on the left + a large main image
// on the right. Mobile: thumbnails become a horizontal strip below the main
// image. Preserves the existing ZOLO card styling (rounded, soft shadow,
// off-white ground) — this only fixes the image AREA, not the page.
//
// Robustness the old single-<img> lacked:
//  - shows EVERY product image with clickable thumbnails
//  - per-image broken-URL handling (a bad image is skipped, never a blank box)
//  - falls back to the packaging mockup only when NO real image renders
//  - keyboard + arrow-key navigation, focus rings, aria-current
// ============================================================

export function ProductGallery({
  images,
  name,
  fallback,
  overlay,
}: {
  /** Real image URLs (already filtered). Empty → the mockup fallback shows. */
  images: string[];
  name: string;
  /** Rendered when there are no usable images (e.g. the PackagingMockup). */
  fallback: ReactNode;
  /** Absolutely-positioned extras over the main image (badges, artwork). */
  overlay?: ReactNode;
}) {
  const [active, setActive] = useState(0);
  // URLs that failed to load — dropped from the gallery so no broken box shows.
  const [broken, setBroken] = useState<Record<string, true>>({});

  // Usable images = provided images minus any that errored, deduped.
  const usable = useMemo(() => images.filter((src) => !broken[src]), [images, broken]);

  // Keep the active index valid as the product (or the usable set) changes.
  useEffect(() => { setActive(0); }, [images]);
  useEffect(() => {
    if (active > usable.length - 1) setActive(Math.max(0, usable.length - 1));
  }, [usable.length, active]);

  const hasImages = usable.length > 0;
  const showThumbs = usable.length > 1;
  const mainSrc = usable[active];

  const railRef = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (!showThumbs) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setActive((i) => (i + 1) % usable.length); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setActive((i) => (i - 1 + usable.length) % usable.length); }
  };

  const markBroken = (src: string) => setBroken((b) => (b[src] ? b : { ...b, [src]: true }));

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:gap-4">
      {/* Thumbnail rail — vertical on desktop, horizontal strip on mobile */}
      {showThumbs && (
        <div
          ref={railRef}
          role="listbox"
          aria-label={`${name} images`}
          onKeyDown={onKey}
          className="no-scrollbar flex shrink-0 gap-3 overflow-auto sm:max-h-[520px] sm:w-20 sm:flex-col md:w-24"
        >
          {usable.map((src, i) => (
            <button
              key={src}
              type="button"
              role="option"
              aria-selected={i === active}
              aria-label={`View image ${i + 1} of ${usable.length}`}
              onClick={() => setActive(i)}
              className={`group relative aspect-square w-16 shrink-0 overflow-hidden rounded-xl border bg-white p-1.5 outline-none transition sm:w-full ${
                i === active
                  ? "border-primary-500 ring-2 ring-primary-200"
                  : "border-dark-100 hover:border-primary-300 focus-visible:ring-2 focus-visible:ring-primary-300"
              }`}
            >
              <img
                src={src}
                alt={`${name} thumbnail ${i + 1}`}
                loading="lazy"
                decoding="async"
                onError={() => markBroken(src)}
                className="h-full w-full object-contain"
              />
            </button>
          ))}
        </div>
      )}

      {/* Main image */}
      <div className="relative flex aspect-square flex-1 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-dark-50 to-dark-100 p-8 card-shadow-lg sm:p-12">
        {hasImages ? (
          <img
            key={mainSrc}
            src={mainSrc}
            alt={name}
            width={640}
            height={640}
            decoding="async"
            onError={() => markBroken(mainSrc)}
            className="product-gallery-main h-full w-full animate-[fadeIn_0.3s_ease] object-contain p-2 motion-reduce:animate-none"
          />
        ) : (
          // No usable image → the packaging mockup (never a broken/blank box).
          <div className="h-full w-full">{fallback}</div>
        )}
        {overlay}
      </div>
    </div>
  );
}
