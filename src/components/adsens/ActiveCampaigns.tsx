import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";
import { DK_GRADIENT, DarkHead, Glow, platformMeta, useCalm } from "./dark";
import { assetUrl } from "../../lib/asset-url";
import type { AdsensCampaign } from "../../lib/api/adsens";

/* =========================================================
   Active Campaigns rail.

   Four cards per row on large screens, each resembling an advertising
   creative preview: full-bleed image, platform badge, client, title, status
   and up to two metrics.

   What this component will NOT do, per the brief's data rule: invent a
   client, a click count, a conversion rate, a ROAS or a ranking, and never
   show a LIVE badge on a sample. `status` is already "illustrative" for any
   sample by the time it arrives — the server rewrites it — so the LIVE branch
   here is unreachable for sample content by construction rather than by
   discipline.
   ========================================================= */

export function ActiveCampaigns({
  campaigns,
  onOpenCaseStudy,
}: {
  campaigns: AdsensCampaign[];
  onOpenCaseStudy: (slug: string) => void;
}) {
  const calm = useCalm();

  // No published campaigns ⇒ no section. An empty results wall with
  // placeholder cards would be exactly the fabrication we are avoiding.
  if (campaigns.length === 0) return null;

  const anyIllustrative = campaigns.some((c) => c.isIllustrative);

  return (
    <section className="relative border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="left-1/3 top-10" color="var(--dk-cyan)" size={380} />

      <div className="shell relative">
        <DarkHead
          badge="Live campaigns"
          title="Active"
          accent="Campaigns"
          subtitle="Creative campaigns, strategic advertising and digital experiences built to move brands forward."
        />

        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {campaigns.map((c, i) => (
            <motion.div
              key={c.id}
              initial={calm ? undefined : { opacity: 0, y: 16 }}
              whileInView={calm ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.06, 0.3) }}
            >
              <CampaignCard campaign={c} onOpenCaseStudy={onOpenCaseStudy} calm={calm} />
            </motion.div>
          ))}
        </div>

        {/* Said once, under the rail, rather than per card — the per-card
            badge already marks which ones, and this explains what it means. */}
        {anyIllustrative && (
          <p className="mt-6 text-center text-xs text-[var(--dk-faint)]">
            Cards marked <span className="font-semibold text-[var(--dk-muted)]">Illustrative</span> are design previews
            showing the kind of work we produce. They are not client campaigns and carry no performance claims.
          </p>
        )}
      </div>
    </section>
  );
}

function CampaignCard({
  campaign: c,
  onOpenCaseStudy,
  calm,
}: {
  campaign: AdsensCampaign;
  onOpenCaseStudy: (slug: string) => void;
  calm: boolean;
}) {
  const pm = platformMeta(c.platform);
  const clickable = Boolean(c.caseStudySlug);

  const body = (
    <>
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[var(--dk-bg)]">
        {c.imageUrl ? (
          <img
            src={assetUrl(c.imageUrl)}
            alt={c.title}
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-500 ${calm ? "" : "group-hover:scale-[1.06]"}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ backgroundImage: DK_GRADIENT, opacity: 0.16 }}>
            <ImageOff className="h-8 w-8 text-white/60" aria-hidden />
          </div>
        )}

        {/* Readability scrim under the caption. */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#05080F] to-transparent" />

        <span
          className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
          style={{ background: pm.bg }}
        >
          {pm.label}
        </span>

        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            {c.clientName && <p className="truncate text-[11px] text-white/70">{c.clientName}</p>}
            <p className="truncate text-sm font-bold text-white">{c.title}</p>
          </div>
          <StatusChip campaign={c} calm={calm} />
        </div>
      </div>

      {c.metrics.length > 0 && (
        <dl className="grid grid-cols-2 divide-x divide-[var(--dk-line)] border-t border-[var(--dk-line)]">
          {c.metrics.map((m) => (
            <div key={m.label} className="px-3 py-3 text-center">
              <dd className="text-sm font-bold text-[var(--dk-cyan)]">{m.value}</dd>
              <dt className="mt-0.5 text-[11px] text-[var(--dk-faint)]">{m.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </>
  );

  const shell =
    "group relative block w-full overflow-hidden rounded-2xl border border-[var(--dk-line)] bg-[var(--dk-panel)] text-left transition-colors duration-300 hover:border-[var(--dk-cyan)]/55 hover:shadow-[0_0_0_1px_rgba(45,212,191,0.18),0_18px_50px_rgba(0,0,0,0.5)]";

  // A card is only a button when there is somewhere to go. A clickable
  // element that does nothing is worse than a plain one.
  return clickable ? (
    <button type="button" onClick={() => onOpenCaseStudy(c.caseStudySlug!)} className={shell}>
      {body}
      <span className="sr-only">View the case study for {c.title}</span>
    </button>
  ) : (
    <article className={shell}>{body}</article>
  );
}

function StatusChip({ campaign: c, calm }: { campaign: AdsensCampaign; calm: boolean }) {
  if (c.status === "live") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
        <span className={`h-1.5 w-1.5 rounded-full bg-white ${calm ? "" : "animate-pulse"}`} aria-hidden />
        Live
      </span>
    );
  }
  if (c.isIllustrative) {
    return (
      <span className="shrink-0 rounded-full border border-white/25 bg-black/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
        Illustrative
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-white/25 bg-black/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
      {c.status === "paused" ? "Paused" : "Completed"}
    </span>
  );
}
