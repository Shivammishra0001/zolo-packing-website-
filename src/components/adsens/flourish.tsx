import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useCalm } from "./dark";

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
        // On white the edge has to be a visible hairline, not a glow: the
        // dark version's translucent whites vanished completely.
        background:
          "linear-gradient(145deg, rgba(14,116,144,0.30), rgba(37,99,235,0.16) 38%, rgba(15,23,42,0.10) 62%, rgba(124,58,237,0.26))",
        boxShadow: glow
          ? "0 18px 48px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.04)"
          : "0 1px 3px rgba(15,23,42,0.04)",
      }}
    >
      <div className="h-full w-full overflow-hidden rounded-[17px] bg-[var(--dk-bg)]">{children}</div>
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
export const PLATE_FILTER = { filter: "saturate(1.04) contrast(1.03)" } as const;

export function PlateTint() {
  return (
    <>
      {/* A whisper of the brand gradient so the photographs read as one set
          rather than a dozen unrelated studio shots. On the dark page this
          was a heavy multiply tint plus a vignette; on white the plates
          already sit correctly, so all that is left is the unifying wash. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-multiply"
        style={{ backgroundImage: "linear-gradient(150deg, var(--dk-cyan), var(--dk-violet))" }}
      />
    </>
  );
}

