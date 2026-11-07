import { useReducedMotion } from "framer-motion";
import { CAMPAIGNS, PLATFORM_TINT, type Campaign } from "./content";
import { CardArt } from "./CardArt";
import { Reveal, RevealGroup } from "./shared";

/* =========================================================
   Section 3 — Active Campaigns.

   Card anatomy from the reference:

     ┌────────────────────────┐
     │ [PLATFORM]      [LIVE] │  platform chip + status
     │                        │
     │        creative        │  4:3 image
     │                        │
     │ Brand                  │
     │ Campaign title         │
     ├───────────┬────────────┤
     │  metric   │   metric   │  two metrics, divided
     └───────────┴────────────┘

   Rendered on a navy band, which is this app's existing high-contrast
   section treatment and the closest light-theme equivalent of the
   reference's dark rail.
   ========================================================= */

export function Campaigns() {
  return (
    <section id="campaigns" className="relative scroll-mt-20 overflow-hidden bg-navy-950 py-12 text-white lg:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/3 top-0 h-[340px] w-[340px] rounded-full opacity-50 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,222,128,0.16), transparent 70%)" }}
      />

      <div className="shell relative">
        <Reveal>
          {/* Own heading markup rather than SectionHead: that renders
              dark-900 text, which is unreadable on this band. */}
          <div className="mx-auto max-w-2xl text-center">
            <span className="flex items-center justify-center gap-2.5 text-xs font-bold uppercase tracking-[0.18em] text-green-400">
              <span className="h-0.5 w-5 rounded-full bg-green-400" aria-hidden />
              Live Now
            </span>
            <h2 className="h2 mt-3 text-white">
              Active <span className="text-green-400">Campaigns</span>
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-white/65">
              Real ad creatives running across platforms right now.
            </p>
          </div>
        </Reveal>

        <RevealGroup as="ul" className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {CAMPAIGNS.map((c) => (
            <Reveal key={c.brand} as="li" className="h-full">
              <CampaignCard campaign={c} />
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

function CampaignCard({ campaign: c }: { campaign: Campaign }) {
  const calm = useReducedMotion();

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-white/12 bg-white/[0.04] backdrop-blur transition-all duration-300 hover:-translate-y-1.5 hover:border-green-400/50 motion-reduce:transform-none motion-reduce:transition-none">
      {/* creative */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
        <CardArt
          monogram={c.monogram}
          category={c.tint}
          shape={c.shape}
          label={c.brand}
          className="h-full w-full transition-transform duration-[600ms] ease-out group-hover:scale-[1.06] motion-reduce:transform-none motion-reduce:transition-none"
        />

        <span
          className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm"
          style={{ background: PLATFORM_TINT[c.platform] }}
        >
          {c.platform}
        </span>

        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
          <span className={`h-1.5 w-1.5 rounded-full bg-white ${calm ? "" : "animate-pulse"}`} aria-hidden />
          {c.status}
        </span>
      </div>

      {/* caption */}
      <div className="px-4 pb-3 pt-3.5">
        <p className="truncate text-[11px] text-white/60">{c.brand}</p>
        <h3 className="truncate text-sm font-bold text-white">{c.title}</h3>
      </div>

      {/* metrics */}
      <dl className="mt-auto grid grid-cols-2 divide-x divide-white/12 border-t border-white/12">
        {c.metrics.map((m) => {
          // "12.4K Clicks" → value "12.4K", label "Clicks".
          const [value, ...rest] = m.split(" ");
          return (
            <div key={m} className="px-3 py-3 text-center">
              <dd className="text-sm font-extrabold tabular-nums text-green-400">{value}</dd>
              <dt className="mt-0.5 text-[11px] text-white/55">{rest.join(" ")}</dt>
            </div>
          );
        })}
      </dl>
    </article>
  );
}
