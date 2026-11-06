import { BarChart3, Lightbulb, Rocket, Search } from "lucide-react";
import { DarkHead, Glow, useCalm } from "./dark";
import { useReveal } from "./flourish";

/* =========================================================
   Our Approach (§8).

   A connected four-step timeline rather than four detached cards: a hairline
   rail runs behind the numbers, horizontal on desktop and vertical once the
   steps stack, so the sequence reads as one process.

   The rail is a plain gradient element, not an SVG path animation — it is
   decoration, and the brief asks for no unnecessary animation libraries.
   ========================================================= */

const STEPS = [
  { n: "01", icon: Search, title: "Understand", body: "We start with your business, audience, products and objectives — what you sell and who buys it." },
  { n: "02", icon: Lightbulb, title: "Strategize", body: "We prepare the marketing strategy, choose the channels and plan the campaigns around your goals." },
  { n: "03", icon: Rocket, title: "Execute", body: "We create the campaign assets, launch the advertising and manage the marketing activity day to day." },
  { n: "04", icon: BarChart3, title: "Optimize", body: "We monitor actual performance, improve the campaigns and report what ran and what it cost." },
];

export function Approach() {
  const scope = useReveal<HTMLDivElement>("[data-step]", { y: 24, stagger: 0.1 });
  const calm = useCalm();

  return (
    <section className="relative border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="right-1/4 top-12" color="var(--dk-violet)" size={400} />

      <div ref={scope} className="shell relative">
        <DarkHead
          badge="How we work"
          title="From Business Goals to"
          accent="Real Marketing Execution"
          subtitle="Four steps from the first conversation to a campaign you can see the results of."
        />

        <ol className="relative mt-12 grid items-start gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {/* The connecting rail. Horizontal across the desktop row, hidden
              once the steps stack into columns where it would cut corners. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-7 hidden h-px lg:block"
            style={{ background: "linear-gradient(90deg, transparent, rgba(194,65,12,0.35) 12%, rgba(194,65,12,0.35) 88%, transparent)" }}
          />

          {STEPS.map((s) => (
            <li key={s.n} data-step className="relative">
              <div className="flex items-center gap-3 lg:block">
                {/* The ring sits on the rail, so it needs an opaque
                    background or the line shows through the icon. Fixed
                    height on the row keeps every ring on the same y, which
                    a two-line title below would otherwise shift. */}
                <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--dk-line-2)] bg-[var(--dk-bg-2)] text-[var(--dk-orange-ink)]">
                  <s.icon className="h-6 w-6" aria-hidden />
                </span>
                <span
                  className="font-display text-3xl font-extrabold leading-none text-[var(--dk-orange-ink)] lg:mt-5 lg:block"
                  aria-hidden
                >
                  {s.n}
                </span>
              </div>

              <h3 className="mt-3 text-lg font-bold text-[var(--dk-ink)] lg:mt-2">
                <span className="sr-only">Step {s.n}: </span>
                {s.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--dk-muted)]">{s.body}</p>

              {/* Vertical joint between stacked steps on narrow screens. */}
              {!calm && (
                <span
                  aria-hidden
                  className="absolute -bottom-5 left-7 h-4 w-px bg-[var(--dk-line-2)] sm:hidden"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
