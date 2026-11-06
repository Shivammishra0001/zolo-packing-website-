import {
  BarChart3, MessageSquare, Package, PenTool, RefreshCw, Target, Users,
} from "lucide-react";
import { DarkHead, Glow, useCalm } from "./dark";
import { GradientFrame, useReveal } from "./flourish";

/* =========================================================
   Why Choose AdSens (§9).

   Seven reasons, as a bento-style grid rather than seven identical tiles —
   the first spans two columns so the row counts work out and the eye has
   somewhere to land.

   Every line here describes what we DO, not what we promise. The brief says
   to avoid unsupported guarantees, so there is no "guaranteed leads", no
   "3x your revenue", no satisfaction percentage.
   ========================================================= */

const REASONS = [
  {
    icon: Target,
    title: "Business-focused strategy",
    body: "Plans built around what your business actually sells and who buys it — not a template applied to every client.",
    wide: true,
  },
  { icon: PenTool, title: "Creative execution", body: "Creatives, copy and content produced for your brand, not pulled from a library." },
  { icon: Users, title: "Audience-focused advertising", body: "Campaigns aimed at the people most likely to buy what you sell." },
  { icon: BarChart3, title: "Transparent reporting", body: "Clear reports on what ran, how it performed and what it cost." },
  { icon: RefreshCw, title: "Continuous optimisation", body: "We keep adjusting targeting, creatives and budget as results come in." },
  { icon: MessageSquare, title: "Dedicated communication", body: "A person to talk to, not a ticket queue." },
  {
    icon: Package,
    title: "Packaging and marketing ecosystem",
    body: "The same company that can supply your packaging can run the campaigns that sell it — quoted separately, managed together.",
    wide: true,
  },
];

export function WhyAdSens() {
  const scope = useReveal<HTMLDivElement>("[data-why]", { y: 24, stagger: 0.05 });
  const calm = useCalm();

  return (
    <section className="relative border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="-left-20 top-20" color="var(--dk-cyan)" size={400} />

      <div ref={scope} className="shell relative">
        <DarkHead
          badge="Why AdSens"
          title="More Than Marketing."
          accent="A Partner in Your Growth."
          subtitle="What you can expect from working with us — stated as things we do, not outcomes we cannot promise."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map((r) => (
            <div key={r.title} data-why className={r.wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
              <GradientFrame className={`h-full transition-transform duration-300 ${calm ? "" : "hover:-translate-y-1"}`}>
                <div className={`flex h-full gap-4 p-5 sm:p-6 ${r.wide ? "items-start" : "flex-col"}`}>
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-50)] text-[var(--dk-orange-ink)]">
                    <r.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className={`font-bold text-[var(--dk-ink)] ${r.wide ? "text-lg" : "mt-1 text-[15px]"}`}>{r.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--dk-muted)]">{r.body}</p>
                  </div>
                </div>
              </GradientFrame>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
