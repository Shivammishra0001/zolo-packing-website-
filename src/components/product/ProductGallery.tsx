import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ============================================================
// ProductGallery — multi-image gallery for the Product Detail page.
//
// Layout: a square main stage (card-flat, mint ground, image contained and
// never cropped) with a row of 64px thumbnails underneath. The selected
// thumbnail uses the green "selected" state from the design system.
//
// Robustness the old single-<img> lacked:
//  - shows EVERY product image with clickable thumbnails
//  - per-image broken-URL handling (a bad image is skipped, never a blank box)
//  - falls back to the packaging mockup only when NO real image renders
//  - keyboard + arrow-key navigation, focus rings, aria-selected
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
    <div className="flex flex-col gap-3">
      {/* Main stage: square, mint ground, contained image. */}
      <div className="card-flat relative flex aspect-square w-full items-center justify-center overflow-hidden bg-green-50 p-6 sm:p-10">
        {hasImages ? (
          <img
            key={mainSrc}
            src={mainSrc}
            alt={name}
            width={640}
            height={640}
            decoding="async"
            onError={() => markBroken(mainSrc)}
            className="product-gallery-main h-full w-full animate-[fadeIn_0.3s_ease] object-contain motion-reduce:animate-none"
          />
        ) : (
          // No usable image → the packaging mockup (never a broken/blank box).
          <div className="h-full w-full">{fallback}</div>
        )}
        {overlay}
      </div>

      {/* Thumbnail strip — 64px squares, horizontal scroll when many. */}
      {showThumbs && (
        <div
          ref={railRef}
          role="listbox"
          aria-label={`${name} images`}
          onKeyDown={onKey}
          className="no-scrollbar flex gap-2 overflow-x-auto py-0.5"
        >
          {usable.map((src, i) => (
            <button
              key={src}
              type="button"
              role="option"
              aria-selected={i === active}
              aria-label={`View image ${i + 1} of ${usable.length}`}
              onClick={() => setActive(i)}
              className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white p-1 outline-none transition-[border-color,box-shadow] duration-150 ${
                i === active
                  ? "border-green-500 ring-2 ring-green-200"
                  : "border-dark-200 hover:border-green-400 focus-visible:ring-2 focus-visible:ring-green-200"
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
    </div>
  );
}
