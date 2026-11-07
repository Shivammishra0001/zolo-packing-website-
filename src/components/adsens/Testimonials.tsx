import { Quote } from "lucide-react";
import { TESTIMONIALS } from "./content";
import { Reveal, RevealGroup, SectionHead } from "./shared";

/* =========================================================
   Section 5 — What Our Clients Say. Three quotes.

   Marked up as <figure>/<blockquote>/<figcaption>, which is what a quote
   with an attribution actually is — it gives screen readers the link
   between the words and who said them.
   ========================================================= */

export function Testimonials() {
  return (
    <section className="section bg-white">
      <div className="shell">
        <Reveal>
          <SectionHead eyebrow="Testimonials" title="What Our" accent="Clients Say" />
        </Reveal>

        <RevealGroup as="ul" className="mt-10 grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <Reveal key={t.name} as="li" className="h-full">
              <figure className="card card-hover flex h-full flex-col p-6">
                <Quote className="h-7 w-7 shrink-0 text-green-300" aria-hidden />
                <blockquote className="mt-3 flex-1 text-[14.5px] leading-relaxed text-dark-700">
                  {t.quote}
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3 border-t border-dark-200 pt-4">
                  {/* Initials rather than a stock headshot: an invented face
                      attached to a name would be the one detail that reads
                      as a real person. */}
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 font-display text-[13px] font-extrabold text-green-600"
                  >
                    {t.name.split(" ").map((w) => w[0]).join("")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-bold text-dark-900">{t.name}</span>
                    <span className="block truncate text-[12.5px] text-dark-500">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
