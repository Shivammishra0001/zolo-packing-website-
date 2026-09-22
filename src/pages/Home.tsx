import { CampaignPopup, HomepageCampaignBanner, PromotionCards } from "@/components/marketing/campaigns";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Truck,
  ShieldCheck,
  Headphones,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { isCatalogHydrated, onCatalogPersistError } from "@/admin/catalog-store";
import { ProductGrid } from "../components/ProductGrid";
import { PackagingCategorySection } from "../components/packaging/PackagingCategorySection";
import TrustedCustomers from "../components/TrustedCustomers";
import { EmptyState, SectionHeader, SkeletonGrid } from "../components/UI";
import heroVideo from "../../images/banner-video .mp4";
import heroBg3 from "../../images/banner1-2.png";

// Hero slideshow: slide 1 is a video that carries the headline + CTAs; slide 2
// is a clean full-bleed image (no text). Left/right arrows + dots for manual
// control. Loops.
const heroSlides = [
  { type: "video" as const, src: heroVideo, showContent: true },
  { type: "image" as const, src: heroBg3, showContent: false },
];
import { useEffect, useRef, useState } from "react";

const benefits = [
  { icon: Truck, title: "Fast shipping", desc: "Worldwide delivery in 5-10 days" },
  { icon: ShieldCheck, title: "Quality guaranteed", desc: "Rigorous QC on every order" },
  { icon: Headphones, title: "24/7 support", desc: "Expert help anytime" },
];

const processSteps = [
  { n: "01", title: "Choose Packaging", desc: "Browse our catalog of packaging solutions" },
  { n: "02", title: "Customize Design", desc: "Add your branding, colors, and custom finishes" },
  { n: "03", title: "Get a Quote", desc: "Receive pricing with no hidden fees" },
  { n: "04", title: "Receive Delivery", desc: "Reliable, tracked shipping" },
];

// Testimonials removed: the previous entries were fictitious people with
// invented quotes. Real customer testimonials belong here once collected —
// never fabricated ones.

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
  // Loading = the catalog store has not hydrated from the API yet. A failed
  // hydration flips this off so the rails show their real empty states instead
  // of shimmering forever.
  const [catalogFailed, setCatalogFailed] = useState(false);
  useEffect(() => {
    const off = onCatalogPersistError(() => setCatalogFailed(true));
    return () => { off(); };
  }, []);
  const catalogLoading = !isCatalogHydrated() && !catalogFailed;

  // Both rails are chosen by the admin (Add/Edit product → Homepage
  // visibility) and stored in PostgreSQL. `source` is already active-only.
  // Nothing here depends on API order, createdAt or position, and there is NO
  // fallback that promotes other products: an unselected rail is simply empty.
  // Unordered picks sort after explicitly ordered ones; ProductGrid trims each
  // pool to complete rows for the column count the viewport resolves to.
  const UNORDERED = 999_999;
  const featured = source
    .filter((p) => p.isFeatured)
    .sort((a, b) => (a.featuredOrder ?? UNORDERED) - (b.featuredOrder ?? UNORDERED) || a.name.localeCompare(b.name))
    .slice(0, 16);
  const newArrivals = source
    .filter((p) => p.isNewArrival)
    .sort((a, b) => (a.newArrivalOrder ?? UNORDERED) - (b.newArrivalOrder ?? UNORDERED) || a.name.localeCompare(b.name))
    .slice(0, 12);

  const [currentSlide, setCurrentSlide] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const nextSlide = () =>
    setCurrentSlide((prev) => (prev === heroSlides.length - 1 ? 0 : prev + 1));
  const prevSlide = () =>
    setCurrentSlide((prev) => (prev === 0 ? heroSlides.length - 1 : prev - 1));

  // All slides auto-advance. The video loops continuously (no play button), so
  // it gets a longer dwell (9s) before the carousel moves on; images advance
  // every 4.5s.
  useEffect(() => {
    const isVideo = heroSlides[currentSlide].type === "video";
    const timer = setTimeout(nextSlide, isVideo ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [currentSlide]);

  // Kick the muted, looping clip into playback whenever we land on it — this
  // guarantees autoplay (and hides any browser play-button overlay) even if the
  // initial autoplay attempt was deferred while the slide was hidden.
  useEffect(() => {
    if (heroSlides[currentSlide].type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }, [currentSlide]);

  const showHeroCopy = heroSlides[currentSlide].showContent;

  return (
    <main>
      <CampaignPopup />

      {/* HERO — bounded height carousel (the header is solid white and sits
          above it, so no top padding / scrim is needed). */}
      <section
        className="relative w-full overflow-hidden bg-navy-900 aspect-[4/3] min-h-[460px] sm:min-h-0 sm:aspect-[16/9] lg:aspect-[16/7] max-h-[520px]"
        aria-label="Zolo Packaging highlights"
      >
        {/* Background slides */}
        <div className="absolute inset-0">
          {heroSlides.map((slide, index) => (
            <div
              key={index}
              className={`absolute inset-0 transition-opacity duration-500 ${currentSlide === index ? "opacity-100" : "opacity-0"}`}
              aria-hidden={currentSlide !== index}
            >
              {slide.type === "video" ? (
                <video
                  ref={videoRef}
                  src={slide.src}
                  className="h-full w-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                />
              ) : (
                <>
                  {/* Soft fill of the same banner behind an object-contain copy,
                      so the full artwork shows without letterbox bars (the
                      banners have differing aspect ratios). */}
                  <img
                    src={slide.src}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
                  />
                  <img
                    src={slide.src}
                    alt={`Zolo Packaging hero ${index + 1}`}
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Readability scrim under the message (only while copy is shown). */}
        <div
          className={`pointer-events-none absolute inset-0 z-10 bg-navy-950/45 transition-opacity duration-500 lg:bg-gradient-to-r lg:from-navy-950/75 lg:via-navy-950/40 lg:to-navy-950/5 ${showHeroCopy ? "opacity-100" : "opacity-0"}`}
          aria-hidden
        />

        {/* Hero message — compact two-column: copy left, artwork breathes right. */}
        {showHeroCopy && (
          <div className="absolute inset-0 z-20 flex items-center">
            <div className="shell">
              <div className="grid items-center gap-6 lg:grid-cols-2">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                  className="max-w-xl"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cream-100">Premium packaging, made in India</p>
                  <h1 className="h1 mt-2 text-white">Packaging that sells your brand</h1>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/85 sm:text-[17px]">
                    Custom boxes, pouches and sustainable packaging — designed, printed and delivered.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link to="/rfq" className="btn btn-primary btn-lg">
                      Get Custom Quote <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                    <Link to="/products" className="btn btn-white btn-lg">
                      Explore Packaging
                    </Link>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        )}

        {/* Prev / Next arrows */}
        <button
          type="button"
          onClick={prevSlide}
          aria-label="Previous slide"
          className="absolute right-16 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/90 text-dark-900 transition-colors hover:bg-white sm:left-4 sm:right-auto sm:top-1/2 sm:-translate-y-1/2"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={nextSlide}
          aria-label="Next slide"
          className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/90 text-dark-900 transition-colors hover:bg-white sm:top-1/2 sm:-translate-y-1/2"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>

        {/* Slide dots */}
        <div className="absolute bottom-4 right-4 z-30 flex gap-2 sm:bottom-6 sm:right-8">
          {heroSlides.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentSlide(index)}
              aria-label={`Go to slide ${index + 1}`}
              aria-current={currentSlide === index}
              className={`h-2 rounded-full transition-all duration-300 ${
                currentSlide === index ? "w-8 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      </section>

      {/* Admin-managed campaigns (Marketing → Campaigns). Each renders nothing
          when no campaign is live for its placement. */}
      <HomepageCampaignBanner />

      {/* TRUST STRIP */}
      <section className="section-sm bg-white">
        <div className="shell">
          <motion.div {...reveal} className="card-flat grid grid-cols-1 divide-y divide-dark-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {benefits.map((b) => (
              <div key={b.title} className="flex items-center gap-3 px-5 py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-500">
                  <b.icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-dark-900">{b.title}</div>
                  <div className="mt-0.5 text-xs text-dark-500">{b.desc}</div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      <PromotionCards />

      {/* CATEGORIES — API-driven (see components/packaging/PackagingCategorySection). */}
      <PackagingCategorySection />

      {/* FEATURED */}
      <section className="section bg-white">
        <div className="shell">
          <SectionHeader
            eyebrow="Featured"
            title="Featured products"
            subtitle="A selection from our packaging catalog"
            action={
              <Link to="/products" className="btn btn-ghost btn-sm">
                View all <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
            className="mb-6"
          />

          {catalogLoading ? (
            <SkeletonGrid count={4} />
          ) : featured.length === 0 ? (
            <EmptyState
              title="No featured products yet"
              message="Products marked as Featured in the catalog will appear here."
              action={<Link to="/products" className="btn btn-secondary btn-sm">Browse all products</Link>}
            />
          ) : (
            <ProductGrid products={featured} maxRows={2} />
          )}
        </div>
      </section>

      {/* NEW ARRIVALS — hidden entirely once loaded with nothing selected. */}
      {(catalogLoading || newArrivals.length > 0) && (
        <section className="section bg-cream-50">
          <div className="shell">
            <SectionHeader
              eyebrow="New arrivals"
              title="Fresh on the market"
              subtitle="The latest additions to our range"
              action={
                <Link to="/products?sort=new" className="btn btn-ghost btn-sm">
                  View all <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
              className="mb-6"
            />
            {catalogLoading ? <SkeletonGrid count={4} /> : <ProductGrid products={newArrivals} maxRows={1} />}
          </div>
        </section>
      )}

      {/* TRUSTED CUSTOMERS — logo marquee */}
      <TrustedCustomers />

      {/* HOW IT WORKS — dark navy band. SectionHeader hard-codes dark text, so
          the heading is composed inline here with the same scale. */}
      <section className="section bg-navy-900 text-white">
        <div className="shell">
          <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-400">How it works</p>
            <h2 className="h2 mt-2 text-white">Your packaging, in 4 simple steps</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/75 sm:text-[17px]">From idea to doorstep in days, not months</p>
          </motion.div>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
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

      {/* Testimonials section removed — the cards showed fictitious customers
          with invented quotes. Reinstate it when real testimonials exist. */}

      {/* FINAL CTA */}
      <section className="section bg-green-800 text-white">
        <div className="shell">
          <motion.div {...reveal} className="mx-auto max-w-2xl text-center">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-green-300">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Request a quote today
            </p>
            <h2 className="h2 mt-2 text-white">Ready to design your first box?</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/80 sm:text-[17px]">
              Ship premium, sustainable packaging for your brand with Zolo Packing.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/rfq" className="btn btn-primary">
                Get Free Quote <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/products" className="btn btn-white">
                Browse catalog
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
