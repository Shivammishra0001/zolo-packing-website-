import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { CampaignPopup, HomepageCampaignBanner, PromotionCards } from "@/components/marketing/campaigns";
import { useBuyerProducts } from "../lib/products";
import { isCatalogHydrated, onCatalogPersistError } from "@/admin/catalog-store";
import { useParentCategories } from "@/lib/use-parent-categories";
import { ProductGrid } from "../components/ProductGrid";
import { PackagingCategorySection } from "../components/packaging/PackagingCategorySection";
import TrustedCustomers from "../components/TrustedCustomers";
import { HomeHero } from "../components/home/HomeHero";
import { BenefitStrip } from "../components/home/BenefitStrip";
import { FeaturedProducts } from "../components/home/FeaturedProducts";
import { PromoPanels } from "../components/home/PromoPanels";
import { FinalCta } from "../components/home/FinalCta";
import { SectionHeader, SkeletonGrid } from "../components/UI";

// ============================================================
// Home — the Zolo Packing landing page.
//
// Flow (discover → understand → browse → trust → convert):
//
//   hero              what Zolo sells, who for, two ways in
//   benefit strip     reassurance, riding the hero seam
//   campaign banner   admin-managed, renders nothing when none is live
//   categories        circular quick-nav + visual discovery cards
//   featured          product rail with dynamic category tabs
//   promo panels      sustainability | custom packaging
//   new arrivals      admin-selected, hidden when empty
//   trusted by        real customer logos
//   how it works      the 4-step service explainer
//   final CTA         shop or quote, plus real contact details
//
// Data rules that shape this page:
//   * Products come only from the live catalog store — no demo array.
//   * "Featured" / "New arrivals" are admin flags in PostgreSQL, never a
//     createdAt or random fallback.
//   * There is no rating, review or sales-rank data, so there are no stars,
//     no review counts and no "Best Seller" claims anywhere (§17/§18/§35).
//   * There is no newsletter backend, so no subscribe form is shown.
// ============================================================

const processSteps = [
  { n: "01", title: "Choose packaging", desc: "Browse the catalog or send us your spec" },
  { n: "02", title: "Customise it", desc: "Add your branding, colours and finishes" },
  { n: "03", title: "Get a quote", desc: "Clear pricing with no hidden fees" },
  { n: "04", title: "Receive delivery", desc: "Reliable, tracked shipping" },
];

/** Subtle section reveal: fade + 10px, 350ms (design-system motion). */
const reveal = {
  initial: { opacity: 0, y: 10 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.35 },
} as const;

export default function Home() {
  // Real product source only — the unified catalog store (API-backed when
  // reachable). No hardcoded demo array fallback: an empty catalog shows an
  // empty state rather than fake products.
  const source = useBuyerProducts();
  const [catalogFailed, setCatalogFailed] = useState(false);
  useEffect(() => {
    const off = onCatalogPersistError(() => setCatalogFailed(true));
    return () => { off(); };
  }, []);
  const catalogLoading = !isCatalogHydrated() && !catalogFailed;

  // Top-level categories, shared with the category band and the product tabs
  // (one request — see lib/use-parent-categories).
  const categoryState = useParentCategories();
  const parentCategories = categoryState.status === "ready" ? categoryState.categories : [];

  // Both rails are chosen by the admin (Add/Edit product → Homepage
  // visibility) and stored in PostgreSQL. Unordered picks sort after
  // explicitly ordered ones; ProductGrid trims each pool to complete rows.
  const UNORDERED = 999_999;
  const featured = source
    .filter((p) => p.isFeatured)
    .sort((a, b) => (a.featuredOrder ?? UNORDERED) - (b.featuredOrder ?? UNORDERED) || a.name.localeCompare(b.name))
    .slice(0, 16);
  const newArrivals = source
    .filter((p) => p.isNewArrival)
    .sort((a, b) => (a.newArrivalOrder ?? UNORDERED) - (b.newArrivalOrder ?? UNORDERED) || a.name.localeCompare(b.name))
    .slice(0, 12);

  return (
    <main>
      <CampaignPopup />

      <HomeHero />
      <BenefitStrip />

      {/* Admin-managed campaigns (Marketing → Campaigns). Each renders nothing
          when no campaign is live for its placement. */}
      <HomepageCampaignBanner />
      <PromotionCards />

      {/* CATEGORIES — circular quick-nav + visual cards, parent categories only. */}
      <PackagingCategorySection />

      {/* FEATURED — admin-curated, with dynamic category tabs. */}
      <FeaturedProducts products={featured} categories={parentCategories} loading={catalogLoading} />

      {/* SUSTAINABILITY | CUSTOM PACKAGING */}
      <PromoPanels />

      {/* NEW ARRIVALS — hidden entirely once loaded with nothing selected.
          White, because the cream "Trusted by" band follows immediately: two
          cream sections in a row would read as one long undifferentiated block
          instead of a rhythm. */}
      {(catalogLoading || newArrivals.length > 0) && (
        <section className="section bg-white" aria-label="New arrivals">
          <div className="shell">
            <SectionHeader
              eyebrow="New arrivals"
              title="Fresh on the market"
              subtitle="The latest additions to our range"
              action={
                <Link to="/products?sort=latest" className="btn btn-ghost btn-sm">
                  View all <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
              className="mb-5"
            />
            {catalogLoading ? <SkeletonGrid count={4} /> : <ProductGrid products={newArrivals} maxRows={1} />}
          </div>
        </section>
      )}

      {/* TRUSTED CUSTOMERS — real logo marquee */}
      <TrustedCustomers />

      {/* HOW IT WORKS — dark navy band. SectionHeader hard-codes dark text, so
          the heading is composed inline here with the same scale. */}
      <section className="section bg-navy-900 text-white" aria-label="How it works">
        <div className="shell">
          <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-400">How it works</p>
            <h2 className="h2 mt-2 text-white">Your packaging, in 4 simple steps</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/75 sm:text-base">From idea to doorstep in days, not months</p>
          </motion.div>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {processSteps.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
                className="rounded-[12px] border border-white/10 bg-white/5 p-5"
              >
                <div className="font-display text-2xl font-extrabold text-green-400">{step.n}</div>
                <h3 className="mt-3 text-base font-bold text-white">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/70">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials intentionally absent: the previous cards showed
          fictitious customers with invented quotes. Reinstate when real
          testimonials exist. */}

      <FinalCta />
    </main>
  );
}
