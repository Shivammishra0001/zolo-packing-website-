import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import heroVideo from "../../../images/banner-video .mp4";
import heroBg3 from "../../../images/banner1-2.png";

// ============================================================
// HomeHero — the video carousel.
//
// Slide 1 is a looping, muted video that carries the headline and CTAs.
// Slide 2 is a clean full-bleed banner with no text. Arrows and dots give
// manual control; both slides auto-advance.
//
// Restored from the pre-471b191 design at the owner's request. It lives in
// this component rather than inline in Home.tsx so the page keeps its current
// section composition and the hero stays independently editable.
//
// Height is bounded (4:3 on phones → 16:7 on desktop, capped at 520px) so the
// hero never pushes the rest of the page below the fold.
// ============================================================

const heroSlides = [
  { type: "video" as const, src: heroVideo, showContent: true },
  { type: "image" as const, src: heroBg3, showContent: false },
];

/** Dwell per slide. The video loops, so it gets longer before advancing. */
const VIDEO_MS = 9000;
const IMAGE_MS = 4500;

export function HomeHero() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const nextSlide = () => setCurrentSlide((prev) => (prev === heroSlides.length - 1 ? 0 : prev + 1));
  const prevSlide = () => setCurrentSlide((prev) => (prev === 0 ? heroSlides.length - 1 : prev - 1));

  useEffect(() => {
    const isVideo = heroSlides[currentSlide].type === "video";
    const timer = setTimeout(nextSlide, isVideo ? VIDEO_MS : IMAGE_MS);
    return () => clearTimeout(timer);
  }, [currentSlide]);

  // Kick the muted, looping clip into playback whenever we land on it, so
  // autoplay still happens (and no browser play-button overlay appears) even
  // if the first attempt was deferred while the slide was hidden.
  useEffect(() => {
    if (heroSlides[currentSlide].type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {
      // Autoplay refused (e.g. a data-saver setting). The poster frame stays,
      // the copy and CTAs are unaffected, and the carousel keeps advancing.
    });
  }, [currentSlide]);

  const showHeroCopy = heroSlides[currentSlide].showContent;

  return (
    <section
      className="relative aspect-[4/3] max-h-[520px] min-h-[460px] w-full overflow-hidden bg-navy-900 sm:aspect-[16/9] sm:min-h-0 lg:aspect-[16/7]"
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
                {/* Soft blurred fill of the same banner behind an
                    object-contain copy, so the full artwork shows without
                    letterbox bars (the banners differ in aspect ratio). */}
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

      {/* Readability scrim, only while copy is shown. */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 bg-navy-950/45 transition-opacity duration-500 lg:bg-gradient-to-r lg:from-navy-950/75 lg:via-navy-950/40 lg:to-navy-950/5 ${showHeroCopy ? "opacity-100" : "opacity-0"}`}
        aria-hidden
      />

      {/* Hero message */}
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
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cream-100">
                  Premium packaging, made in India
                </p>
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

      {/* Prev / Next */}
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
  );
}
