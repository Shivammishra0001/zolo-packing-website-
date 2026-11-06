import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Megaphone, Package } from "lucide-react";
import { DK_GRADIENT, Glow, Particles, platformMeta, useCalm } from "./dark";
import { GradientFrame, Orbit, PLATE_FILTER, PlateTint, useReveal } from "./flourish";
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

const INDICATORS = [
  { k: "Packaging + marketing", v: "One partner" },
  { k: "Services offered", v: "8" },
  { k: "Minimum engagement", v: "1 service" },
  { k: "Campaign reporting", v: "Always" },
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
    <section className="relative">
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
            <span
              data-hero-reveal
              className="inline-flex items-center gap-2 rounded-full border border-[var(--dk-line-2)] bg-[var(--dk-panel)] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--dk-cyan)] backdrop-blur"
            >
              <span className="relative flex h-2 w-2" aria-hidden>
                {!calm && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--dk-cyan)] opacity-70" />}
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--dk-cyan)]" />
              </span>
              Your complete business growth partner
            </span>

            <h1 data-hero-reveal className="h1 mt-5 text-[var(--dk-ink)]">
              We Pack Your Products.
              <br />
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: DK_GRADIENT }}>
                We Power Your Promotion.
              </span>
              <br />
              Everything Your Brand Needs to Grow.
            </h1>

            <p data-hero-reveal className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--dk-muted)] sm:text-base">
              From premium packaging solutions to performance-driven digital marketing, Zolo brings everything your
              business needs to build its brand, reach more customers and grow.
            </p>

            <div data-hero-reveal className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                onClick={onConsult}
                className="btn btn-lg group relative w-full justify-center overflow-hidden text-white shadow-[0_12px_38px_rgba(79,123,255,0.42)] sm:w-auto"
                style={{ backgroundImage: DK_GRADIENT }}
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
                className="btn btn-lg w-full justify-center border border-[var(--dk-line-2)] bg-[var(--dk-panel)] text-[var(--dk-ink)] backdrop-blur transition-colors hover:border-[var(--dk-cyan)]/50 hover:bg-[var(--dk-panel-2)] sm:w-auto"
              >
                Explore Our Work
              </button>
            </div>

            <dl data-hero-reveal className="mt-10 grid max-w-xl grid-cols-2 items-start gap-x-6 gap-y-5 sm:grid-cols-4">
              {INDICATORS.map((x) => (
                <div key={x.k} className="min-w-0">
                  <dt className="sr-only">{x.k}</dt>
                  <dd>
                    <span
                      className="block bg-clip-text font-display text-lg font-extrabold leading-tight text-transparent sm:text-xl"
                      style={{ backgroundImage: DK_GRADIENT }}
                    >
                      {x.v}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--dk-faint)]">{x.k}</span>
                  </dd>
                </div>
              ))}
            </dl>
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
          className="mt-12 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded-2xl border border-[var(--dk-line)] bg-[var(--dk-panel)] px-5 py-4 text-center backdrop-blur sm:mt-14"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--dk-ink)]">
            <Package className="h-4 w-4 text-[var(--dk-cyan)]" aria-hidden /> Zolo Packaging
          </span>
          <span className="text-[var(--dk-faint)]" aria-hidden>+</span>
          <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--dk-ink)]">
            <Megaphone className="h-4 w-4 text-[var(--dk-violet)]" aria-hidden /> AdSens Digital Marketing
          </span>
          <span className="w-full text-xs text-[var(--dk-faint)] sm:w-auto sm:border-l sm:border-[var(--dk-line)] sm:pl-4">
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
    <GradientFrame glow className="relative">
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
        <div className="overflow-hidden rounded-[13px] bg-[var(--dk-bg)]">
          <div className="relative aspect-[4/3] w-full">
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
            <dl className="divide-y divide-[var(--dk-line)] px-4">
              {c.metrics.map((m) => (
                <div key={m.label} className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="text-xs text-[var(--dk-faint)]">{m.label}</dt>
                  <dd className="text-sm font-bold text-[var(--dk-cyan)]">{m.value}</dd>
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
                  className={`h-1.5 rounded-full transition-all ${n === i ? "w-6" : "w-1.5 bg-[var(--dk-line-2)]"}`}
                  style={n === i ? { backgroundImage: DK_GRADIENT } : undefined}
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
    </GradientFrame>
  );
}

function PreviewNav({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--dk-line)] bg-[var(--dk-panel)] text-[var(--dk-muted)] transition-colors hover:border-[var(--dk-cyan)]/50 hover:bg-[var(--dk-panel-2)] hover:text-[var(--dk-ink)]"
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
    <GradientFrame glow className="relative">
      <span className="absolute -top-3 right-5 z-20 rounded-full border border-[var(--dk-line-2)] bg-[var(--dk-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--dk-muted)]">
        Sample creative
      </span>
      <div className="p-2.5">
        <div className="overflow-hidden rounded-[13px] bg-[var(--dk-bg)]">
          <div className="relative aspect-[4/3] w-full">
            <img src={plate.src} alt={plate.alt} className="h-full w-full object-cover" loading="eager" style={PLATE_FILTER} />
            <PlateTint />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-28" style={{ background: "linear-gradient(to top, rgba(2,6,23,0.88), rgba(2,6,23,0.52) 48%, transparent)" }} />
            <div className="absolute inset-x-4 bottom-3">
              <p className="text-[11px] uppercase tracking-wider text-[var(--dk-cyan)]">Zolo packaging</p>
              <p className="text-[15px] font-bold text-white">{plate.craft}</p>
            </div>
          </div>
          <p className="px-4 py-3.5 text-[13px] leading-relaxed text-[var(--dk-muted)]">
            Campaign previews appear here. We show real creatives from campaigns we are running, with the client's
            permission — nothing is published until there is genuine work to show.
          </p>
        </div>
      </div>
    </GradientFrame>
  );
}
