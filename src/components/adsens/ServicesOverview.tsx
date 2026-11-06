import { ArrowRight, Check } from "lucide-react";
import { DK_GRADIENT, DarkHead, Glow, iconFor, useCalm } from "./dark";
import { GradientFrame, useReveal } from "./flourish";
import { plateAt } from "./showcase-art";
import type { AdsensService } from "../../lib/api/adsens";

/* =========================================================
   Services overview (§4).

   The brief asks for "a balanced layout with varied section compositions
   instead of making every service look like the same card", so the grid is
   deliberately asymmetric:

     · the first service is a wide FEATURE panel with a real packaging
       photograph beside its deliverables;
     · the next two are TALL cards carrying the full deliverable list;
     · the rest are COMPACT cards — icon, name, summary, count.

   Everything comes from the database (Admin → Marketing). The layout adapts
   to however many services exist rather than assuming eight: with three
   published, you get a feature and two talls and no empty row.
   ========================================================= */

export function ServicesOverview({
  services,
  loaded,
  onStart,
}: {
  services: AdsensService[];
  loaded: boolean;
  onStart: (slug: string) => void;
}) {
  const scope = useReveal<HTMLDivElement>("[data-svc]", { y: 26, stagger: 0.06 });

  const [feature, ...rest] = services;
  const talls = rest.slice(0, 2);
  const compacts = rest.slice(2);

  return (
    <section id="services" className="relative scroll-mt-20 border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="-left-24 top-16" color="var(--dk-blue)" size={420} />

      <div ref={scope} className="shell relative">
        <DarkHead
          badge="What we do"
          title="Everything You Need to"
          accent="Grow Your Brand"
          subtitle="From building your brand identity to reaching customers through digital channels, AdSens helps bring your marketing activities together."
        />

        {!loaded ? (
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-[18px] bg-white/[0.04]" />
            ))}
          </div>
        ) : services.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-dashed border-[var(--dk-line-2)] px-6 py-12 text-center text-sm text-[var(--dk-muted)]">
            Our service list is being updated. Request a consultation and we'll walk you through what we offer.
          </p>
        ) : (
          <div className="mt-10 space-y-5">
            {feature && <FeatureService service={feature} onStart={onStart} />}

            {talls.length > 0 && (
              <div className="grid gap-5 lg:grid-cols-2">
                {talls.map((s) => <TallService key={s.id} service={s} onStart={onStart} />)}
              </div>
            )}

            {compacts.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {compacts.map((s) => <CompactService key={s.id} service={s} onStart={onStart} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- compositions ---------- */

function FeatureService({ service: s, onStart }: { service: AdsensService; onStart: (slug: string) => void }) {
  const Icon = iconFor(s.slug);
  const calm = useCalm();
  const plate = plateAt(2);

  return (
    <div data-svc>
      <GradientFrame glow className="group">
        <div className="grid items-stretch lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-6 sm:p-8 lg:p-10">
            <span
              className="inline-flex h-12 w-12 items-center justify-center rounded-xl text-[#05080F]"
              style={{ backgroundImage: DK_GRADIENT }}
            >
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <h3 className="h3 mt-5 text-[var(--dk-ink)]">{s.name}</h3>
            {s.summary && <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-[var(--dk-muted)]">{s.summary}</p>}

            {s.deliverables.length > 0 && (
              <ul className="mt-6 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {s.deliverables.map((d) => (
                  <li key={d} className="flex items-start gap-2.5 text-sm text-[var(--dk-muted)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--dk-cyan)]" aria-hidden /> {d}
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={() => onStart(s.slug)}
              className="btn btn-sm mt-7 text-[#05080F]"
              style={{ backgroundImage: DK_GRADIENT }}
            >
              Get started <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Real packaging photography rather than an abstract gradient
              panel — the brief is explicit that SVG must not stand in for
              photography. */}
          <div className="relative hidden overflow-hidden lg:block">
            <img
              src={plate.src}
              alt={plate.alt}
              loading="lazy"
              className={`h-full w-full object-cover transition-transform duration-[700ms] ease-out ${calm ? "" : "group-hover:scale-[1.04]"}`}
              style={{ filter: "saturate(0.9) contrast(1.02) brightness(0.52)" }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 mix-blend-multiply"
              style={{ background: "linear-gradient(200deg, rgba(60,88,155,0.55), rgba(10,16,32,0.90))" }}
            />
            {/* Feather the photo into the panel so it reads as one surface
                rather than a pasted-in rectangle. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: "linear-gradient(90deg, var(--dk-bg-2) 0%, rgba(8,13,24,0.88) 26%, rgba(8,13,24,0.35) 72%, transparent)" }}
            />
          </div>
        </div>
      </GradientFrame>
    </div>
  );
}

function TallService({ service: s, onStart }: { service: AdsensService; onStart: (slug: string) => void }) {
  const Icon = iconFor(s.slug);
  const calm = useCalm();

  return (
    <div data-svc className="h-full">
      <GradientFrame className={`group h-full transition-transform duration-300 ${calm ? "" : "hover:-translate-y-1"}`}>
        <div className="flex h-full flex-col p-6 sm:p-7">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] text-[var(--dk-cyan)]">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="mt-4 text-lg font-bold text-[var(--dk-ink)]">{s.name}</h3>
          {s.summary && <p className="mt-1.5 text-sm leading-relaxed text-[var(--dk-muted)]">{s.summary}</p>}

          {s.deliverables.length > 0 && (
            <ul className="mt-5 space-y-2">
              {s.deliverables.map((d) => (
                <li key={d} className="flex items-start gap-2.5 text-[13px] text-[var(--dk-muted)]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--dk-cyan)]" aria-hidden /> {d}
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={() => onStart(s.slug)}
            className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-bold text-[var(--dk-cyan)]"
          >
            Get started
            <ArrowRight className={`h-4 w-4 transition-transform ${calm ? "" : "group-hover:translate-x-1"}`} aria-hidden />
          </button>
        </div>
      </GradientFrame>
    </div>
  );
}

function CompactService({ service: s, onStart }: { service: AdsensService; onStart: (slug: string) => void }) {
  const Icon = iconFor(s.slug);
  const calm = useCalm();

  return (
    <div data-svc className="h-full">
      <GradientFrame className={`group h-full transition-transform duration-300 ${calm ? "" : "hover:-translate-y-1"}`}>
        <button onClick={() => onStart(s.slug)} className="flex h-full w-full flex-col p-6 text-left">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-[var(--dk-violet)]">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <h3 className="mt-3.5 text-[15px] font-bold text-[var(--dk-ink)]">{s.name}</h3>
          {s.summary && <p className="mt-1.5 text-sm leading-relaxed text-[var(--dk-muted)]">{s.summary}</p>}

          <span className="mt-auto flex items-center justify-between gap-3 pt-5">
            {s.deliverables.length > 0 && (
              <span className="text-[11px] uppercase tracking-wider text-[var(--dk-faint)]">
                {s.deliverables.length} deliverables
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--dk-cyan)]">
              Learn more
              <ArrowRight className={`h-3.5 w-3.5 transition-transform ${calm ? "" : "group-hover:translate-x-1"}`} aria-hidden />
            </span>
          </span>
        </button>
      </GradientFrame>
    </div>
  );
}
