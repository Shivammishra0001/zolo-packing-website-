import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import heroVideo from "../../../images/banner-video .mp4";

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

  // Only a non-video slide is on a timer. A video advances on its own end
  // (or loops, when it is the only slide).
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

    // Without this the clip never starts: autoPlay alone is unreliable once
    // the element has already been mounted and rewound.
    v.play().catch(() => {
      // Autoplay refused. With more than one slide, move on so the hero is
      // not stuck on a frozen frame; with a single looping slide there is
      // nowhere to go, and the poster frame stays.
      if (heroSlides.length > 1) fallback = window.setTimeout(nextSlide, IMAGE_MS);
    });

    return () => {
      clearFallback();
      v.removeEventListener("playing", clearFallback);
    };
  }, [currentSlide]);

  const showHeroCopy = heroSlides[currentSlide].showContent;

  return (
    <section
      // 16:9, matching the 1280x720 source exactly, with NO height cap.
      //
      // A cap seems like the way to keep the hero and the benefit strip on one
      // screen, but it is the thing that crops the wordmark. Capping the
      // height of an aspect-video box makes the FRAME wider than the clip, and
      // object-cover then fills that width by scaling the video up and
      // spilling the excess off the top and bottom. Measured at 1366x768 with
      // a 62vh cap: only 66% of the clip's height was visible. The "ZOLO"
      // wordmark sits near the top, so it was the first thing lost.
      //
      // Without a cap the frame is exactly 16:9, cover has nothing to trim,
      // and 100% of the artwork shows at every width. The benefit strip
      // overlaps the hero's foot by design, so it stays in view anyway.
      // The one safe cap: limit the hero by the space actually left under the
      // header, not by a fraction of the viewport. `100svh` is the SMALL
      // viewport height, so mobile browser chrome is already accounted for,
      // and 8rem reserves room for the header plus the overlapping benefit
      // strip. Because this caps HEIGHT on an aspect-video box the frame can
      // still go wider than 16:9 — so the video below uses `contain`, which
      // shows all of it and lets the navy backdrop fill the remainder rather
      // than cropping the artwork.
      className="relative aspect-video max-h-[calc(100svh-8rem)] w-full overflow-hidden bg-navy-900"
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
              <>
              {/* Blurred, over-scaled copy filling the pillars that `contain`
                  leaves when the frame is wider than 16:9. Standard treatment
                  for mismatched aspect ratios: the edges read as an extension
                  of the footage instead of bare navy bars, while the sharp
                  copy above stays uncropped. aria-hidden and not the ref'd
                  element — it is decoration, and only the real video drives
                  playback state. */}
              <video
                src={slide.src}
                aria-hidden
                tabIndex={-1}
                className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
                autoPlay
                muted
                playsInline
                loop
                preload="auto"
                controls={false}
                disablePictureInPicture
              />
              <video
                ref={videoRef}
                src={slide.src}
                // `contain`, deliberately. `cover` fills the frame but crops
                // whatever does not fit, and when a height cap makes the frame
                // wider than 16:9 that crop is VERTICAL — it ate 34% of the
                // clip's height at 1366x768 and sliced the "ZOLO" wordmark off
                // the top. `contain` shows the whole clip and lets the navy
                // backdrop take the leftover width instead.
                className="relative h-full w-full object-contain"
                autoPlay
                muted
                playsInline
                // The still banner was removed, so the video is the only
                // slide: it loops rather than ending. With onEnded ->
                // nextSlide and a single slide, the carousel wrapped to
                // itself, restarted the clip and never played it again — the
                // video stopped after one run.
                loop={heroSlides.length === 1}
                onEnded={heroSlides.length > 1 ? nextSlide : undefined}
                preload="auto"
                controls={false}
                disablePictureInPicture
              />
              </>
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
        // Padding scales with the hero's own height rather than a fixed pixel
        // ladder: a 16:9 frame is much shorter on a phone than on a desktop,
        // and pb-28 there pushed the buttons off the bottom entirely.
        <div className="absolute inset-x-0 bottom-0 z-40 flex justify-center pb-[12%] sm:pb-[10%]">
          <div className="shell">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="flex flex-wrap items-center justify-center gap-3"
            >
              <Link to="/rfq" className="btn btn-primary btn-sm sm:btn-lg">
                Get Custom Quote <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/products" className="btn btn-white btn-sm sm:btn-lg">
                Order Now 
              </Link>
            </motion.div>
          </div>
        </div>
      )}


      {/* Slide dots — pointless with a single slide, so hidden. */}
      {heroSlides.length > 1 && (
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
      )}
    </section>
  );
}
