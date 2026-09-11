import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Truck,
  ShieldCheck,
  Headphones,
  Mail,
  Quote,
} from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { ProductCard } from "../components/NewProductCard";
import { PackagingCategorySection } from "../components/packaging/PackagingCategorySection";
import TrustedCustomers from "../components/TrustedCustomers";
import { ChevronLeft, ChevronRight } from "lucide-react";
import heroVideo from "../../images/banner-video .mp4";
import heroBg3 from "../../images/banner1-2.png";

// Hero slideshow: slide 1 is a video (headline/CTAs + overlay) that plays fully
// before advancing; slides 2–3 are clean full-bleed images (no text, no overlay)
// that auto-advance every 5s. Left/right arrows + dots for manual control. Loops.
const heroSlides = [
  { type: "video" as const, src: heroVideo, showContent: true },
  { type: "image" as const, src: heroBg3, showContent: false },
];
import { useEffect, useRef, useState } from "react";

// Import category images

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

export default function Home() {
  // Real product source only — the unified catalog store (API-backed when
  // reachable). No hardcoded demo array fallback: an empty catalog shows an
  // empty state rather than fake products.
  const source = useBuyerProducts();
  // "Bestseller" used to be invented from the price — there is no sales-rank
  // data yet, so this rail simply features the catalog.
  const featured = source.slice(0, 8);
  const newArrivalPool = source.filter((p) => p.newArrival);
  const newArrivals = (newArrivalPool.length > 0 ? newArrivalPool : source).slice(0, 4);

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

  return (
    <main>
      {/* HERO */}
      <section className="relative w-full aspect-[16/10] sm:aspect-[16/8] lg:aspect-[21/9] max-h-[88vh] flex items-center overflow-hidden bg-dark-950">
        {/* Background slides */}
        <div className="absolute inset-0">
          {heroSlides.map((slide, index) => (
            <div
              key={index}
              className={`absolute inset-0 transition-opacity duration-700 ${currentSlide === index ? "opacity-100" : "opacity-0"}`}
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
                  {/* Blurred fill of the same banner so its full artwork is shown
                      (object-contain) without black letterbox bars — the banners
                      have differing aspect ratios, so cover would crop them. */}
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

        {/* Bottom scrim seats the CTAs; navbar now sits above the hero so the
            full top of the video is visible (no top scrim needed). */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-gradient-to-t from-black/40 to-transparent" />

        {/* Hero CTAs — only on the first slide (re-animates each loop). The banner
            artwork already carries the headline, so we keep just the actions. */}
        {currentSlide === 0 && (
          <div className="absolute inset-x-0 bottom-10 z-20 mx-auto w-full max-w-7xl px-4 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="flex flex-wrap items-center gap-3"
            >
              <Link to="/rfq">
                <button className="rounded-full bg-primary-500 px-7 py-3 text-sm font-bold text-white shadow-lg shadow-primary-500/30 transition-all hover:bg-primary-600 hover:shadow-primary-500/40">
                  Get Custom Quote
                </button>
              </Link>
              <Link to="/products">
                <button className="rounded-full bg-white/90 px-7 py-3 text-sm font-bold text-dark-900 backdrop-blur transition-all hover:bg-white">
                  Explore Packaging
                </button>
              </Link>
            </motion.div>
          </div>
        )}

        {/* Prev / Next arrows */}
        <button
          onClick={prevSlide}
          aria-label="Previous slide"
          className="absolute left-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-all hover:bg-white/40 sm:h-12 sm:w-12"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={nextSlide}
          aria-label="Next slide"
          className="absolute right-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur transition-all hover:bg-white/40 sm:h-12 sm:w-12"
        >
          <ChevronRight className="h-6 w-6" />
        </button>

        {/* Slide dots */}
        <div className="absolute bottom-6 right-6 z-30 flex gap-2 sm:right-10">
          {heroSlides.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              aria-label={`Go to slide ${index + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                currentSlide === index ? "w-8 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      </section>

      {/* TRUST BAR */}
      <section className="bg-white border-y border-dark-100 py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {benefits.map((b, i) => (
              <motion.div
                key={b.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4"
              >
                <div className="h-12 w-12 rounded-2xl bg-primary-50 flex items-center justify-center shrink-0">
                  <b.icon className="h-5 w-5 text-primary-600" />
                </div>
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm text-dark-900">{b.title}</div>
                  <div className="text-xs text-dark-500 mt-0.5">{b.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

    

      {/* CATEGORIES — premium circular showcase, API-driven (see
          components/packaging/PackagingCategorySection). */}
      <PackagingCategorySection />

      {/* BESTSELLERS */}
      <section className="py-20 bg-dark-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 mb-3">
                <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
                Featured
              </div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-dark-900 leading-[1.05]">
                Featured <span className="grad-text">products</span>
              </h2>
              <p className="mt-3 text-lg text-dark-500">A selection from our packaging catalog</p>
            </div>
            <Link to="/products" className="text-sm font-bold text-dark-900 hover:text-primary-600 inline-flex items-center gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {featured.length === 0 ? (
            <div className="rounded-2xl border border-dark-100 bg-white p-12 text-center">
              <div className="text-5xl mb-3">📦</div>
              <p className="font-display text-lg font-bold text-dark-900">No products available yet</p>
              <p className="mt-1 text-sm text-dark-500">Products added in the catalog will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {featured.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* NEW ARRIVALS */}
      {newArrivals.length > 0 && (
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 mb-3">
                <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
                New Arrivals
              </div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-dark-900 leading-[1.05]">
                Fresh on the <span className="grad-text">market</span>
              </h2>
            </div>
            <Link to="/products?sort=new" className="text-sm font-bold text-dark-900 hover:text-primary-600 inline-flex items-center gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {newArrivals.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        </div>
      </section>
      )}

      {/* TRUSTED CUSTOMERS — logo marquee */}
      <TrustedCustomers />

      {/* WHY CHOOSE US / PROCESS */}
      <section className="py-20 bg-dark-950 text-white relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-light opacity-20" />
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-primary-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-400 mb-3">
              <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
              How it works
            </div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.05]">
              Your packaging, <span className="grad-text">in 4 simple steps</span>
            </h2>
            <p className="mt-4 text-lg text-dark-300">From idea to doorstep in days, not months</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {processSteps.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass-dark rounded-2xl p-6 relative"
              >
                <div className="font-display text-5xl font-extrabold grad-text mb-3">{step.n}</div>
                <h3 className="font-display text-lg font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-dark-300">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials section removed — the cards showed fictitious customers
          with invented quotes. Reinstate it when real testimonials exist. */}


      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 text-white relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-light opacity-10" />
        <div className="absolute -top-40 -right-40 w-[400px] h-[400px] rounded-full bg-white/10 blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 backdrop-blur px-4 py-1.5 text-xs font-bold mb-6">
            <Quote className="h-3 w-3" /> Request a quote today
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Ready to design your
            <br />
            <span className="text-white">first box?</span>
          </h2>
          <p className="mt-5 text-lg text-white/90 max-w-2xl mx-auto">
            Ship premium packaging for your brand with Zolo Packing.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 justify-center">
            <Link to="/rfq">
              <button className="inline-flex items-center gap-2 px-7 py-4 rounded-full bg-white text-primary-600 text-sm font-bold hover:bg-dark-50 transition-all shadow-lg">
                <Mail className="h-4 w-4" /> Get Free Quote <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <Link to="/products">
              <button className="inline-flex items-center gap-2 px-7 py-4 rounded-full bg-white/15 backdrop-blur text-white text-sm font-bold border border-white/30 hover:bg-white/25 transition-all">
                Browse catalog
              </button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
