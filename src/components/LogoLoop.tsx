import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ============================================================
// LogoLoop — a seamless, dependency-free horizontal logo marquee.
//
// Two copies of the logo set share one track that translates by exactly -50%,
// so the loop is continuous with no visible restart. `speed` is in px/second;
// the duration is derived from the measured width so it stays constant
// regardless of how many logos are shown. Honors prefers-reduced-motion
// (renders a static, wrapping row instead of animating).
//
// Each logo may be an image ({ src, alt }) or arbitrary content ({ node,
// alt }); the consumer decides what a "logo" looks like (e.g. a card).
// ============================================================

export interface LogoItem {
  src?: string;
  node?: ReactNode;
  alt: string;
}

export function LogoLoop({
  logos,
  speed = 70,
  direction = "left",
  logoHeight = 50,
  gap = 28,
  hoverSpeed = 0,
  scaleOnHover = false,
  fadeOut = false,
  fadeOutColor = "#ffffff",
  ariaLabel = "Logos",
}: {
  logos: LogoItem[];
  /** pixels per second */
  speed?: number;
  direction?: "left" | "right";
  logoHeight?: number;
  /** px between logos */
  gap?: number;
  /** 0 = pause on hover; any other value currently just means "don't pause" */
  hoverSpeed?: number;
  scaleOnHover?: boolean;
  fadeOut?: boolean;
  fadeOutColor?: string;
  ariaLabel?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [durationSec, setDurationSec] = useState(20);
  const pauseOnHover = hoverSpeed === 0;

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Duration = one-set width / speed, so movement is a constant px/s.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const oneSet = el.scrollWidth / 3; // the track holds three copies
      if (oneSet > 0) setDurationSec(Math.max(oneSet / Math.max(speed, 1), 4));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [speed, logos, gap, logoHeight]);

  const items = [...logos, ...logos, ...logos]; // duplicate for a seamless -50% loop

  return (
    <div
      className="group relative w-full overflow-hidden"
      role="region"
      aria-label={ariaLabel}
    >
      <div
        ref={trackRef}
        className={`flex max-w-[1400px] items-center ${scaleOnHover ? "logoloop-track" : ""}`}
        style={{
          gap: `6px`,
          ...(reduceMotion
            ? {}
            : {
                animationName: "logoloop",
                animationDuration: `${durationSec}s`,
                animationTimingFunction: "linear",
                animationIterationCount: "infinite",
                animationDirection: direction === "right" ? "reverse" : "normal",
                animationPlayState: "running",
              }),
        }}
        // Pause on hover when hoverSpeed is 0.
        onMouseEnter={(e) => { if (pauseOnHover && !reduceMotion) e.currentTarget.style.animationPlayState = "paused"; }}
        onMouseLeave={(e) => { if (pauseOnHover && !reduceMotion) e.currentTarget.style.animationPlayState = "running"; }}
      >
        {items.map((logo, i) => (
          <div
            key={i}
            aria-hidden={i >= logos.length}
            className={`shrink-0 transition-transform duration-300 ${scaleOnHover ? "hover:scale-[1.05]" : ""}`}
            style={{ height: logoHeight }}
          >
            {logo.node ?? (
              <img
                src={logo.src}
                alt={logo.alt}
                loading="lazy"
                decoding="async"
                style={{ height: logoHeight, width: "auto", objectFit: "contain" }}
                className="max-w-none select-none"
                draggable={false}
              />
            )}
          </div>
        ))}
      </div>

      {/* Soft edge fades so logos don't hard-clip at the sides. */}
      {fadeOut && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28"
            style={{ background: `linear-gradient(to right, ${fadeOutColor}, transparent)` }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28"
            style={{ background: `linear-gradient(to left, ${fadeOutColor}, transparent)` }}
            aria-hidden
          />
        </>
      )}
    </div>
  );
}

export default LogoLoop;
