import { ArrowRight, Clock, Mail, Phone, ShieldCheck } from "lucide-react";
import { DK_GRADIENT, Glow, useCalm } from "./dark";
import { GradientFrame, Orbit, useReveal } from "./flourish";
import { plateAt } from "./showcase-art";

/* =========================================================
   Consultation CTA (§11).

   The form itself is a dialog (ConsultationModal) — eleven fields inline
   would push the FAQ a screen and a half down the page, and the dialog is
   already built, tested and wired to the lead pipeline.

   This section is the invitation: what happens next, what it costs
   (nothing), and the three assurances a visitor wants before handing over a
   phone number.
   ========================================================= */

const ASSURANCES = [
  { icon: Clock, title: "No obligation", body: "A conversation about your business and what marketing would involve." },
  { icon: ShieldCheck, title: "Your details stay private", body: "We use them to contact you about this enquiry. Nothing else." },
  { icon: Mail, title: "A real reply", body: "Our team reviews your requirements and comes back with a plan." },
];

export function ConsultationCta({ onConsult }: { onConsult: () => void }) {
  const scope = useReveal<HTMLDivElement>("[data-cta]", { y: 24, stagger: 0.07 });
  const calm = useCalm();
  const plate = plateAt(5);

  return (
    <section id="consultation" className="relative scroll-mt-20 border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="left-1/2 top-0 -translate-x-1/2" color="var(--dk-blue)" size={520} />
      <Orbit className="absolute -left-16 bottom-4 hidden text-[var(--dk-violet)] opacity-30 xl:block" size={260} />

      <div ref={scope} className="shell relative">
        <GradientFrame glow>
          <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-7 sm:p-10 lg:p-12">
              <span
                data-cta
                className="inline-flex items-center gap-2 rounded-full border border-[var(--dk-line-2)] bg-[var(--dk-panel)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--dk-cyan)]"
              >
                Free consultation
              </span>

              <h2 data-cta className="h2 mt-4 text-[var(--dk-ink)]">
                Let's Talk About Your Next{" "}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: DK_GRADIENT }}>
                  Growth Opportunity.
                </span>
              </h2>

              <p data-cta className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--dk-muted)]">
                Tell us about your business, your products and what you want marketing to achieve. We'll review your
                requirements and come back with a plan.
              </p>

              <ul data-cta className="mt-7 space-y-4">
                {ASSURANCES.map((a) => (
                  <li key={a.title} className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--dk-panel-2)] text-[var(--dk-cyan)]">
                      <a.icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-[var(--dk-ink)]">{a.title}</span>
                      <span className="block text-sm leading-relaxed text-[var(--dk-muted)]">{a.body}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div data-cta className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  onClick={onConsult}
                  className="btn btn-lg group relative w-full justify-center overflow-hidden text-white shadow-[0_12px_38px_rgba(79,123,255,0.42)] sm:w-auto"
                  style={{ backgroundImage: DK_GRADIENT }}
                >
                  {!calm && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                    />
                  )}
                  <span className="relative inline-flex items-center gap-2">
                    Request a Free Consultation <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </button>

                {/* A real, reachable alternative for anyone who would rather
                    not fill in a form. */}
                <a
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 text-sm font-bold text-[var(--dk-muted)] transition-colors hover:text-[var(--dk-ink)] sm:px-2"
                >
                  <Phone className="h-4 w-4" aria-hidden /> Or talk to our team
                </a>
              </div>
            </div>

            <div className="relative hidden min-h-[380px] overflow-hidden lg:block">
              <img
                src={plate.src}
                alt={plate.alt}
                loading="lazy"
                className="h-full w-full object-cover"
                style={{ filter: "saturate(1.02) contrast(1.02) brightness(1.04)" }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 mix-blend-multiply"
                style={{ background: "linear-gradient(150deg, rgba(14,116,144,0.14), rgba(124,58,237,0.12))" }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ background: "linear-gradient(90deg, var(--dk-bg) 0%, var(--dk-bg) 8%, rgba(255,255,255,0.80) 30%, rgba(255,255,255,0.30) 62%, transparent 92%)" }}
              />
            </div>
          </div>
        </GradientFrame>
      </div>
    </section>
  );
}
