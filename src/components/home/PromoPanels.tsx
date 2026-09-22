import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Boxes, Leaf, Palette, Printer, Ruler } from "lucide-react";
import ecoImage from "../../../images/compostable mailer.png";
import customImage from "../../../images/kraft mailer box.png";

// ============================================================
// PromoPanels — the two-panel promotional area (§16).
//
//   LEFT   Sustainability — the eco story, routed to the real /eco-rewards
//          page (the only eco destination that exists).
//   RIGHT  Custom packaging — the B2B service pitch, routed to /rfq.
//
// Both panels share one anatomy (eyebrow → heading → short copy → proof →
// CTA → visual) so they read as a pair rather than two unrelated blocks, and
// both are compact: no giant full-bleed marketing slabs.
//
// Every link points at a route that exists in App.tsx. /about,
// /custom-packaging and /sustainability-as-a-page do NOT exist, so they are
// never linked from here.
// ============================================================

const CUSTOM_FEATURES = [
  { icon: Ruler, label: "Custom sizes" },
  { icon: Printer, label: "Custom printing" },
  { icon: Palette, label: "Custom materials" },
  { icon: Boxes, label: "Bulk orders" },
];

// Soft radial fade so an opaque studio photo dissolves into the panel rather
// than ending in a hard rectangular edge over the panel's rounded corner.
const PHOTO_MASK = "radial-gradient(ellipse at center, #000 52%, transparent 78%)";

const reveal = {
  initial: { opacity: 0, y: 10 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.35 },
} as const;

export function PromoPanels() {
  return (
    <section className="section bg-white" aria-label="Sustainable and custom packaging">
      <div className="shell">
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
          {/* ---------- Sustainability ---------- */}
          <motion.article
            {...reveal}
            className="relative flex flex-col overflow-hidden rounded-[16px] border border-green-200 bg-green-50 p-6 sm:p-7"
          >
            <div className="relative flex flex-1 flex-col">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 text-white">
                <Leaf className="h-5 w-5" aria-hidden />
              </span>
              <p className="eyebrow mt-4">Sustainable packaging</p>
              <h3 className="h3 mt-2 max-w-sm text-dark-900">Better packaging for a greener planet</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-dark-600">
                Recyclable board, kraft paper and compostable mailers — responsible choices that still protect what you ship.
              </p>
              <Link to="/eco-rewards" className="btn btn-green btn-sm mt-5 self-start">
                Explore Eco Rewards <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            {/* Decorative product shot, bottom-right. These renders are opaque
                studio photos, so sitting one flush in the corner paints a hard
                white rectangle over the panel's radius. Insetting it and
                fading the edges with a radial mask lets it read as part of the
                panel instead of a pasted-on tile. */}
            <img
              src={ecoImage}
              alt=""
              aria-hidden
              loading="lazy"
              style={{ maskImage: PHOTO_MASK, WebkitMaskImage: PHOTO_MASK }}
              className="pointer-events-none absolute bottom-3 right-3 hidden h-32 w-32 object-contain mix-blend-multiply sm:block lg:h-36 lg:w-36"
            />
            {/* mix-blend-multiply drops the white studio ground into the mint
                surface. It is NOT used on the dark panel below, where multiply
                would crush the product to black. */}
          </motion.article>

          {/* ---------- Custom packaging ---------- */}
          <motion.article
            {...reveal}
            className="relative flex flex-col overflow-hidden rounded-[16px] bg-green-800 p-6 text-white sm:p-7"
          >
            <div className="relative flex flex-1 flex-col">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-300">Made to order</p>
              <h3 className="h3 mt-2 max-w-sm text-white">Need custom packaging?</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/80">
                Packaging tailored to your brand — your size, your print, your material, at your volume.
              </p>

              <ul className="mt-4 grid max-w-sm grid-cols-2 gap-x-4 gap-y-2">
                {CUSTOM_FEATURES.map((f) => (
                  <li key={f.label} className="flex items-center gap-2 text-[13px] font-medium text-white/85">
                    <f.icon className="h-4 w-4 shrink-0 text-green-300" aria-hidden />
                    {f.label}
                  </li>
                ))}
              </ul>

              <Link to="/rfq" className="btn btn-primary btn-sm mt-5 self-start">
                Request a quote <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            {/* On the dark panel the photo gets an explicit rounded white tile
                instead of a mask. These renders have an opaque white studio
                ground: fading it only produces a grey halo against dark green,
                whereas an intentional tile reads as a deliberate product chip. */}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-4 right-4 hidden h-32 w-32 items-center justify-center overflow-hidden rounded-[14px] bg-white/95 shadow-[0_10px_28px_rgba(0,0,0,0.25)] sm:flex lg:h-36 lg:w-36"
            >
              <img src={customImage} alt="" loading="lazy" className="h-full w-full object-contain p-2" />
            </span>
          </motion.article>
        </div>
      </div>
    </section>
  );
}
