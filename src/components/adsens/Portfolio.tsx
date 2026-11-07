import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PORTFOLIO, PORTFOLIO_FILTERS, type PortfolioFilter } from "./content";
import { CardArt } from "./CardArt";
import { Reveal, RevealGroup, SectionHead } from "./shared";

/* =========================================================
   Section 4 — Our Portfolio, with working category filters.

   Filtering is client-side over a constant list, so it is instant and needs
   no loading state. The chips are real buttons carrying aria-pressed, and
   the result count is announced politely so a screen-reader user learns that
   the grid changed — the visual change alone would not reach them.
   ========================================================= */

export function Portfolio() {
  const [active, setActive] = useState<PortfolioFilter>("All");

  const shown = useMemo(
    () => (active === "All" ? PORTFOLIO : PORTFOLIO.filter((p) => p.category === active)),
    [active],
  );

  return (
    <section id="portfolio" className="section scroll-mt-20 bg-dark-50">
      <div className="shell">
        <Reveal>
          <SectionHead
            eyebrow="Selected work"
            title="Our"
            accent="Portfolio"
            subtitle="Real results from real partnerships."
          />
        </Reveal>

        {/* ---------------- filters ---------------- */}
        <Reveal>
          <div className="mt-7 flex flex-wrap justify-center gap-2" role="group" aria-label="Filter portfolio by category">
            {PORTFOLIO_FILTERS.map((f) => {
              const on = f === active;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive(f)}
                  className={`chip !h-11 lg:!h-9 ${on ? "chip-active" : ""} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500`}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </Reveal>

        {/* Announced to assistive tech on every filter change. */}
        <p aria-live="polite" className="sr-only">
          {shown.length} {shown.length === 1 ? "project" : "projects"} shown
          {active === "All" ? "" : ` in ${active}`}.
        </p>

        {/* ---------------- grid ----------------
            `key={active}` remounts the list so each filtered set reveals
            again rather than appearing without transition. */}
        <RevealGroup key={active} as="ul" className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <Reveal key={p.slug} as="li" className="h-full">
              <article className="card card-hover group flex h-full flex-col overflow-hidden">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-cream-50">
                  <CardArt
                    monogram={p.monogram}
                    category={p.category}
                    shape={p.shape}
                    label={p.client}
                    className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transform-none motion-reduce:transition-none"
                  />
                  <span className="badge absolute left-3 top-3 bg-green-500 text-white">{p.category}</span>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-dark-500">{p.client}</p>
                  <h3 className="mt-1 font-display text-[17px] font-extrabold leading-tight text-dark-900">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-dark-600">{p.body}</p>

                  <Link
                    to="/contact"
                    aria-label={`View the case study for ${p.title}`}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-bold text-green-600 transition-colors hover:text-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
                  >
                    View Case Study
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden />
                  </Link>
                </div>
              </article>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
