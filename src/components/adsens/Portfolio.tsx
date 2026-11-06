import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { DK_GRADIENT, DarkHead, Glow, prettyCategory, useCalm } from "./dark";
import { GradientFrame, Orbit, PLATE_FILTER, PlateTint, useReveal } from "./flourish";
import { plateAt } from "./showcase-art";
import { assetUrl } from "../../lib/asset-url";
import type { AdsensCaseStudyCard } from "../../lib/api/adsens";

/* =========================================================
   Our Portfolio.

   Three columns on desktop with category filters that update the grid in
   place — no navigation, no refetch.

   The filter chips are built from the categories the SERVER derived from
   published work. The brief lists eight suggested filters; offering all
   eight when six have nothing behind them would advertise a portfolio we do
   not have, so the list is whatever exists, plus "All".
   ========================================================= */

export function Portfolio({
  caseStudies,
  categories,
  onOpen,
}: {
  caseStudies: AdsensCaseStudyCard[];
  categories: string[];
  onOpen: (slug: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const calm = useCalm();
  const scope = useReveal<HTMLDivElement>("[data-port]", { y: 28, stagger: 0.06 });

  const shown = useMemo(
    () => (filter === "all" ? caseStudies : caseStudies.filter((c) => c.category === filter)),
    [caseStudies, filter],
  );

  if (caseStudies.length === 0) return null;

  return (
    <section id="portfolio" className="relative scroll-mt-20 border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="-right-20 top-24" color="var(--dk-violet)" size={430} />
      <Orbit className="absolute right-6 top-6 hidden text-[var(--dk-violet)] opacity-40 xl:block" size={220} />

      <div ref={scope} className="shell relative">
        <DarkHead
          title="Our"
          accent="Portfolio"
          subtitle="Real work, creative thinking and digital experiences designed around business goals."
        />

        {categories.length > 1 && (
          <div
            role="group"
            aria-label="Filter portfolio by category"
            className="mt-7 flex flex-wrap justify-center gap-2"
          >
            <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            {categories.map((c) => (
              <FilterChip key={c} label={prettyCategory(c)} active={filter === c} onClick={() => setFilter(c)} />
            ))}
          </div>
        )}

        <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c, i) => (
            <motion.div
              key={c.id}
              data-port
              // Re-fade on filter change (the key includes the filter), which
              // is cheaper than `layout` animating every card every time.
              initial={calm ? undefined : { opacity: 0, y: 12 }}
              animate={calm ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.24) }}
            >
              <PortfolioCard item={c} index={i} onOpen={onOpen} calm={calm} />
            </motion.div>
          ))}
        </div>

        {/* A filter matching nothing can only happen transiently, but the
            visitor still deserves a sentence rather than a blank. */}
        {shown.length === 0 && (
          <p className="mt-10 text-center text-sm text-[var(--dk-muted)]">
            Nothing published under {prettyCategory(filter)} yet.{" "}
            <button onClick={() => setFilter("all")} className="font-semibold text-[var(--dk-cyan)] hover:underline">
              Show all work
            </button>
          </p>
        )}
      </div>
    </section>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 rounded-full px-4 text-[13px] font-semibold transition-all ${
        active
          ? "text-white shadow-[0_6px_20px_rgba(45,212,191,0.3)]"
          : "border border-[var(--dk-line)] bg-[var(--dk-panel)] text-[var(--dk-muted)] hover:border-[var(--dk-line-2)] hover:text-[var(--dk-ink)]"
      }`}
      style={active ? { backgroundImage: DK_GRADIENT } : undefined}
    >
      {label}
    </button>
  );
}

function PortfolioCard({
  item: c,
  index,
  onOpen,
  calm,
}: {
  item: AdsensCaseStudyCard;
  index: number;
  onOpen: (slug: string) => void;
  calm: boolean;
}) {
  const plate = plateAt(index + 4);
  const img = assetUrl(c.coverImage) ?? plate.src;

  return (
    <button type="button" onClick={() => onOpen(c.slug)} className="block h-full w-full text-left">
      <GradientFrame
        className={`group flex h-full flex-col transition-transform duration-300 ${calm ? "" : "hover:-translate-y-1.5"}`}
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--dk-bg)]">
          <img
            src={img}
            alt={c.coverImage ? c.title : plate.alt}
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-[600ms] ease-out ${calm ? "" : "group-hover:scale-[1.06]"}`}
            style={PLATE_FILTER}
          />
          <PlateTint />
          {/* Verified work earns a corner flag; unverified does not, so the
              badge stays meaningful. */}
          {c.resultsVerified && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg">
              <BadgeCheck className="h-3 w-3" aria-hidden /> Verified
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-center justify-between gap-3">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
              style={{ backgroundImage: DK_GRADIENT }}
            >
              {prettyCategory(c.category)}
            </span>
            {c.clientName && <span className="truncate text-xs text-[var(--dk-faint)]">{c.clientName}</span>}
          </div>

          <h3 className="mt-3 text-[15px] font-bold text-[var(--dk-ink)]">{c.title}</h3>
          {c.summary && <p className="mt-1.5 text-sm leading-relaxed text-[var(--dk-muted)]">{c.summary}</p>}

          <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-bold text-[var(--dk-cyan)]">
            View Case Study
            <ArrowRight className={`h-4 w-4 transition-transform ${calm ? "" : "group-hover:translate-x-1"}`} aria-hidden />
          </span>
        </div>
      </GradientFrame>
    </button>
  );
}
