import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";

/* =========================================================
   AdSens dark showcase — shared surface.

   The hero, Active Campaigns and Our Portfolio sections run on a dark
   navy ground with cyan/violet accents, per the supplied references. The rest
   of /adsens stays light, so this is deliberately a SCOPED palette set on a
   wrapper element rather than a change to the global theme — exactly the
   approach already used for the light AdSens palette and the Eco Rewards page.

   Everything here is presentation only. No component in this file invents a
   metric, a client name or a status: those arrive from the API, which strips
   anything unverified before it is sent.
   ========================================================= */

/** Scoped tokens. Set on the dark wrapper; nothing outside it is affected. */
export const darkPalette = {
  "--dk-bg": "#05080F",
  "--dk-bg-2": "#080D18",
  "--dk-panel": "rgba(255,255,255,0.035)",
  "--dk-panel-2": "rgba(255,255,255,0.06)",
  "--dk-line": "rgba(255,255,255,0.10)",
  "--dk-line-2": "rgba(255,255,255,0.18)",
  "--dk-ink": "#F2F6FF",
  "--dk-muted": "#93A3BF",
  "--dk-faint": "#64748B",
  "--dk-cyan": "#2DD4BF",
  "--dk-blue": "#4F7BFF",
  "--dk-violet": "#A855F7",
  // Zolo's own orange still appears, so a visitor arriving from the
  // storefront can tell this is the same company.
  "--dk-orange": "#F97316",
} as CSSProperties;

/** The gradient used for headline accents and chips, in one place. */
export const DK_GRADIENT = "linear-gradient(100deg, var(--dk-cyan), var(--dk-blue) 55%, var(--dk-violet))";

/**
 * True when the visitor asked for less motion.
 *
 * Every decorative animation on this page is gated on it: the particles stop
 * being rendered at all (rather than being animated to a standstill, which
 * still costs layout work), entrance offsets collapse to a plain fade, and
 * hover zooms are dropped.
 */
export function useCalm() {
  return useReducedMotion() === true;
}

/**
 * The dark ground: base colour, a faint technical grid and two soft glows.
 *
 * `--dk-grid` is a CSS-only background, so it costs no DOM and no paint
 * beyond the single element.
 */
export function DarkGround({
  children,
  className = "",
  id,
}: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div
      id={id}
      style={darkPalette}
      className={`relative isolate overflow-hidden bg-[var(--dk-bg)] text-[var(--dk-ink)] ${className}`}
    >
      {/* Grid. 56px cells, barely visible — it reads as texture, not as a table. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px)," +
            "linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          // Fade the grid out at the edges so it never collides with the
          // section boundary as a hard line.
          maskImage: "radial-gradient(ellipse 100% 80% at 50% 0%, #000 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 100% 80% at 50% 0%, #000 40%, transparent 100%)",
        }}
      />
      {children}
    </div>
  );
}

/**
 * Drifting particles.
 *
 * Rendered as a handful of absolutely-positioned dots animated with CSS
 * keyframes rather than JS — no rAF loop, no per-frame React work. Positions
 * come from a seeded sequence so the layout is stable between renders, and
 * the whole thing returns null under reduced motion.
 */
export function Particles({ count = 18 }: { count?: number }) {
  const calm = useCalm();

  const dots = useMemo(() => {
    // A small LCG: deterministic, so React re-renders don't reshuffle the sky.
    let seed = 20261106;
    const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    return Array.from({ length: count }, () => ({
      left: next() * 100,
      top: next() * 100,
      size: 1 + next() * 2,
      delay: next() * 8,
      duration: 7 + next() * 9,
      cyan: next() > 0.5,
    }));
  }, [count]);

  if (calm) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full will-change-transform"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: d.size,
            height: d.size,
            background: d.cyan ? "var(--dk-cyan)" : "var(--dk-violet)",
            opacity: 0.5,
            animation: `ads-drift ${d.duration}s ease-in-out ${d.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/** A soft colour glow. Purely decorative. */
export function Glow({
  className = "",
  color = "var(--dk-blue)",
  size = 420,
}: { className?: string; color?: string; size?: number }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{ width: size, height: size, background: color, opacity: 0.16, filter: "blur(110px)" }}
    />
  );
}

/** Section heading in the dark style: badge, two-tone title, subtitle. */
export function DarkHead({
  badge, title, accent, subtitle, align = "center",
}: {
  badge?: string;
  title: string;
  /** Rendered in the gradient, after `title`. */
  accent?: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  const centred = align === "center";
  return (
    <div className={centred ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {badge && (
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--dk-line)] bg-[var(--dk-panel)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--dk-cyan)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--dk-cyan)]" aria-hidden />
          {badge}
        </span>
      )}
      <h2 className={`h2 text-[var(--dk-ink)] ${badge ? "mt-4" : ""}`}>
        {title}
        {accent && (
          <>
            {" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: DK_GRADIENT }}>
              {accent}
            </span>
          </>
        )}
      </h2>
      {subtitle && (
        <p className={`mt-3 text-[15px] leading-relaxed text-[var(--dk-muted)] ${centred ? "mx-auto" : ""}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** Platform label + its accent colour. Unknown platforms fall back rather
 *  than disappearing, so an admin-added value still renders. */
export const PLATFORM_META: Record<string, { label: string; bg: string }> = {
  meta: { label: "Meta", bg: "#1877F2" },
  google: { label: "Google", bg: "#EA8600" },
  linkedin: { label: "LinkedIn", bg: "#0A66C2" },
  email: { label: "Email", bg: "#7C3AED" },
  youtube: { label: "YouTube", bg: "#DC2626" },
  whatsapp: { label: "WhatsApp", bg: "#16A34A" },
  other: { label: "Campaign", bg: "#334155" },
};
export const platformMeta = (p: string) => PLATFORM_META[p] ?? PLATFORM_META.other;

/** Acronyms that title-casing would mangle ("Seo", "Ppc"). Extend as needed;
 *  anything absent simply title-cases, which is right for ordinary words. */
const ACRONYMS = new Set(["seo", "ppc", "sem", "ui", "ux", "b2b", "b2c", "crm", "roi", "sms"]);

/** Turn a category slug into something readable without needing a lookup
 *  table per category, so a new admin category is never shown as raw
 *  kebab-case and "seo" is never shown as "Seo". */
export const prettyCategory = (c: string) =>
  c
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
