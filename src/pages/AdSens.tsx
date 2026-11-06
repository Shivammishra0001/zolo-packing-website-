import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, BarChart3, Check, ChevronDown, Globe2, Layers, LineChart,
  MessageCircle, Megaphone, PenTool, Search, Share2, Sparkles, Target,
  TrendingUp, Users,
} from "lucide-react";
import { adsensApi, type AdsensService, type AdsensPackage, type AdsensShowcase } from "../lib/api/adsens";
import { ConsultationModal } from "../components/adsens/ConsultationModal";
import { DarkGround } from "../components/adsens/dark";
import { DarkHero } from "../components/adsens/DarkHero";
import { ActiveCampaigns } from "../components/adsens/ActiveCampaigns";
import { Portfolio } from "../components/adsens/Portfolio";
import { PackagingPromotion } from "../components/adsens/PackagingPromotion";
import { CaseStudyModal } from "../components/adsens/CaseStudyModal";

/* =========================================================
   ADSENS BY ZOLO — digital marketing services.
   Route: /adsens

   DESIGN — TWO ZONES, deliberately:

   The showcase block at the top (hero, Active Campaigns, Our Portfolio,
   Packaging+Promotion) runs on a dark navy ground with cyan/violet accents,
   per the supplied agency references. Everything below it — services,
   process, packages, consultation, FAQ — stays on the original light
   "Modern Growth" ground, because that half is practical information rather
   than a showcase, and because the brief said to keep the rest of the Zolo
   site unchanged. Both palettes are SCOPED to their wrapper; the global
   theme is untouched.

   DESIGN (§2, "Modern Growth"): white and light grey ground, Zolo orange kept
   as the primary brand colour so this still reads as Zolo, with purple/blue
   used sparingly for the growth accents. The palette is scoped to this page
   via CSS variables on the root element — the global theme is untouched, which
   is what §2 requires.

   DATA: services and packages come from the database (Admin → Marketing).
   Nothing on this page is hardcoded marketing copy pretending to be live data:
   if the admin has published no packages, that section hides itself rather
   than inventing three tiers and prices.
   ========================================================= */

const palette = {
  "--ads-ink": "var(--color-dark-900)",
  "--ads-muted": "var(--color-dark-500)",
  "--ads-line": "var(--color-dark-200)",
  "--ads-surface": "#ffffff",
  "--ads-ground": "var(--color-dark-50)",
  "--ads-orange": "var(--color-primary-500)",
  "--ads-orange-dark": "var(--color-primary-600)",
  // The two growth accents. Used for gradients and icon chips only — never as
  // a third button colour, which is how these pages turn into confetti.
  "--ads-violet": "#6d28d9",
  "--ads-blue": "#2563eb",
} as CSSProperties;

/** Icon by service slug, with a sensible fallback so a new admin-created
 *  service still renders something rather than a hole. */
const ICONS: Record<string, typeof Megaphone> = {
  "digital-advertising": Megaphone,
  "social-media-marketing": Share2,
  seo: Search,
  "website-development": Globe2,
  "creative-content": PenTool,
  "lead-generation": Target,
  "whatsapp-marketing": MessageCircle,
  "marketing-strategy": LineChart,
};
const iconFor = (slug: string) => ICONS[slug] ?? Sparkles;

const VALUE_PROPS = [
  { icon: Target, title: "Business-focused strategy", body: "Plans built around what your business actually sells." },
  { icon: Megaphone, title: "Targeted advertising", body: "Campaigns aimed at the people most likely to buy." },
  { icon: PenTool, title: "Creative marketing", body: "Creatives and content made for your brand." },
  { icon: BarChart3, title: "Transparent reporting", body: "Clear reports on what ran and what it cost." },
  { icon: TrendingUp, title: "Continuous optimisation", body: "We keep adjusting campaigns as results come in." },
];

const STEPS = [
  { n: "01", title: "Understand your business", body: "We start with your products, audience, objectives and marketing budget." },
  { n: "02", title: "Build your strategy", body: "We prepare a marketing plan based on your goals and requirements." },
  { n: "03", title: "Launch your campaign", body: "Our team handles campaign setup, creatives, targeting and execution." },
  { n: "04", title: "Optimise and report", body: "We monitor performance, send reports and recommend improvements." },
];

const FAQS = [
  { q: "What digital marketing services does AdSens provide?", a: "Digital advertising (Google, Meta, YouTube, LinkedIn), social media marketing, SEO, website and landing page development, creative and content production, lead generation, WhatsApp business marketing, and marketing strategy consulting." },
  { q: "Can I choose only one service?", a: "Yes. You can start with a single service — many businesses begin with advertising or social media and add more later." },
  { q: "Do you manage Google and Meta Ads?", a: "Yes. We handle campaign setup, targeting, creatives, monitoring and ongoing optimisation on both platforms." },
  { q: "Is advertising platform spend included in the service fee?", a: "No. Our service fee covers strategy, setup, creatives, management and reporting. What you pay Google, Meta or any other platform for ad placement is separate and billed by them. We always show the two separately in a quotation." },
  { q: "Can AdSens help my business generate leads?", a: "We build and run campaigns designed to bring enquiries to your business. Results depend on your industry, budget, offer and competition, so we do not promise a fixed number of leads." },
  { q: "Do you provide monthly marketing reports?", a: "Yes. You receive reports covering what ran, how it performed and what we recommend changing." },
  { q: "Can I get a customised marketing package?", a: "Yes. Tell us your requirement and budget in the consultation form and we will prepare a plan for your business." },
  { q: "Can I use AdSens without purchasing packaging from Zolo?", a: "Yes. AdSens is a standalone service. You do not need to be a Zolo packaging customer." },
  { q: "How do I get started?", a: "Send a consultation request using the form on this page. Our team will review your requirements and contact you to discuss the next steps." },
  { q: "How are marketing campaign budgets decided?", a: "Together. We discuss your objectives and what you are comfortable spending, then recommend a split between platform ad spend and service work." },
];

export default function AdSens() {
  const [services, setServices] = useState<AdsensService[]>([]);
  const [packages, setPackages] = useState<AdsensPackage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showcase, setShowcase] = useState<AdsensShowcase>({ campaigns: [], caseStudies: [], categories: [] });
  const [preselect, setPreselect] = useState<{ services?: string[]; packageId?: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [caseStudySlug, setCaseStudySlug] = useState<string | null>(null);

  useEffect(() => {
    document.title = "AdSens by Zolo | Digital Marketing & Business Growth";
    const meta = document.querySelector('meta[name="description"]');
    const previous = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "AdSens by Zolo provides digital advertising, social media marketing, SEO, lead generation and creative services for businesses. Request a free marketing consultation.",
    );
    return () => { if (meta && previous !== null) meta.setAttribute("content", previous); };
  }, []);

  useEffect(() => {
    adsensApi
      .catalog()
      .then((d) => { setServices(d.services); setPackages(d.packages); })
      .catch(() => { /* the page still works without the catalog; the form does not depend on it */ })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    // Separate request from the catalog: the showcase sections hide
    // themselves when empty, so a failure here must not blank the services
    // list, and vice versa.
    adsensApi
      .showcase()
      .then(setShowcase)
      .catch(() => { /* the showcase rails simply do not render */ });
  }, []);

  /** Open the consultation dialog with a service or package already ticked (§5). */
  function startWith(next: { services?: string[]; packageId?: string }) {
    setPreselect(next);
    setFormOpen(true);
  }

  /**
   * "Explore Our Work" target. Prefers the portfolio, falls back to the
   * services list when nothing is published yet — the button must never be
   * a no-op, and `scroll-behavior` is respected so a reduced-motion visitor
   * does not get a long animated jump.
   */
  function scrollToWork() {
    const el = document.getElementById("portfolio") ?? document.getElementById("services");
    el?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  const featured = useMemo(() => services.slice(0, 5), [services]);

  return (
    <main style={palette} className="bg-[var(--ads-surface)] text-[var(--ads-ink)]">
      {/* ---- Dark showcase block (hero, campaigns, portfolio, positioning) ---- */}
      <DarkGround>
        <DarkHero
          campaigns={showcase.campaigns}
          onConsult={() => startWith({})}
          onExplore={scrollToWork}
        />
        <ActiveCampaigns campaigns={showcase.campaigns} onOpenCaseStudy={setCaseStudySlug} />
        <Portfolio
          caseStudies={showcase.caseStudies}
          categories={showcase.categories}
          onOpen={setCaseStudySlug}
        />
        <PackagingPromotion onCta={() => startWith({})} />
      </DarkGround>

      {/* ---- Value props (§4) ---- */}
      <section className="section bg-[var(--ads-ground)]">
        <div className="shell">
          <SectionHead
            eyebrow="Why AdSens"
            title="Marketing that focuses on business results."
            subtitle="No guarantees of sales or leads — just work we can explain and measure."
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {VALUE_PROPS.map((v, i) => (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="rounded-2xl border border-[var(--ads-line)] bg-white p-5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ads-orange)]/10 text-[var(--ads-orange)]">
                  <v.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-3 text-[15px] font-bold">{v.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ads-muted)]">{v.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Services (§5) ---- */}
      <section id="services" className="section">
        <div className="shell">
          <SectionHead
            eyebrow="What we do"
            title="Digital marketing services"
            subtitle="Pick one service or combine several — every engagement starts with a conversation."
          />

          {!loaded ? (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-52 animate-pulse rounded-2xl border border-[var(--ads-line)] bg-[var(--ads-ground)]" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <p className="mt-8 rounded-2xl border border-dashed border-[var(--ads-line)] px-6 py-10 text-center text-sm text-[var(--ads-muted)]">
              Our service list is being updated. Send a consultation request below and we'll walk you through what we offer.
            </p>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s, i) => {
                const Icon = iconFor(s.slug);
                return (
                  <motion.article
                    key={s.id}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.2) }}
                    className="group flex flex-col rounded-2xl border border-[var(--ads-line)] bg-white p-6 transition-shadow duration-200 hover:shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--ads-violet)] to-[var(--ads-blue)] text-white">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-base font-bold">{s.name}</h3>
                    {s.summary && <p className="mt-1.5 text-sm leading-relaxed text-[var(--ads-muted)]">{s.summary}</p>}
                    {s.deliverables?.length > 0 && (
                      <ul className="mt-4 space-y-1.5">
                        {s.deliverables.slice(0, 6).map((d) => (
                          <li key={d} className="flex items-start gap-2 text-[13px] text-[var(--ads-muted)]">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ads-orange)]" aria-hidden />
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      onClick={() => startWith({ services: [s.slug] })}
                      className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-bold text-[var(--ads-orange)] hover:text-[var(--ads-orange-dark)]"
                    >
                      Get started <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  </motion.article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ---- Featured services (§6) ---- */}
      {featured.length > 0 && (
        <section className="section bg-[var(--ads-ground)]">
          <div className="shell space-y-5">
            <SectionHead eyebrow="In focus" title="Where most businesses start" />
            {featured.map((s, i) => {
              const Icon = iconFor(s.slug);
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.35 }}
                  className={`grid items-center gap-6 rounded-2xl border border-[var(--ads-line)] bg-white p-6 sm:p-8 lg:grid-cols-2 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}
                >
                  <div>
                    <span className="inline-flex items-center gap-2 rounded-full bg-[var(--ads-orange)]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ads-orange)]">
                      <Icon className="h-3.5 w-3.5" aria-hidden /> {s.name}
                    </span>
                    <h3 className="h3 mt-3">{s.summary ?? s.name}</h3>
                    {s.deliverables?.length > 0 && (
                      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                        {s.deliverables.map((d) => (
                          <li key={d} className="flex items-start gap-2 text-sm text-[var(--ads-muted)]">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ads-orange)]" aria-hidden /> {d}
                          </li>
                        ))}
                      </ul>
                    )}
                    <button onClick={() => startWith({ services: [s.slug] })} className="btn btn-primary btn-sm mt-6">
                      Get started <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {/* An abstract growth panel rather than a stock photo: we have
                      no real campaign screenshots, and faking one would be a
                      claim about results we cannot make. */}
                  <div className="relative hidden h-52 overflow-hidden rounded-xl bg-gradient-to-br from-[var(--ads-violet)]/10 via-[var(--ads-blue)]/10 to-[var(--ads-orange)]/10 lg:block" aria-hidden>
                    <Icon className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 text-[var(--ads-violet)]/25" />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Process (§7) ---- */}
      <section className="section">
        <div className="shell">
          <SectionHead eyebrow="How it works" title="Four steps from first call to live campaign" />
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="relative rounded-2xl border border-[var(--ads-line)] bg-white p-5"
              >
                <span className="font-display text-2xl font-extrabold text-[var(--ads-orange)]/30">{s.n}</span>
                <h3 className="mt-2 text-[15px] font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--ads-muted)]">{s.body}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- Packages (§8). Hidden entirely when the admin has published
             none — three invented tiers would be fake data. ---- */}
      {packages.length > 0 && (
        <section className="section bg-[var(--ads-ground)]">
          <div className="shell">
            <SectionHead
              eyebrow="Packages"
              title="Marketing packages"
              subtitle="Service fees only. What you spend on Google, Meta or any other ad platform is separate and billed by them."
            />
            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {packages.map((p) => (
                <article
                  key={p.id}
                  className={`flex flex-col rounded-2xl border bg-white p-6 ${p.isFeatured ? "border-[var(--ads-orange)] shadow-[0_12px_32px_rgba(249,115,22,0.12)]" : "border-[var(--ads-line)]"}`}
                >
                  {p.isFeatured && (
                    <span className="mb-3 self-start rounded-full bg-[var(--ads-orange)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                      Most chosen
                    </span>
                  )}
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  {p.tagline && <p className="mt-1 text-sm text-[var(--ads-muted)]">{p.tagline}</p>}
                  <p className="mt-4 font-display text-2xl font-extrabold">
                    {p.priceMinor == null
                      ? <span className="text-xl">Custom quote</span>
                      : <>₹{(p.priceMinor / 100).toLocaleString("en-IN")}<span className="text-sm font-semibold text-[var(--ads-muted)]">/{p.billingPeriod === "month" ? "month" : "one-time"}</span></>}
                  </p>
                  {p.deliverables?.length > 0 && (
                    <ul className="mt-5 space-y-2">
                      {p.deliverables.map((d) => (
                        <li key={d} className="flex items-start gap-2 text-sm text-[var(--ads-muted)]">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ads-orange)]" aria-hidden /> {d}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    onClick={() => startWith({ packageId: p.id, services: p.services.map((s) => s.slug) })}
                    className={`btn btn-sm mt-auto w-full ${p.isFeatured ? "btn-primary" : "btn-secondary"} mt-6`}
                  >
                    Get a custom quote
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---- Zolo + AdSens (§9) ---- */}
      <section className="section">
        <div className="shell">
          <SectionHead
            eyebrow="One partner"
            title="From packaging to promotion — one business growth partner."
            subtitle="Zolo helps businesses with packaging; AdSens helps them promote what's inside it. The two are sold separately."
          />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[var(--ads-line)] bg-white p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-green-600"><Layers className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-3 text-base font-bold">Zolo Packaging</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--ads-muted)]">
                {["Packaging solutions", "Custom packaging", "Bulk packaging", "Product branding support"].map((x) => (
                  <li key={x} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden /> {x}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[var(--ads-line)] bg-white p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--ads-violet)] to-[var(--ads-blue)] text-white"><TrendingUp className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-3 text-base font-bold">AdSens</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-[var(--ads-muted)]">
                {["Digital advertising", "Brand promotion", "Social media marketing", "Lead generation"].map((x) => (
                  <li key={x} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ads-orange)]" aria-hidden /> {x}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Consultation (§10). The form itself lives in a dialog, so this
             section is the invitation rather than eleven fields the visitor
             has to scroll past to reach the FAQ. ---- */}
      <section id="consultation" className="section scroll-mt-20 bg-[var(--ads-ground)]">
        <div className="shell">
          <div className="rounded-2xl border border-[var(--ads-line)] bg-white px-6 py-10 text-center sm:px-10 sm:py-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ads-orange)]">Get started</p>
            <h2 className="h2 mt-2">Request a free consultation</h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--ads-muted)]">
              Tell us about your business and we'll come back with a plan — no obligation.
            </p>
            <button onClick={() => startWith({})} className="btn btn-primary btn-lg mt-7">
              Enquire now <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </section>

      {/* ---- FAQ (§13) ---- */}
      <section className="section">
        <div className="shell max-w-3xl">
          <SectionHead eyebrow="Questions" title="Frequently asked questions" />
          <div className="mt-8 divide-y divide-[var(--ads-line)] rounded-2xl border border-[var(--ads-line)] bg-white">
            {FAQS.map((f) => <Faq key={f.q} {...f} />)}
          </div>
        </div>
      </section>

      {/* ---- Final CTA (§14) ---- */}
      <section className="section">
        <div className="shell">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--ads-violet)] via-[var(--ads-blue)] to-[var(--ads-orange)] px-6 py-12 text-center text-white sm:px-10">
            <h2 className="h2 text-white">Ready to grow your business online?</h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/90">
              Let's build a marketing strategy that helps your business reach the right customers.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button onClick={() => startWith({})} className="btn btn-white btn-lg">
                Request a consultation
              </button>
              <a href="/contact" className="btn btn-lg border border-white/30 bg-white/10 text-white hover:bg-white/20">
                Talk to our team
              </a>
            </div>
          </div>
        </div>
      </section>

      <CaseStudyModal slug={caseStudySlug} onClose={() => setCaseStudySlug(null)} />

      <ConsultationModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        services={services}
        preselect={preselect}
      />
    </main>
  );
}

/* ---------- pieces ---------- */

function SectionHead({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35 }}
      className="max-w-2xl"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ads-orange)]">{eyebrow}</p>
      <h2 className="h2 mt-2">{title}</h2>
      {subtitle && <p className="lead mt-3">{subtitle}</p>}
    </motion.div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="text-[15px] font-semibold">{q}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--ads-muted)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <p className="px-5 pb-4 text-sm leading-relaxed text-[var(--ads-muted)]">{a}</p>}
    </div>
  );
}
