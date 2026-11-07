import type { CSSProperties } from "react";

/* =========================================================
   Card artwork.

   The repo's packaging photographs are unbranded mockups printed with
   "YOUR LOGO HERE". On a card that claims finished client work, that visible
   placeholder contradicts the claim, so these cards draw their own artwork
   instead: a client monogram over a packaging silhouette, tinted by category.

   Drawn as inline SVG rather than shipped as images — it costs no network
   request, stays crisp at any density, and inherits the page's tokens.
   ========================================================= */

export type ArtShape = "box" | "mailer" | "carton" | "pouch" | "jar" | "bag" | "cup" | "envelope";

/** Per-category palette. Each is a two-stop wash the monogram sits on. */
const TINT: Record<string, { from: string; to: string; ink: string }> = {
  PPC:      { from: "#eef2ff", to: "#e0e7ff", ink: "#3730a3" },
  SEO:      { from: "#ecfdf5", to: "#d1fae5", ink: "#065f46" },
  Branding: { from: "#fff7ed", to: "#ffedd5", ink: "#9a3412" },
  Email:    { from: "#faf5ff", to: "#f3e8ff", ink: "#6b21a8" },
  Content:  { from: "#fefce8", to: "#fef9c3", ink: "#854d0e" },
  Social:   { from: "#eff6ff", to: "#dbeafe", ink: "#1e40af" },
};

export const tintFor = (c: string) => TINT[c] ?? TINT.PPC;

/** Packaging silhouettes, drawn as simple paths on a 100×100 field. */
function Silhouette({ shape, color }: { shape: ArtShape; color: string }) {
  const common = { fill: "none", stroke: color, strokeWidth: 2.2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  switch (shape) {
    case "box":
      return <g {...common}><path d="M20 38 50 24l30 14v30L50 82 20 68Z" /><path d="M20 38 50 52l30-14M50 52v30" /></g>;
    case "mailer":
      return <g {...common}><rect x="20" y="34" width="60" height="40" rx="3" /><path d="M20 46h60M38 34v12" /></g>;
    case "carton":
      return <g {...common}><rect x="32" y="24" width="36" height="58" rx="3" /><path d="M32 40h36M44 32h12" /></g>;
    case "pouch":
      return <g {...common}><path d="M30 30h40v44a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8Z" /><path d="M30 38h40M44 24h12v6H44Z" /></g>;
    case "jar":
      return <g {...common}><rect x="33" y="36" width="34" height="46" rx="6" /><path d="M38 26h24v10H38ZM33 52h34" /></g>;
    case "bag":
      return <g {...common}><path d="M28 36h44v46H28Z" /><path d="M40 36V28a10 10 0 0 1 20 0v8" /></g>;
    case "cup":
      return <g {...common}><path d="M34 32h32l-4 48a4 4 0 0 1-4 4H42a4 4 0 0 1-4-4Z" /><path d="M32 44h36" /></g>;
    case "envelope":
      return <g {...common}><rect x="22" y="32" width="56" height="40" rx="3" /><path d="m22 36 28 20 28-20" /></g>;
  }
}

/**
 * A card's artwork: tinted field, packaging silhouette, client monogram.
 * Decorative — the card's own heading carries the meaning, so this is
 * hidden from assistive technology.
 */
export function CardArt({
  monogram, category, shape, className, label,
}: {
  monogram: string;
  category: string;
  shape: ArtShape;
  className?: string;
  /** Small caption printed on the art, e.g. the platform or client. */
  label?: string;
}) {
  const t = tintFor(category);
  const style = { "--art-ink": t.ink } as CSSProperties;

  // 2-3 characters read as a monogram at full size; anything longer is a
  // word and has to come down to fit the 100-wide field.
  const n = monogram.length;
  const fontSize = n <= 2 ? 26 : n === 3 ? 22 : n <= 5 ? 17 : 13;
  const plateRx = n <= 3 ? 27 : 39;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      aria-hidden
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id={`g-${monogram}-${category}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={t.from} />
          <stop offset="100%" stopColor={t.to} />
        </linearGradient>
      </defs>

      <rect width="100" height="100" fill={`url(#g-${monogram}-${category})`} />

      {/* soft corner motif */}
      <circle cx="88" cy="14" r="20" fill={t.ink} opacity="0.06" />
      <circle cx="12" cy="88" r="16" fill={t.ink} opacity="0.05" />

      <g opacity="0.26"><Silhouette shape={shape} color={t.ink} /></g>

      {/* A soft plate so the monogram never collides with the silhouette's
          internal lines — without it, a crossbar can run straight through
          the lettering. Both plate and type scale with the string, because
          an article tile passes a category name ("Content"), not initials. */}
      <ellipse cx="50" cy="50" rx={plateRx} ry="19" fill={t.from} opacity="0.82" />

      <text
        x="50" y={fontSize > 20 ? 56 : 54}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="800"
        fill={t.ink}
        // Hard cap: however long the label, it cannot spill past the field.
        textLength={monogram.length > 4 ? 72 : undefined}
        lengthAdjust="spacingAndGlyphs"
        style={{ fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}
      >
        {monogram}
      </text>

      {label && (
        <text
          x="50" y="72"
          textAnchor="middle"
          fontSize="6"
          fontWeight="700"
          fill={t.ink}
          opacity="0.72"
          style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.18em" }}
        >
          {label.toUpperCase()}
        </text>
      )}
    </svg>
  );
}
