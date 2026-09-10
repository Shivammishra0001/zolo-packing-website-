import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ============================================================
// LogoLoop — a seamless, dependency-free horizontal logo marquee.
//
// The track is filled with as many identical copies of the logo set as are
// needed to more than cover the viewport, then animated (Web Animations API)
// by EXACTLY one set width. Because every copy is identical and contiguous,
// translating by one set width lands on a pixel-identical frame, so the loop
// is perfectly seamless for any number of logos and any container width — it
// always spans full width with no gap. Honors prefers-reduced-motion.
//
// Each logo may be an image ({ src, alt }) or arbitrary content ({ node,
// alt }); the consumer decides what a "logo" looks like.
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
  logoHeight = 92,
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
  /** max logo height in px; scales down responsively on small screens */
  logoHeight?: number;
  /** px between logos (uniform, including across the seam) */
  gap?: number;
  /** 0 = pause on hover; any other value means "don't pause" */
  hoverSpeed?: number;
  scaleOnHover?: boolean;
  fadeOut?: boolean;
  fadeOutColor?: string;
  ariaLabel?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const [setW, setSetW] = useState(0);
  const [copies, setCopies] = useState(2);
  const pauseOnHover = hoverSpeed === 0;

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Responsive per-logo height: never taller than logoHeight, smaller on
  // narrow screens so more than one or two logos are always visible.
  const itemHeight = `clamp(60px, 15vw, ${logoHeight}px)`;

  // Measure one set width from the ACTUAL laid-out offset of the first item of
  // the second set (children[logos.length]). Because the gap lives on the flex
  // container, every gap — inside a set and across the seam — is identical, and
  // this offset is exactly one set + one gap, so the wrap is perfectly even.
  // Then pick enough copies to overfill the viewport (+1 spare set).
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const track = trackRef.current;
    if (!vp || !track) return;
    const compute = () => {
      const first = track.children[0] as HTMLElement | undefined;
      const marker = track.children[logos.length] as HTMLElement | undefined;
      if (!first || !marker) return;
      const w = marker.offsetLeft - first.offsetLeft;
      const vpW = vp.clientWidth;
      if (w <= 0 || vpW <= 0) return;
      setSetW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
      setCopies((prev) => {
        const next = Math.max(2, Math.ceil(vpW / w) + 1);
        return prev === next ? prev : next;
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(vp);
    ro.observe(track);
    // Logo images can change width after they decode — re-measure on load.
    track.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", compute, { once: true });
    });
    window.addEventListener("resize", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, [logos, gap, logoHeight, copies]);

  // Drive the marquee with the Web Animations API — exact pixel translation of
  // one set width, so speed stays constant (px/s) and the wrap is seamless.
  useEffect(() => {
    const track = trackRef.current;
    animRef.current?.cancel();
    if (!track || reduceMotion || setW <= 0) return;
    const duration = (setW / Math.max(speed, 1)) * 1000;
    const frames =
      direction === "right"
        ? [{ transform: `translateX(${-setW}px)` }, { transform: "translateX(0px)" }]
        : [{ transform: "translateX(0px)" }, { transform: `translateX(${-setW}px)` }];
    const anim = track.animate(frames, { duration, iterations: Infinity, easing: "linear" });
    animRef.current = anim;
    return () => anim.cancel();
  }, [setW, speed, direction, reduceMotion, copies]);

  // One flat row of (copies × logos). The gap lives on this flex container, so
  // spacing is uniform between every pair of logos — including at each seam.
  const items = Array.from({ length: copies }, (_, c) => c).flatMap((c) =>
    logos.map((logo, i) => ({ logo, key: `${c}-${i}`, aria: c !== 0 })),
  );

  return (
    <div
      ref={viewportRef}
      className="group relative w-full overflow-hidden"
      role="region"
      aria-label={ariaLabel}
      onMouseEnter={() => { if (pauseOnHover) animRef.current?.pause(); }}
      onMouseLeave={() => { if (pauseOnHover) animRef.current?.play(); }}
    >
      <div
        ref={trackRef}
        className="flex w-max items-center will-change-transform"
        style={{ gap: `${gap}px` }}
      >
        {items.map(({ logo, key, aria }) => (
          <div
            key={key}
            aria-hidden={aria}
            className={`flex shrink-0 items-center transition-transform duration-300 ${scaleOnHover ? "hover:scale-[1.06]" : ""}`}
            style={{ height: itemHeight }}
          >
            {logo.node ?? (
              <img
                src={logo.src}
                alt={logo.alt}
                loading="lazy"
                decoding="async"
                className="h-full w-auto max-w-none select-none object-contain"
                draggable={false}
              />
            )}
          </div>
        ))}
      </div>

      {/* Soft edge fades so logos ease in/out at the two ends. */}
      {fadeOut && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 sm:w-24"
            style={{ background: `linear-gradient(to right, ${fadeOutColor}, transparent)` }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 sm:w-24"
            style={{ background: `linear-gradient(to left, ${fadeOutColor}, transparent)` }}
            aria-hidden
          />
        </>
      )}
    </div>
  );
}

export default LogoLoop;
