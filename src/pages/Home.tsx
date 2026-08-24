import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Truck,
  ShieldCheck,
  Headphones,
  Star,
  Mail,
  Quote,
} from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { ProductCard } from "../components/NewProductCard";
import { ChevronLeft, ChevronRight } from "lucide-react";
import heroVideo from "../../images/banner-video .mp4";
import heroBg2 from "../../images/herobg-2.png";
import heroBg3 from "../../images/brown kraft tape.png";

// Hero slideshow: slide 1 is a video (headline/CTAs + overlay) that plays fully
// before advancing; slides 2–3 are clean full-bleed images (no text, no overlay)
// that auto-advance every 5s. Left/right arrows + dots for manual control. Loops.
const heroSlides = [
  { type: "video" as const, src: heroVideo, showContent: true },
  { type: "image" as const, src: heroBg2, showContent: false },
  { type: "image" as const, src: heroBg3, showContent: false },
];
import { useEffect, useRef, useState } from "react";

// Import category images

const benefits = [
  { icon: Truck, title: "Fast shipping", desc: "Worldwide delivery in 5-10 days" },
  { icon: ShieldCheck, title: "Quality guaranteed", desc: "Rigorous QC on every order" },
  { icon: Headphones, title: "24/7 support", desc: "Expert help anytime" },
];

// Demo categories removed. Empty until real categories are added.
const categories: { id: string; name: string; slug: string; icon: string; count: number; image: string }[] = [];


const processSteps = [
  { n: "01", title: "Choose Packaging", desc: "Browse our catalog of 2,400+ packaging solutions" },
  { n: "02", title: "Customize Design", desc: "Add your branding, colors, and custom finishes" },
  { n: "03", title: "Get a Quote", desc: "Receive instant pricing with no hidden fees" },
  { n: "04", title: "Receive Delivery", desc: "Fast worldwide shipping in 5-10 days" },
];

const testimonials = [
  { name: "Sarah Chen", quote: "Zolo Packing transformed our packaging. The quality is outstanding and delivery is always on time.", rating: 5, avatar: "SC", color: "from-pink-500 to-rose-500" },
  { name: "Marcus Webb", quote: "Being able to preview packaging in detail before production is a total game-changer for our team.", rating: 5, avatar: "MW", color: "from-brand-500 to-accent-400" },
  { name: "Priya Raman", quote: "The print quality and finishes render so accurately — what we see is exactly what arrives.", rating: 5, avatar: "PR", color: "from-violet-500 to-fuchsia-500" },
];

const faqs = [
  { q: "What are your minimum order quantities?", a: "MOQs start at just 10 units for prototypes and 50 for short runs. Large orders receive significant volume discounts automatically." },
  { q: "Do you ship internationally?", a: "Yes — we ship to 180+ countries worldwide with tracked shipping. Average delivery time is 5-10 business days." },
  { q: "Can I request a sample before bulk ordering?", a: "Yes! Free samples are available on orders over ₹500. For smaller quantities, samples are available at cost." },
  { q: "What printing options are available?", a: "We offer digital, offset litho, and flexo printing with options for foil stamping, embossing, spot UV, and custom die-cutting." },
  { q: "Are your materials eco-friendly?", a: "Absolutely. Over 500+ of our products use recycled, biodegradable, or compostable materials with FSC certification." },
  { q: "How do I upload my artwork for printing?", a: "Once you select your packaging, you can upload artwork directly in our 3D studio (PDF, AI, or high-res PNG) or email it to contact@zolopacking.com." },
];

export default function Home() {
  // Real product source only — the unified catalog store (API-backed when
  // reachable). No hardcoded demo array fallback: an empty catalog shows an
  // empty state rather than fake products.
  const source = useBuyerProducts();
  const bestsellers = source.filter((p) => p.bestseller).slice(0, 8);
  const newArrivalPool = source.filter((p) => p.newArrival);
  const newArrivals = (newArrivalPool.length > 0 ? newArrivalPool : source).slice(0, 4);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const [currentSlide, setCurrentSlide] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const nextSlide = () =>
    setCurrentSlide((prev) => (prev === heroSlides.length - 1 ? 0 : prev + 1));
  const prevSlide = () =>
    setCurrentSlide((prev) => (prev === 0 ? heroSlides.length - 1 : prev - 1));

  // Image slides auto-advance after 5s. The video slide is skipped here — it
  // advances only once the clip finishes (see the video's onEnded handler),
  // so the whole video plays before moving to the next image.
  useEffect(() => {
    if (heroSlides[currentSlide].type === "video") return;
    const timer = setTimeout(nextSlide, 5000);
    return () => clearTimeout(timer);
  }, [currentSlide]);

  // Restart the clip from the beginning each time we land on the video slide.
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
              className={`absolute inset-0 ${currentSlide === index ? "opacity-100" : "opacity-0"}`}
            >
              {slide.type === "video" ? (
                <video
                  ref={videoRef}
                  src={slide.src}
                  className="h-full w-full object-cover"
                  autoPlay
                  muted
                  playsInline
                  preload="auto"
                  onEnded={nextSlide}
                />
              ) : (
                <img
                  src={slide.src}
                  alt={`Zolo Packaging hero ${index + 1}`}
                  className="h-full w-full object-cover"
                />
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
              <Link to="/contact">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
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
                <div>
                  <div className="font-display font-bold text-sm text-dark-900">{b.title}</div>
                  <div className="text-xs text-dark-500 mt-0.5">{b.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

    

      {/* CATEGORIES */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 mb-3">
                <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
                Categories
              </div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-dark-900 leading-[1.05]">
                Shop by <span className="grad-text">packaging type</span>
              </h2>
              <p className="mt-3 text-lg text-dark-500">Explore our full catalog of premium packaging solutions</p>
            </div>
            <Link to="/categories" className="text-sm font-bold text-dark-900 hover:text-primary-600 inline-flex items-center gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={`/products?category=${c.slug}`}
                  className="group block relative rounded-2xl overflow-hidden card-shadow card-shadow-hover bg-white border border-dark-100 aspect-[4/5] flex flex-col"
                >
                  <div className="flex-1 bg-white p-4 flex items-center justify-center overflow-hidden">
                    <img
                      src={c.image}
                      alt={c.name}
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-4 bg-dark-50 border-t border-dark-100 z-10 text-center">
                    <div className="text-dark-900 font-display font-bold text-sm leading-tight group-hover:text-primary-600 transition-colors">{c.name}</div>
                    <div className="text-dark-500 text-[10px] mt-1">{c.count} products</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* BESTSELLERS */}
      <section className="py-20 bg-dark-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 mb-3">
                <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
                Bestsellers
              </div>
              <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-dark-900 leading-[1.05]">
                Top-selling <span className="grad-text">products</span>
              </h2>
              <p className="mt-3 text-lg text-dark-500">Our most-loved packaging, chosen by 50+ brands</p>
            </div>
            <Link to="/products?sort=bestseller" className="text-sm font-bold text-dark-900 hover:text-primary-600 inline-flex items-center gap-1">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {bestsellers.length === 0 ? (
            <div className="rounded-2xl border border-dark-100 bg-white p-12 text-center">
              <div className="text-5xl mb-3">📦</div>
              <p className="font-display text-lg font-bold text-dark-900">No products available yet</p>
              <p className="mt-1 text-sm text-dark-500">Products added in the catalog will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {bestsellers.map((p, i) => (
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

      {/* CLIENTS */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 mb-3">
              <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
              Clients
            </div>
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-dark-900 leading-[1.05]">
              Loved by <span className="grad-text">50+ brands</span>
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-dark-50 rounded-2xl p-6 border border-dark-100"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(t.rating)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-dark-700 leading-relaxed">"{t.quote}"</p>
                <div className="flex items-center gap-3 mt-6 pt-5 border-t border-dark-200">
                  <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${t.color} text-white font-bold text-sm flex items-center justify-center`}>
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-dark-900">{t.name}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-dark-50">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center mb-12">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600 mb-3">
              <span className="inline-block h-1 w-6 rounded-full bg-primary-500 mr-2" />
              FAQ
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-dark-900">
              Frequently asked <span className="grad-text">questions</span>
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div key={i} className="bg-white rounded-2xl border border-dark-100 overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left"
                >
                  <span className="font-bold text-dark-900">{f.q}</span>
                  <motion.span animate={{ rotate: openFaq === i ? 45 : 0 }} className="text-dark-400 text-2xl">
                    +
                  </motion.span>
                </button>
                {openFaq === i && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="px-5 pb-5 text-sm text-dark-600 leading-relaxed"
                  >
                    {f.a}
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

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
            Join 50+ brands shipping premium packaging with Zolo Packing.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 justify-center">
            <Link to="/contact">
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
