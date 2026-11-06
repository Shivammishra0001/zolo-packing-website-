import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useCalm } from "./dark";
import { RIBBON_WORDS } from "./showcase-art";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/* =========================================================
   Decorative flourishes for the AdSens showcase: ribbons, the orbit
   graphic, gradient frames and the scroll-reveal hook.

   All of it is transform/opacity only, so it stays on the compositor, and
   all of it is inert under `prefers-reduced-motion` — the reveal hook sets
   the final state immediately rather than animating to it, and the marquees
   stop scrolling (CSS `animation-play-state` plus a JS guard).
   ========================================================= */

/**
 * Scroll-reveal a container's children, GSAP-style.
 *
 * Returns a ref to spread on the wrapper. Children matching `selector` rise
 * and fade in on a short stagger as the wrapper enters the viewport.
 *
 * `useGSAP` handles cleanup on unmount, which matters here because
 * ScrollTrigger otherwise leaves listeners behind on route changes.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  selector = "[data-reveal]",
  { y = 28, stagger = 0.07 }: { y?: number; stagger?: number } = {},
) {
  const scope = useRef<T>(null);
  const calm = useCalm();

  useGSAP(
    () => {
      const items = gsap.utils.toArray<HTMLElement>(selector);
      if (!items.length) return;

      if (calm) {
        // Final state immediately: a reduced-motion visitor must still SEE
        // the content, which a skipped animation would otherwise leave at
        // opacity 0.
        gsap.set(items, { opacity: 1, y: 0 });
        return;
      }

      gsap.from(items, {
        opacity: 0,
        y,
        duration: 0.6,
        stagger,
        ease: "power3.out",
        scrollTrigger: { trigger: scope.current, start: "top 82%", once: true },
      });
    },
    { scope, dependencies: [calm] },
  );

  return scope;
}

/**
 * A scrolling ribbon of service names.
 *
 * Two identical tracks sit side by side and the pair translates by exactly
 * -50%, so the loop is seamless without measuring anything. Duplicated text
 * is hidden from assistive tech; the first copy carries the meaning.
 */
export function Ribbon({
  reverse = false,
  tone = "gradient",
  className = "",
}: {
  reverse?: boolean;
  tone?: "gradient" | "outline";
  className?: string;
}) {
  const calm = useCalm();
  const gradient = tone === "gradient";

  const track = (
    <span className="flex shrink-0 items-center gap-8 px-4">
      {RIBBON_WORDS.map((w) => (
        <span key={w} className="flex shrink-0 items-center gap-8">
          <span className="text-[13px] font-bold uppercase tracking-[0.16em] whitespace-nowrap">{w}</span>
          <span className="h-1.5 w-1.5 shrink-0 rotate-45 bg-current opacity-50" aria-hidden />
        </span>
      ))}
    </span>
  );

  return (
    <div
      className={`relative flex overflow-hidden border-y py-3 ${
        gradient
          ? "border-transparent text-[#05080F]"
          : "border-[var(--dk-line)] text-[var(--dk-muted)]"
      } ${className}`}
      style={gradient ? { backgroundImage: "linear-gradient(100deg,var(--dk-cyan),var(--dk-blue) 55%,var(--dk-violet))" } : undefined}
      // One ribbon's worth of text is enough for a screen reader; the visual
      // duplication is noise.
      role="presentation"
    >
      <div
        className="flex min-w-full shrink-0 will-change-transform"
        style={
          calm
            ? undefined
            : { animation: `ads-marquee ${reverse ? "38s" : "32s"} linear infinite${reverse ? " reverse" : ""}` }
        }
      >
        {track}
        <span aria-hidden className="flex">{track}</span>
      </div>
    </div>
  );
}

/**
 * The orbit graphic from the reference: concentric rings with travelling
 * dots. Pure SVG + CSS rotation, no JS per frame.
 */
export function Orbit({ className = "", size = 280 }: { className?: string; size?: number }) {
  const calm = useCalm();
  const rings = [
    { r: 46, dur: 26, dot: "var(--dk-cyan)" },
    { r: 33, dur: 19, dot: "var(--dk-violet)", reverse: true },
    { r: 20, dur: 13, dot: "var(--dk-blue)" },
  ];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden
      className={`pointer-events-none select-none ${className}`}
    >
      {rings.map((ring) => (
        <g key={ring.r}>
          <circle cx="50" cy="50" r={ring.r} fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.22" />
          <g
            style={
              calm
                ? undefined
                : {
                    transformOrigin: "50px 50px",
                    animation: `ads-spin ${ring.dur}s linear infinite${ring.reverse ? " reverse" : ""}`,
                  }
            }
          >
            <circle cx={50 + ring.r} cy="50" r="1.6" fill={ring.dot} />
          </g>
        </g>
      ))}
      <circle cx="50" cy="50" r="4" fill="currentColor" opacity="0.18" />
    </svg>
  );
}

/**
 * A card shell with the reference's hairline gradient edge.
 *
 * The border is a gradient behind the card rather than a `border-image`,
 * which Safari renders inconsistently on rounded corners.
 */
export function GradientFrame({
  children,
  className = "",
  glow = false,
}: { children: ReactNode; className?: string; glow?: boolean }) {
  return (
    <div
      className={`relative rounded-[18px] p-px ${className}`}
      style={{
        background:
          "linear-gradient(145deg, rgba(45,212,191,0.38), rgba(79,123,255,0.14) 38%, rgba(255,255,255,0.05) 62%, rgba(168,85,247,0.30))",
        boxShadow: glow ? "0 24px 70px rgba(5,8,15,0.75), 0 0 48px rgba(79,123,255,0.14)" : undefined,
      }}
    >
      <div className="h-full w-full overflow-hidden rounded-[17px] bg-[var(--dk-bg-2)]">{children}</div>
    </div>
  );
}

/**
 * Settles a light studio photograph into the dark theme.
 *
 * Zolo's product plates are shot on a near-white backdrop, which reads as a
 * pale slab against this ground. A cool multiply tint plus a screened pass of
 * the brand gradient brings them into the palette without hiding the product.
 * Spread `PLATE_FILTER` on the <img> and render <PlateTint/> as its sibling.
 */
export const PLATE_FILTER = { filter: "saturate(1.05) contrast(1.06) brightness(0.92)" } as const;

export function PlateTint() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-multiply"
        style={{ background: "linear-gradient(165deg, rgba(74,104,175,0.44), rgba(22,30,56,0.72))" }}
      />
      {/* Vignette. The reference cards are dark at every edge with the
          subject lit in the middle; a plate shot on a white sweep is the
          opposite, so this darkens the corners back down. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 78% 62% at 50% 46%, transparent 18%, rgba(5,8,15,0.80) 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-screen"
        style={{ backgroundImage: "linear-gradient(100deg,var(--dk-cyan),var(--dk-blue) 55%,var(--dk-violet))" }}
      />
    </>
  );
}

