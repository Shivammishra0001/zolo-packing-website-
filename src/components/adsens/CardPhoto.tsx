import { useState } from "react";
import { CardArt, type ArtShape } from "./CardArt";
import type { Photo } from "./photos";

/* =========================================================
   A card's image: the photograph, with the generated artwork behind it.

   The photos come from a third-party CDN, so they can fail — a blocked
   network, an offline visitor, an ad blocker. When that happens the tile
   falls back to the monogram artwork rather than collapsing to a blank
   box, which is why both are kept.

   The artwork also shows THROUGH while the photo loads, so the card never
   flashes empty.
   ========================================================= */

export function CardPhoto({
  photo, monogram, category, shape, label, className, sizes,
}: {
  photo: Photo;
  monogram: string;
  category: string;
  shape: ArtShape;
  label?: string;
  className?: string;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="absolute inset-0 block">
      {/* Always rendered: the placeholder before load, the fallback after
          a failure. */}
      <CardArt
        monogram={monogram}
        category={category}
        shape={shape}
        label={label}
        className="absolute inset-0 h-full w-full"
      />

      {!failed && (
        <img
          src={photo.src}
          srcSet={photo.srcSet}
          sizes={sizes}
          alt={photo.alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${className ?? ""}`}
        />
      )}
    </span>
  );
}
