import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, ImageOff, Megaphone, Package, Sparkles } from "lucide-react";
import { DK_GRADIENT, Glow, Particles, platformMeta, useCalm } from "./dark";
import { assetUrl } from "../../lib/asset-url";
import type { AdsensCampaign } from "../../lib/api/adsens";

/* =========================================================
   AdSens hero.

   Left: the positioning line, two CTAs and four value indicators.
   Right: a campaign preview card with carousel controls.

   The preview is driven by REAL published campaigns from the database. When
   the admin has published none, the card falls back to a plainly-labelled
   "what a campaign preview looks like" panel rather than a fabricated one
   with invented clicks and ROAS — the brief forbids presenting sample metrics
   as client results, and the reference images are made entirely of them.
   ========================================================= */

/** Four facts about the offer. Not statistics: no client counts, no ROI
 *  multiplier, no satisfaction percentage, because none of those exist. */
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
  const rise = calm ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 } };

  return (
    <section className="relative">
      <Glow className="-left-32 -top-24" color="var(--dk-blue)" size={460} />
      <Glow className="-right-24 top-40" color="var(--dk-violet)" size={420} />
      <Particles count={22} />

      <div className="shell relative py-14 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          {/* ---------- Left ---------- */}
          <motion.div {...rise} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--dk-line)] bg-[var(--dk-panel)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--dk-cyan)]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Your complete business growth partner
            </span>

            <h1 className="h1 mt-5 text-[var(--dk-ink)]">
              We Pack Your Products.
              <br />
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: DK_GRADIENT }}>
                We Power Your Promotion.
              </span>
              <br />
              Everything Your Brand Needs to Grow.
            </h1>

            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[var(--dk-muted)] sm:text-base">
              From premium packaging solutions to performance-driven digital marketing, Zolo brings everything your
              business needs to build its brand, reach more customers and grow.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                onClick={onConsult}
                className="btn btn-lg w-full justify-center text-white shadow-[0_10px_30px_rgba(79,123,255,0.35)] sm:w-auto"
                style={{ backgroundImage: DK_GRADIENT }}
              >
                Get Your Free Strategy Call <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              <button
                onClick={onExplore}
                className="btn btn-lg w-full justify-center border border-[var(--dk-line-2)] bg-[var(--dk-panel)] text-[var(--dk-ink)] hover:bg-[var(--dk-panel-2)] sm:w-auto"
              >
                Explore Our Work
              </button>
            </div>

            <dl className="mt-10 grid max-w-xl grid-cols-2 items-start gap-x-6 gap-y-5 sm:grid-cols-4">
              {INDICATORS.map((x) => (
                <div key={x.k} className="min-w-0">
                  <dt className="sr-only">{x.k}</dt>
                  <dd>
                    <span className="block font-display text-lg font-extrabold leading-tight text-[var(--dk-ink)] sm:text-xl">
                      {x.v}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--dk-faint)]">{x.k}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>

          {/* ---------- Right ---------- */}
          <motion.div
            initial={calm ? undefined : { opacity: 0, scale: 0.96 }}
            animate={calm ? undefined : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.1 }}
          >
            <HeroPreview campaigns={campaigns} />
          </motion.div>
        </div>

        {/* Packaging + promotion, stated once in the hero so the two business
            lines are connected before the visitor scrolls. */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded-2xl border border-[var(--dk-line)] bg-[var(--dk-panel)] px-5 py-4 text-center sm:mt-14">
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

  // Clamp when the list arrives or shrinks.
  useEffect(() => { setI((v) => (campaigns.length ? v % campaigns.length : 0)); }, [campaigns.length]);

  if (campaigns.length === 0) return <PreviewPlaceholder />;

  const c = campaigns[Math.min(i, campaigns.length - 1)];
  const pm = platformMeta(c.platform);
  const step = (d: number) => setI((v) => (v + d + campaigns.length) % campaigns.length);

  return (
    <div className="relative rounded-[20px] border border-[var(--dk-line-2)] bg-[var(--dk-bg-2)] p-2.5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
      {/* Only a genuine live campaign gets the live chip. `status` is already
          "illustrative" for any sample — the server replaces it before
          sending, so this branch cannot be fooled from the client. */}
      {c.status === "live" ? (
        <span className="absolute -top-3 right-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          <span className={`h-1.5 w-1.5 rounded-full bg-white ${calm ? "" : "animate-pulse"}`} aria-hidden />
          Live campaign
        </span>
      ) : c.isIllustrative ? (
        <span className="absolute -top-3 right-4 z-10 rounded-full border border-[var(--dk-line-2)] bg-[var(--dk-bg)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--dk-muted)]">
          Illustrative preview
        </span>
      ) : null}

      <div className="overflow-hidden rounded-[14px] bg-[var(--dk-bg)]">
        <div className="relative aspect-[4/3] w-full">
          {c.imageUrl ? (
            <img src={assetUrl(c.imageUrl)} alt={c.title} className="h-full w-full object-cover" loading="eager" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ backgroundImage: DK_GRADIENT, opacity: 0.18 }}>
              <ImageOff className="h-10 w-10 text-white/60" aria-hidden />
            </div>
          )}
          <span
            className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
            style={{ background: pm.bg }}
          >
            {pm.label}
          </span>
        </div>

        <div className="px-4 py-3.5">
          {c.clientName && <p className="text-xs text-[var(--dk-faint)]">{c.clientName}</p>}
          <p className="mt-0.5 truncate text-[15px] font-bold text-[var(--dk-ink)]">{c.title}</p>
        </div>

        {/* Metrics arrive only as complete pairs, and may be absent. */}
        {c.metrics.length > 0 && (
          <dl className="border-t border-[var(--dk-line)] px-4 py-3">
            {c.metrics.map((m) => (
              <div key={m.label} className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-xs text-[var(--dk-faint)]">{m.label}</dt>
                <dd className="text-sm font-bold text-[var(--dk-cyan)]">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {campaigns.length > 1 && (
        <div className="flex items-center justify-between px-2 pb-1 pt-3">
          <div className="flex gap-1.5">
            {campaigns.map((x, n) => (
              <button
                key={x.id}
                onClick={() => setI(n)}
                aria-label={`Show ${x.title}`}
                aria-current={n === i}
                className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-[var(--dk-cyan)]" : "w-1.5 bg-[var(--dk-line-2)]"}`}
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
  );
}

function PreviewNav({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--dk-line)] bg-[var(--dk-panel)] text-[var(--dk-muted)] transition-colors hover:bg-[var(--dk-panel-2)] hover:text-[var(--dk-ink)]"
    >
      {children}
    </button>
  );
}

/**
 * Shown when no campaign has been published.
 *
 * The reference design fills this slot with a dashboard full of numbers.
 * Every one of those numbers would be invented, so instead this says what the
 * slot is for. It is the honest version of the same composition.
 */
function PreviewPlaceholder() {
  return (
    <div className="rounded-[20px] border border-dashed border-[var(--dk-line-2)] bg-[var(--dk-bg-2)] p-7 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundImage: DK_GRADIENT }}>
        <Megaphone className="h-6 w-6 text-white" aria-hidden />
      </span>
      <p className="mt-4 text-base font-bold text-[var(--dk-ink)]">Campaign previews appear here</p>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[var(--dk-muted)]">
        We show real creatives from campaigns we are running, with the client's permission. Nothing is published here
        until there is genuine work to show.
      </p>
    </div>
  );
}
