import { ArrowUpRight } from "lucide-react";
import { DarkHead, Glow, platformMeta, useCalm } from "./dark";
import { PLATE_FILTER, PlateTint, useReveal } from "./flourish";
import { plateAt } from "./showcase-art";
import { assetUrl } from "../../lib/asset-url";
import type { AdsensCampaign } from "../../lib/api/adsens";

/* =========================================================
   Active Campaigns rail — the reference composition, in Zolo light.

   Card anatomy, matched to the reference image:

     ┌──────────────────────────┐
     │ [PLATFORM]               │  platform badge, top-left
     │                          │
     │      campaign creative   │  4:5 image, fills the card top
     │                          │
     │ BrandName                │  small brand line …
     │ Campaign title    [LIVE] │  … title + status chip, over a scrim
     ├────────────┬─────────────┤
     │   value    │    value    │  two metrics, divided, value over label
     │   label    │    label    │
     └────────────┴─────────────┘

   The reference draws this dark. This page is light, so the card is white
   with a hairline border and the scrim carries contrast over the photo —
   the LAYOUT is identical, the palette is Zolo's.

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
    <section
      id="campaigns"
      className="relative isolate scroll-mt-20 overflow-hidden bg-[#0B1220] py-14 text-white lg:py-20"
    >
      <Glow className="left-1/3 top-10" color="var(--dk-cyan)" size={420} />

      <div ref={scope} className="shell relative">
        {/* Not DarkHead: that component renders --dk-ink, which is
            near-black and unreadable here. Two sections sit on the dark
            band, so they carry their own heading rather than adding a
            `tone` prop used twice. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <span className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--dk-orange)]">
              <span className="h-0.5 w-5 rounded-full bg-[var(--dk-orange)]" aria-hidden />
              Campaign showcase
            </span>
            <h2 className="h2 mt-3 text-white">
              Active <span className="text-[var(--dk-orange)]">Campaigns</span>
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-white/65">
              Creative campaigns and digital experiences built to move brands forward.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {campaigns.map((c, i) => (
            <div key={c.id} data-camp className="h-full">
              <CampaignCard campaign={c} index={i} onOpenCaseStudy={onOpenCaseStudy} calm={calm} />
            </div>
          ))}
        </div>

        {/* Said once under the rail rather than per card — the badges mark
            which ones, and this explains what the badge means. */}
        {anyIllustrative && (
          <p className="mx-auto mt-7 max-w-2xl text-center text-xs leading-relaxed text-white/50">
            Cards marked <span className="font-semibold text-white/75">Illustrative</span> are design
            previews showing the kind of work we produce, on Zolo's own packaging. They are not client campaigns
            and carry no performance claims.
          </p>
        )}
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
  // A campaign with no uploaded creative borrows a Zolo packaging plate —
  // a real photograph of a real product rather than a grey placeholder.
  const img = assetUrl(c.imageUrl) ?? plate.src;

  const body = (
    <>
      {/* ---- creative ---- */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-[#070C16]">
        <img
          src={img}
          alt={c.imageUrl ? c.title : plate.alt}
          loading="lazy"
          className={`h-full w-full object-cover transition-transform duration-[600ms] ease-out ${calm ? "" : "group-hover:scale-[1.07]"}`}
          style={PLATE_FILTER}
        />
        <PlateTint />

        {/* Scrim. The caption sits on the photograph, as in the reference,
            so it needs its own contrast whatever the photo happens to be. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-32"
          style={{ background: "linear-gradient(to top, rgba(2,6,23,0.88), rgba(2,6,23,0.52) 48%, transparent)" }}
        />

        <span
          className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm"
          style={{ background: pm.bg }}
        >
          {pm.label}
        </span>

        {clickable && (
          <span
            aria-hidden
            className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#0B1220] shadow-sm backdrop-blur transition-all duration-300 ${
              calm ? "" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <ArrowUpRight className="h-4 w-4" />
          </span>
        )}

        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-white/75">{c.clientName ?? plate.craft}</p>
            <p className="truncate text-sm font-bold text-white">{c.title}</p>
          </div>
          <StatusChip campaign={c} calm={calm} />
        </div>
      </div>

      {/* ---- metric footer ----
          Two columns with a divider, value over label, exactly as the
          reference. Metrics arrive only as complete pairs and may be absent
          entirely, so the grid adapts rather than rendering an empty cell. */}
      {c.metrics.length > 0 && (
        <dl
          className={`mt-auto grid border-t border-white/12 ${
            c.metrics.length > 1 ? "grid-cols-2 divide-x divide-white/12" : "grid-cols-1"
          }`}
        >
          {c.metrics.map((m) => (
            <div key={m.label} className="px-3 py-3.5 text-center">
              <dd className="text-base font-extrabold text-[var(--dk-orange)]">{m.value}</dd>
              <dt className="mt-0.5 text-[11px] text-white/55">{m.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </>
  );

  /* White card, hairline border, soft lift — the Zolo card idiom holding the
     reference's layout. The `card`/`card-hover` utilities are not reused
     directly because they hardcode `background:#fff` and would ignore this
     page's scoped tokens; the radius and shadows below are the same ones. */
  const shell = (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-white/12 bg-white/[0.04] backdrop-blur transition-all duration-300 ${
        calm ? "" : "hover:-translate-y-1.5 hover:border-[var(--dk-orange)]/45 hover:shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
      }`}
    >
      {body}
    </div>
  );

  // A card is only a button when there is somewhere to go. A clickable
  // element that does nothing is worse than a plain one.
  return clickable ? (
    <button type="button" onClick={() => onOpenCaseStudy(c.caseStudySlug!)} className="block h-full w-full text-left">
      {shell}
      <span className="sr-only">View the case study for {c.title}</span>
    </button>
  ) : (
    <article className="h-full">{shell}</article>
  );
}

function StatusChip({ campaign: c, calm }: { campaign: AdsensCampaign; calm: boolean }) {
  if (c.status === "live") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_4px_12px_rgba(16,185,129,0.4)]">
        <span className={`h-1.5 w-1.5 rounded-full bg-white ${calm ? "" : "animate-pulse"}`} aria-hidden />
        Live
      </span>
    );
  }
  const label = c.isIllustrative ? "Illustrative" : c.status === "paused" ? "Paused" : "Completed";
  return (
    <span className="shrink-0 rounded-full border border-white/30 bg-black/45 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
      {label}
    </span>
  );
}
