import { ArrowRight, Check } from "lucide-react";
import { DarkHead, Glow, iconFor, useCalm } from "./dark";
import { useReveal } from "./flourish";
import type { AdsensService } from "../../lib/api/adsens";

/* =========================================================
   Services overview.

   Six equal cards in a 3x2 grid, per the approved design: icon tile,
   title, short description, enquiry link. Icons and links are Zolo
   orange — on a card this is an interaction highlight, which is what the
   design system reserves orange for.

   An earlier revision used a varied feature/tall/compact layout. The
   approved mockup is uniform, so this is uniform; the grid still adapts to
   however many services are published rather than assuming six.

   Everything comes from the database (Admin -> Marketing). Clicking a card
   opens the consultation dialog with that service pre-ticked, so the link
   is real rather than decorative.
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

  return (
    <section id="services" className="relative scroll-mt-20 border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="-left-24 top-16" color="var(--dk-blue)" size={420} />

      <div ref={scope} className="shell relative">
        <DarkHead
          badge="Our services"
          title="Everything You Need to"
          accent="Grow Your Brand"
          subtitle="From building your brand identity to reaching customers through digital channels, AdSens helps bring your marketing activities together."
        />

        {!loaded ? (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-52 animate-pulse rounded-[var(--radius-card)] bg-[var(--dk-panel-2)]" />
            ))}
          </div>
        ) : services.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-dashed border-[var(--dk-line-2)] px-6 py-12 text-center text-sm text-[var(--dk-muted)]">
            Our service list is being updated. Request a consultation and we'll walk you through what we offer.
          </p>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <ServiceCard key={s.id} service={s} onStart={onStart} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ServiceCard({ service: s, onStart }: { service: AdsensService; onStart: (slug: string) => void }) {
  const Icon = iconFor(s.slug);
  const calm = useCalm();

  return (
    <button
      data-svc
      type="button"
      onClick={() => onStart(s.slug)}
      aria-label={`Enquire about ${s.name}`}
      className={`group flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--dk-line)] bg-[var(--dk-bg)] p-6 text-left shadow-[var(--shadow-card)] transition-all duration-300 ${
        calm ? "" : "hover:-translate-y-1 hover:border-[var(--dk-orange)]/40 hover:shadow-[var(--shadow-card-hover)]"
      }`}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--dk-orange-ink)]">
        <Icon className="h-6 w-6" aria-hidden />
      </span>

      <h3 className="mt-4 text-[17px] font-bold text-[var(--dk-ink)]">{s.name}</h3>
      {s.summary && <p className="mt-2 text-sm leading-relaxed text-[var(--dk-muted)]">{s.summary}</p>}

      {/* The three headline deliverables, so a card says something concrete
          without becoming a wall of ticks. The full list is on the
          consultation form the card opens. */}
      {s.deliverables.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {s.deliverables.slice(0, 3).map((d) => (
            <li key={d} className="flex items-start gap-2 text-[13px] text-[var(--dk-faint)]">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--dk-orange-ink)]" aria-hidden /> {d}
            </li>
          ))}
        </ul>
      )}

      {/* Not "Learn More": this opens the consultation form, and a label
          that promises information but delivers a form teaches the visitor
          not to trust the next button either. */}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-bold text-[var(--dk-orange-ink)]">
        Enquire about this
        <ArrowRight className={`h-4 w-4 transition-transform ${calm ? "" : "group-hover:translate-x-1"}`} aria-hidden />
      </span>
    </button>
  );
}
