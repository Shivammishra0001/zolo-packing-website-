import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/* =========================================================
   Shared AdSens primitives.

   These exist so the nine sections share one heading rhythm and one reveal,
   rather than each re-deriving them. They deliberately use the app's own
   utilities (.h2, .lead, .eyebrow, .card) so the page inherits the Zolo
   theme instead of introducing a second design system.
   ========================================================= */

export const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
};

export const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
export const viewportOnce = { once: true, amount: 0.15 } as const;

/**
 * Scroll reveal that collapses to a plain div under reduced motion, so the
 * content is simply present rather than animating in.
 */
export function Reveal({
  children, className, as = "div",
}: { children: ReactNode; className?: string; as?: "div" | "li" | "article" }) {
  const calm = useReducedMotion();
  const M = motion[as];
  if (calm) return <M className={className}>{children}</M>;
  return <M variants={fadeUp} className={className}>{children}</M>;
}

/** A staggered group; under reduced motion the stagger simply does not run. */
export function RevealGroup({
  children, className, as = "div",
}: { children: ReactNode; className?: string; as?: "div" | "ul" | "ol" }) {
  const calm = useReducedMotion();
  const M = motion[as];
  if (calm) return <M className={className}>{children}</M>;
  return (
    <M variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className={className}>
      {children}
    </M>
  );
}

/**
 * Section heading. The reference colours one word of each heading; the Zolo
 * system reserves orange for conversion CTAs, so the accent here is the brand
 * green used by .eyebrow elsewhere in the app.
 */
export function SectionHead({
  eyebrow, title, accent, subtitle, centred = true, id,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  subtitle?: string;
  centred?: boolean;
  id?: string;
}) {
  return (
    <div className={centred ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {eyebrow && (
        <span className={`eyebrow flex items-center gap-2.5 ${centred ? "justify-center" : ""}`}>
          <span className="h-0.5 w-5 rounded-full bg-green-500" aria-hidden />
          {eyebrow}
        </span>
      )}
      <h2 id={id} className="h2 mt-3 text-dark-900">
        {title} {accent && <span className="text-green-500">{accent}</span>}
      </h2>
      {subtitle && <p className="lead mt-3">{subtitle}</p>}
    </div>
  );
}
