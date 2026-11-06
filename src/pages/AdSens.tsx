import { useEffect, useState } from "react";
import { adsensApi, type AdsensService, type AdsensShowcase } from "../lib/api/adsens";
import { DarkGround } from "../components/adsens/dark";
import { DarkHero } from "../components/adsens/DarkHero";
import { ServicesOverview } from "../components/adsens/ServicesOverview";
import { ActiveCampaigns } from "../components/adsens/ActiveCampaigns";
import { Portfolio } from "../components/adsens/Portfolio";
import { Approach } from "../components/adsens/Approach";
import { WhyAdSens } from "../components/adsens/WhyAdSens";
import { PackagingPromotion } from "../components/adsens/PackagingPromotion";
import { ConsultationCta } from "../components/adsens/ConsultationCta";
import { Faq } from "../components/adsens/Faq";
import { CaseStudyModal } from "../components/adsens/CaseStudyModal";
import { ConsultationModal } from "../components/adsens/ConsultationModal";

/* =========================================================
   ADSENS BY ZOLO — digital marketing services.
   Route: /adsens

   DESIGN. One continuous dark surface, per the supplied agency references:
   near-black navy ground, cyan/violet gradients, glass cards with hairline
   gradient edges, real photography. The palette is a set of CSS variables
   scoped to the DarkGround wrapper — the global Zolo theme, the header, the
   footer and every other page are untouched. Zolo's orange still appears in
   the shared chrome, so the page reads as part of the same site.

   DATA. Services, campaigns and case studies all come from PostgreSQL via
   Admin → Marketing. Nothing on this page is hardcoded marketing content:
   a section with nothing published hides itself rather than inventing
   filler.

   NO PRICING. §7 of the brief rules out a pricing section, so the packages
   rail that used to sit between the process and Zolo+AdSens is gone. The
   MarketingPackage table stays — leads reference it by FK, and the admin
   still quotes from it privately — but no price is rendered publicly.

   ON THE REFERENCE'S NUMBERS. The references carry "250+ Clients Served",
   "12.4K Clicks", "#1 Ranking", "89K Visits", "3.8x ROAS" and six named
   client brands. All of it is invented. §5 and §6 forbid showing fabricated
   campaign data, so the compositions are matched while the content stays
   admin-owned, with the server stripping any claim that has not been
   verified. See docs/ADSENS.md §10.
   ========================================================= */

export default function AdSens() {
  const [services, setServices] = useState<AdsensService[]>([]);
  const [showcase, setShowcase] = useState<AdsensShowcase>({ campaigns: [], caseStudies: [], categories: [] });
  const [loaded, setLoaded] = useState(false);
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
      .then((d) => setServices(d.services))
      .catch(() => { /* the page still works without the catalog; the form does not depend on it */ })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    // Separate request from the catalog: the showcase rails hide themselves
    // when empty, so a failure here must not blank the services list, and
    // vice versa.
    adsensApi
      .showcase()
      .then(setShowcase)
      .catch(() => { /* the showcase rails simply do not render */ });
  }, []);

  /** Open the consultation dialog with a service already ticked. */
  function startWith(next: { services?: string[]; packageId?: string }) {
    setPreselect(next);
    setFormOpen(true);
  }

  /**
   * "View Our Work" target. Prefers the portfolio, falls back to the
   * campaigns rail and then the services list, so the button is never a
   * no-op however little is published. Honours reduced motion, which a bare
   * `behavior: "smooth"` would not.
   */
  function scrollToWork() {
    const el =
      document.getElementById("portfolio") ??
      document.getElementById("campaigns") ??
      document.getElementById("services");
    el?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <DarkGround>
      <DarkHero campaigns={showcase.campaigns} onConsult={() => startWith({})} onExplore={scrollToWork} />

      <ServicesOverview services={services} loaded={loaded} onStart={(slug) => startWith({ services: [slug] })} />

      <ActiveCampaigns campaigns={showcase.campaigns} onOpenCaseStudy={setCaseStudySlug} />

      <Portfolio caseStudies={showcase.caseStudies} categories={showcase.categories} onOpen={setCaseStudySlug} />

      <Approach />

      <WhyAdSens />

      <PackagingPromotion onCta={() => startWith({})} />

      <ConsultationCta onConsult={() => startWith({})} />

      <Faq />

      <CaseStudyModal slug={caseStudySlug} onClose={() => setCaseStudySlug(null)} />

      <ConsultationModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        services={services}
        preselect={preselect}
      />
    </DarkGround>
  );
}
