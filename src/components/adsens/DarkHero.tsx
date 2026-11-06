import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Megaphone, Package, PlayCircle, Sparkles, TrendingUp, Users } from "lucide-react";
import { Glow, Particles, platformMeta, useCalm } from "./dark";
import { Orbit, PLATE_FILTER, PlateTint, useReveal } from "./flourish";
import { plateAt } from "./showcase-art";
import { assetUrl } from "../../lib/asset-url";
import type { AdsensCampaign } from "../../lib/api/adsens";

/* =========================================================
   AdSens hero.

   Left: positioning line, two CTAs, four indicators.
   Right: a floating campaign preview card with carousel controls.

   ON THE NUMBERS: the reference hero carries "250+ Clients Served",
   "3.2x ROI Multiplier", "15+ Years Experience", "98% Client Satisfaction".
   All four are invented, and printing them on zolopacking.com would be a
   false claim about this business. The indicator row keeps the same visual
   rhythm — four gradient values over small labels — using facts about the
   OFFER, which are true and need no evidence we do not have.

   The preview card is driven by published campaigns. With none published it
   falls back to a labelled Zolo packaging photograph rather than a
   fabricated analytics dashboard.
   ========================================================= */

/**
 * Four service areas, per the mockup — icon over a two-word label.
 *
 * Deliberately NOT statistics. The agency references this design came from
 * fill this row with "250+ Clients Served" and "98% Client Satisfaction";
 * both would be invented. Naming what AdSens does needs no evidence and
 * tells the visitor more.
 */
const INDICATORS = [
  { icon: Package, label: "Packaging\nSolutions" },
  { icon: Megaphone, label: "Digital\nAdvertising" },
  { icon: TrendingUp, label: "Brand\nGrowth" },
  { icon: Users, label: "Lead\nGeneration" },
];

export function DarkHero({
  campaigns,
  onConsult,
  onExplore,
}: {
  campaigns: AdsensCampaign[];
  onConsult: () => void;
  onExplore: () => void;
}) {
  const calm = useCalm();
  const scope = useReveal<HTMLDivElement>("[data-hero-reveal]", { y: 22, stagger: 0.08 });

  return (
    /* The hero and the Zolo Advantage section are the two DARK bands on an
       otherwise light page, per the mockup. The band is local to this
       section rather than a palette change: --dk-* stays light so every
       other section keeps its tokens, and the few elements inside here that
       need light-on-dark say so explicitly. */
    <section className="relative isolate overflow-hidden bg-[#0B1220] text-white">
      {/* Warm orange bloom bottom-right, as in the mockup. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/3 h-[520px] w-[520px] rounded-full"
        style={{ background: "var(--dk-orange)", opacity: 0.18, filter: "blur(130px)" }}
      />
      <Glow className="-left-32 -top-24" color="var(--dk-blue)" size={480} />
      <Glow className="-right-24 top-40" color="var(--dk-violet)" size={430} />
      <Glow className="bottom-0 left-1/3" color="var(--dk-cyan)" size={360} />
      <Particles count={26} />

      {/* The orbit graphic from the reference, parked behind the preview. */}
      <Orbit className="absolute -right-20 top-8 hidden text-[var(--dk-cyan)] opacity-50 xl:block" size={360} />

      <div ref={scope} className="shell relative py-14 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.03fr_0.97fr] lg:gap-14">
          {/* ---------- Left ---------- */}
          <div>
            {/* Brand chip + descriptor, per the mockup. The solid orange
                carries the Zolo identity; the outlined half says what this
                business unit is. */}
            <div data-hero-reveal className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--dk-orange)] px-3 py-1.5 text-[11px] font-bold text-white">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                AdSens by Zolo
              </span>
              <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/80 backdrop-blur">
                Performance Marketing Agency
              </span>
            </div>

            <h1 data-hero-reveal className="h1 mt-5 text-white">
              We Pack Your Products.
              <br />
              <span className="text-[var(--dk-orange)]">We Power Your Promotion.</span>
            </h1>

            {/* The supporting line is a separate, lighter weight in the
                mockup — it reads as a subhead rather than a third headline
                clause. Kept inside the h1's block but outside the element,
                so the page still has exactly one h1. */}
            <p data-hero-reveal className="mt-3 text-xl font-bold text-white/90 sm:text-2xl">
              Everything Your Brand Needs to Grow.
            </p>

            <p data-hero-reveal className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/65">
              From premium packaging solutions to performance-driven digital marketing, we help businesses build
              stronger brands, reach the right audience and grow their online presence.
            </p>

            <div data-hero-reveal className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                onClick={onConsult}
                className="btn btn-lg btn-primary group relative w-full justify-center overflow-hidden sm:w-auto"
              >
                {/* Sheen sweep on hover — the reference's glossy CTA. */}
                {!calm && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                )}
                <span className="relative inline-flex items-center gap-2">
                  Get Your Free Strategy Call <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </button>
              <button
                onClick={onExplore}
                className="btn btn-lg w-full justify-center gap-2 border border-white/25 bg-white/5 text-white backdrop-blur transition-colors hover:bg-white/10 sm:w-auto"
              >
                View Our Work <PlayCircle className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <ul data-hero-reveal className="mt-10 grid max-w-xl grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
              {INDICATORS.map((x, i) => (
                <li
                  key={x.label}
                  className={`flex items-center gap-2.5 ${i > 0 ? "sm:border-l sm:border-white/15 sm:pl-5" : ""}`}
                >
                  <x.icon className="h-5 w-5 shrink-0 text-[var(--dk-orange)]" aria-hidden />
                  <span className="whitespace-pre-line text-[13px] font-semibold leading-tight text-white/85">
                    {x.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* ---------- Right ---------- */}
          <motion.div
            initial={calm ? undefined : { opacity: 0, scale: 0.95, y: 20 }}
            animate={calm ? undefined : { opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <HeroPreview campaigns={campaigns} />
          </motion.div>
        </div>

        {/* Packaging + promotion, stated once before the visitor scrolls. */}
        <div
          data-hero-reveal
          className="mt-12 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded-2xl border border-white/15 bg-white/[0.05] px-5 py-4 text-center backdrop-blur sm:mt-14"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
            <Package className="h-4 w-4 text-[var(--dk-orange)]" aria-hidden /> Zolo Packaging
          </span>
          <span className="text-white/40" aria-hidden>+</span>
          <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
            <Megaphone className="h-4 w-4 text-[var(--dk-orange)]" aria-hidden /> AdSens Digital Marketing
          </span>
          <span className="w-full text-xs text-white/55 sm:w-auto sm:border-l sm:border-white/15 sm:pl-4">
            Packaging and marketing are quoted and billed separately.
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------- the preview card ---------- */

function HeroPreview({ campaigns }: { campaigns: AdsensCampaign[] }) {
  const [i, setI] = useState(0);
  const calm = useCalm();

  useEffect(() => { setI((v) => (campaigns.length ? v % campaigns.length : 0)); }, [campaigns.length]);

  if (campaigns.length === 0) return <PreviewPlaceholder />;

  const c = campaigns[Math.min(i, campaigns.length - 1)];
  const pm = platformMeta(c.platform);
  const step = (d: number) => setI((v) => (v + d + campaigns.length) % campaigns.length);

  return (
    <DarkPanel>
      {/* Floating status pill, as in the reference. Only a genuine live
          campaign gets it: `status` is already "illustrative" for any sample,
          because the server rewrites it before sending. */}
      {c.status === "live" ? (
        <span className="absolute -top-3 right-5 z-20 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_6px_20px_rgba(16,185,129,0.5)]">
          <span className={`h-1.5 w-1.5 rounded-full bg-white ${calm ? "" : "animate-pulse"}`} aria-hidden />
          Live running ads
        </span>
      ) : c.isIllustrative ? (
        <span className="absolute -top-3 right-5 z-20 rounded-full border border-[var(--dk-line-2)] bg-[var(--dk-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--dk-muted)]">
          Illustrative preview
        </span>
      ) : null}

      <div className="p-2.5">
        <div className="overflow-hidden rounded-[13px] bg-[#070C16]">
          <div className="relative aspect-[4/3] w-full bg-[#070C16]">
            <img
              src={assetUrl(c.imageUrl) ?? plateAt(i).src}
              alt={c.title}
              className="h-full w-full object-cover"
              loading="eager"
              style={PLATE_FILTER}
            />
            <PlateTint />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-28" style={{ background: "linear-gradient(to top, rgba(2,6,23,0.88), rgba(2,6,23,0.52) 48%, transparent)" }} />
            <span
              className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg"
              style={{ background: pm.bg }}
            >
              {pm.label}
            </span>
            <div className="absolute inset-x-4 bottom-3">
              {c.clientName && <p className="text-[11px] text-white/70">{c.clientName}</p>}
              <p className="truncate text-[15px] font-bold text-white">{c.title}</p>
            </div>
          </div>

          {c.metrics.length > 0 && (
            <dl className="divide-y divide-white/10 px-4">
              {c.metrics.map((m) => (
                <div key={m.label} className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="text-xs text-white/55">{m.label}</dt>
                  <dd className="text-sm font-bold text-[var(--dk-orange)]">{m.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {campaigns.length > 1 && (
          <div className="flex items-center justify-between px-1.5 pb-0.5 pt-3">
            <div className="flex gap-1.5">
              {campaigns.map((x, n) => (
                <button
                  key={x.id}
                  onClick={() => setI(n)}
                  aria-label={`Show ${x.title}`}
                  aria-current={n === i}
                  className={`h-1.5 rounded-full transition-all ${n === i ? "w-6 bg-[var(--dk-orange)]" : "w-1.5 bg-white/25"}`}
                  
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              <PreviewNav label="Previous campaign" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" aria-hidden /></PreviewNav>
              <PreviewNav label="Next campaign" onClick={() => step(1)}><ChevronRight className="h-4 w-4" aria-hidden /></PreviewNav>
            </div>
          </div>
        )}
      </div>
    </DarkPanel>
  );
}

/**
 * Shell for the hero preview. GradientFrame is the light-page card and its
 * white inner fill reads as a pale slab inside this dark band, so the hero
 * carries its own: dark surface, hairline white border, orange-tinted glow.
 */
function DarkPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative rounded-[20px] border border-white/15 bg-white/[0.04] p-2.5 backdrop-blur"
      style={{ boxShadow: "0 30px 80px rgba(0,0,0,0.45), 0 0 60px rgba(249,115,22,0.10)" }}
    >
      {children}
    </div>
  );
}

function PreviewNav({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

/**
 * Shown when no campaign is published.
 *
 * The reference fills this slot with an analytics dashboard reading "#1
 * Ranking", "89K Visits", "3.8x ROAS". Every figure would be invented, so
 * this shows Zolo's own packaging instead — a real photograph of a real
 * product, captioned as the sample it is — and says what the slot is for.
 */
function PreviewPlaceholder() {
  const plate = plateAt(0);
  return (
    <DarkPanel>
      <span className="absolute -top-3 right-5 z-20 rounded-full border border-[var(--dk-line-2)] bg-[var(--dk-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--dk-muted)]">
        Sample creative
      </span>
      <div className="p-2.5">
        <div className="overflow-hidden rounded-[13px] bg-[#070C16]">
          <div className="relative aspect-[4/3] w-full bg-[#070C16]">
            <img src={plate.src} alt={plate.alt} className="h-full w-full object-cover" loading="eager" style={PLATE_FILTER} />
            <PlateTint />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-28" style={{ background: "linear-gradient(to top, rgba(2,6,23,0.88), rgba(2,6,23,0.52) 48%, transparent)" }} />
            <div className="absolute inset-x-4 bottom-3">
              <p className="text-[11px] uppercase tracking-wider text-[var(--dk-orange)]">Zolo packaging</p>
              <p className="text-[15px] font-bold text-white">{plate.craft}</p>
            </div>
          </div>
          <p className="px-4 py-3.5 text-[13px] leading-relaxed text-white/65">
            Campaign previews appear here. We show real creatives from campaigns we are running, with the client's
            permission — nothing is published until there is genuine work to show.
          </p>
        </div>
      </div>
    </DarkPanel>
  );
}
