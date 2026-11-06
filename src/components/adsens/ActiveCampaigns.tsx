import { ArrowUpRight } from "lucide-react";
import { DK_GRADIENT, DarkHead, Glow, platformMeta, useCalm } from "./dark";
import { GradientFrame, PLATE_FILTER, PlateTint, Ribbon, useReveal } from "./flourish";
import { plateAt } from "./showcase-art";
import { assetUrl } from "../../lib/asset-url";
import type { AdsensCampaign } from "../../lib/api/adsens";

/* =========================================================
   Active Campaigns rail.

   Four cards per row on large screens, each a tall advertising-creative
   preview: full-bleed image, platform badge, client, title, status, and a
   two-up metric strip across the foot — the reference's exact composition.

   What this component will NOT do, per the brief's data rule: invent a
   client, a click count, a conversion rate, a ROAS or a ranking, and never
   badge a sample LIVE. `status` is already "illustrative" for any sample by
   the time it arrives — the server rewrites it — so the LIVE branch here is
   unreachable for sample content by construction, not by discipline.
   ========================================================= */

export function ActiveCampaigns({
  campaigns,
  onOpenCaseStudy,
}: {
  campaigns: AdsensCampaign[];
  onOpenCaseStudy: (slug: string) => void;
}) {
  const calm = useCalm();
  const scope = useReveal<HTMLDivElement>("[data-camp]", { y: 30, stagger: 0.08 });

  // No published campaigns ⇒ no section. A wall of placeholder cards would
  // be exactly the fabrication we are avoiding.
  if (campaigns.length === 0) return null;

  const anyIllustrative = campaigns.some((c) => c.isIllustrative);

  return (
    <section className="relative border-t border-[var(--dk-line)]">
      <Ribbon />

      <div className="relative py-14 lg:py-20">
        <Glow className="left-1/3 top-10" color="var(--dk-cyan)" size={400} />

        <div ref={scope} className="shell relative">
          <DarkHead
            badge="Live campaigns"
            title="Active"
            accent="Campaigns"
            subtitle="Creative campaigns, strategic advertising and digital experiences built to move brands forward."
          />

          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {campaigns.map((c, i) => (
              <div key={c.id} data-camp>
                <CampaignCard campaign={c} index={i} onOpenCaseStudy={onOpenCaseStudy} calm={calm} />
              </div>
            ))}
          </div>

          {/* Said once under the rail rather than per card — the badges mark
              which ones, and this explains what the badge means. */}
          {anyIllustrative && (
            <p className="mx-auto mt-7 max-w-2xl text-center text-xs leading-relaxed text-[var(--dk-faint)]">
              Cards marked <span className="font-semibold text-[var(--dk-muted)]">Illustrative</span> are design
              previews showing the kind of work we produce, on Zolo's own packaging. They are not client campaigns
              and carry no performance claims.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function CampaignCard({
  campaign: c,
  index,
  onOpenCaseStudy,
  calm,
}: {
  campaign: AdsensCampaign;
  index: number;
  onOpenCaseStudy: (slug: string) => void;
  calm: boolean;
}) {
  const pm = platformMeta(c.platform);
  const clickable = Boolean(c.caseStudySlug);
  const plate = plateAt(index);
  // An admin campaign with no uploaded creative borrows a Zolo packaging
  // plate, which is a real photograph of a real product rather than a grey
  // placeholder box.
  const img = assetUrl(c.imageUrl) ?? plate.src;

  const body = (
    <>
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[var(--dk-bg)]">
        <img
          src={img}
          alt={c.imageUrl ? c.title : plate.alt}
          loading="lazy"
          className={`h-full w-full object-cover transition-transform duration-[600ms] ease-out ${calm ? "" : "group-hover:scale-[1.07]"}`}
          style={PLATE_FILTER}
        />

        <PlateTint />

        {/* Readability scrim under the caption. */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#05080F] via-[#05080F]/75 to-transparent" />

        <span
          className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg"
          style={{ background: pm.bg }}
        >
          {pm.label}
        </span>

        {clickable && (
          <span
            aria-hidden
            className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-all duration-300 ${
              calm ? "" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <ArrowUpRight className="h-4 w-4" />
          </span>
        )}

        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-white/70">{c.clientName ?? plate.craft}</p>
            <p className="truncate text-sm font-bold text-white">{c.title}</p>
          </div>
          <StatusChip campaign={c} calm={calm} />
        </div>
      </div>

      {/* Metrics arrive only as complete pairs, and may be absent entirely. */}
      {c.metrics.length > 0 && (
        <dl className={`grid border-t border-[var(--dk-line)] ${c.metrics.length > 1 ? "grid-cols-2 divide-x divide-[var(--dk-line)]" : "grid-cols-1"}`}>
          {c.metrics.map((m) => (
            <div key={m.label} className="px-3 py-3.5 text-center">
              <dd
                className="bg-clip-text text-base font-extrabold text-transparent"
                style={{ backgroundImage: DK_GRADIENT }}
              >
                {m.value}
              </dd>
              <dt className="mt-0.5 text-[11px] text-[var(--dk-faint)]">{m.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </>
  );

  const frame = (
    <GradientFrame
      className={`group h-full transition-transform duration-300 ${calm ? "" : "hover:-translate-y-1.5"}`}
    >
      {body}
    </GradientFrame>
  );

  // A card is only a button when there is somewhere to go. A clickable
  // element that does nothing is worse than a plain one.
  return clickable ? (
    <button type="button" onClick={() => onOpenCaseStudy(c.caseStudySlug!)} className="block w-full text-left">
      {frame}
      <span className="sr-only">View the case study for {c.title}</span>
    </button>
  ) : (
    <article>{frame}</article>
  );
}

function StatusChip({ campaign: c, calm }: { campaign: AdsensCampaign; calm: boolean }) {
  if (c.status === "live") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_4px_14px_rgba(16,185,129,0.5)]">
        <span className={`h-1.5 w-1.5 rounded-full bg-white ${calm ? "" : "animate-pulse"}`} aria-hidden />
        Live
      </span>
    );
  }
  const label = c.isIllustrative ? "Illustrative" : c.status === "paused" ? "Paused" : "Completed";
  return (
    <span className="shrink-0 rounded-full border border-white/25 bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80 backdrop-blur">
      {label}
    </span>
  );
}
