import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
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

/**
 * How long the still banner holds before returning to the video.
 *
 * The VIDEO has no timer: it advances when it actually ends (onEnded), so the
 * clip is never cut off mid-way and the sequence does not drift if the file is
 * re-encoded to a different length.
 */
const IMAGE_MS = 6000;

export function HomeHero() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const nextSlide = () => setCurrentSlide((prev) => (prev === heroSlides.length - 1 ? 0 : prev + 1));

  // Only the image slide is on a timer. The video hands over in onEnded below.
  useEffect(() => {
    if (heroSlides[currentSlide].type === "video") return;
    const timer = setTimeout(nextSlide, IMAGE_MS);
    return () => clearTimeout(timer);
  }, [currentSlide]);

  // Start the muted clip from the top whenever we land on it, so autoplay
  // still happens (and no browser play-button overlay appears) even if the
  // first attempt was deferred while the slide was hidden.
  useEffect(() => {
    if (heroSlides[currentSlide].type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;

    // The video normally hands over in onEnded. If autoplay is REFUSED — a
    // data-saver setting, reduced-motion, an unsupported codec — onEnded never
    // fires and the hero would sit frozen on the first frame forever. This
    // fallback timer advances it anyway, and is cleared the moment playback
    // actually starts so a playing video is never cut short.
    let fallback: number | undefined;
    const clearFallback = () => { if (fallback) window.clearTimeout(fallback); fallback = undefined; };
    v.addEventListener("playing", clearFallback, { once: true });

    v.play().catch(() => {
      fallback = window.setTimeout(nextSlide, IMAGE_MS);
    });

    return () => {
      clearFallback();
      v.removeEventListener("playing", clearFallback);
    };
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
                playsInline
                // Plays through, then hands over to the banner. `loop` would
                // mean the clip never ends and the carousel never advances.
                onEnded={nextSlide}
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

      {/* A soft gradient at the FOOT of the hero only.
          The old full-bleed scrim existed to keep a headline legible; with the
          headline gone it just dulled the artwork. This lifts contrast behind
          the buttons and nowhere else. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-gradient-to-t from-navy-950/70 via-navy-950/25 to-transparent transition-opacity duration-500 ${showHeroCopy ? "opacity-100" : "opacity-0"}`}
        aria-hidden
      />

      {/* CTAs — bottom-centre.
          The banner artwork carries its own headline and its own
          "Get Your Custom Packaging" button on the left, so anchoring these
          left stacked two competing sets of buttons on top of each other.
          Centred at the foot, they read as the page's action rather than a
          second version of the artwork's. */}
      {showHeroCopy && (
        // The benefit strip below overlaps the hero's foot, so the padding
        // clears it rather than letting the buttons sit behind it.
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pb-20 sm:pb-24 lg:pb-28">
          <div className="shell">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="flex flex-wrap items-center justify-center gap-3"
            >
              <Link to="/rfq" className="btn btn-primary btn-lg">
                Get Custom Quote <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/products" className="btn btn-white btn-lg">
                Explore Packaging
              </Link>
            </motion.div>
          </div>
        </div>
      )}


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
