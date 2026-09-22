import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, Headphones, Leaf, Truck } from "lucide-react";
import heroBox from "../../../images/corrugated box.png";
import heroBag from "../../../images/paper-bag.png";
import heroTape from "../../../images/brown kraft tape.png";
import heroPouch from "../../../images/pouch.png";

// ============================================================
// HomeHero — the 5-second answer to "what is Zolo Packing?".
//
// Replaces the old full-bleed video carousel, which showed marketing artwork
// with "ZOLO PACKAGING" already burned into it behind a dark scrim and a
// competing headline: two brand statements fighting, and zero information
// about what a visitor can actually buy.
//
// This is a bounded split composition (§6):
//   LEFT   eyebrow → headline → one sentence → 2 CTAs → 4 trust indicators
//   RIGHT  a product composition built from the real packaging PNGs in
//          /images — boxes, kraft bags, tape, pouches — so the visual says
//          "packaging" instead of "generic e-commerce".
//
// Height is deliberately capped (~460–520px desktop) and the whole thing sits
// on the `.shell` grid, so the header, hero and every section below align.
// ============================================================

const TRUST = [
  { icon: Leaf, label: "Sustainable options" },
  { icon: BadgeCheck, label: "Business-grade quality" },
  { icon: Truck, label: "Pan-India delivery" },
  { icon: Headphones, label: "Dedicated support" },
];

/** One floating product tile in the hero composition. */
function ProductTile({
  src,
  alt,
  className,
  delay,
  tone = "mint",
}: {
  src: string;
  alt: string;
  className: string;
  delay: number;
  tone?: "mint" | "cream" | "white";
}) {
  // All tiles are white: the packaging renders carry baked studio backgrounds,
  // so a tinted tile shows a grey/white rectangle floating inside it. The
  // tones differ only in the surrounding border tint, which is enough
  // separation against the mint hero without fighting the photography.
  const tones = {
    mint: "bg-white border-green-200",
    cream: "bg-white border-cream-200",
    white: "bg-white border-dark-200",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={`absolute flex items-center justify-center overflow-hidden rounded-[16px] border shadow-[0_10px_30px_rgba(15,23,42,0.10)] ${tones[tone]} ${className}`}
    >
      <img src={src} alt={alt} loading="eager" decoding="async" className="h-full w-full object-contain p-3" />
    </motion.div>
  );
}

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-green-50" aria-label="Packaging for every business">
      {/* Soft brand wash — flat tints, no gradient-on-text, no glassmorphism. */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-green-100/70 blur-[90px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-cream-100/80 blur-[90px]" />

      <div className="shell relative">
        <div className="grid items-center gap-8 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-14">
          {/* ---------- Copy ---------- */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="max-w-xl"
          >
            <p className="eyebrow">Packaging made simple</p>
            <h1 className="h1 mt-3 text-dark-900">
              Packaging for a{" "}
              <span className="text-green-500">brighter tomorrow</span>
            </h1>
            <p className="lead mt-4 max-w-md">
              Boxes, bags, tapes and custom-printed packaging for businesses, brands and e-commerce sellers — ordered online or quoted to your spec.
            </p>

            {/* Both CTAs share one row even at 320px — stacking two full-width
                buttons pushed the trust indicators and the category strip
                below the fold on a phone. */}
            {/* Both CTAs share one row from 360px up (`btn` at 44px until
                `sm`, `btn-lg` beyond). Two stacked full-width buttons pushed
                the trust indicators and the category strip below the fold. */}
            <div className="mt-6 flex flex-wrap items-center gap-2 sm:gap-3">
              <Link to="/products" className="btn btn-primary sm:btn-lg">
                Shop all products <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/rfq" className="btn btn-secondary sm:btn-lg">
                Get a quote
              </Link>
            </div>

            {/* Trust indicators — subtle, not a second CTA row. */}
            <ul className="mt-7 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:max-w-md">
              {TRUST.map((t) => (
                <li key={t.label} className="flex items-center gap-2 text-[13px] font-medium text-dark-600">
                  <t.icon className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
                  {t.label}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* ---------- Product composition ----------
              Hidden below `sm` (mobile gets copy + CTAs without a 300px
              decorative block pushing the categories off-screen). */}
          <div className="relative hidden h-[300px] sm:block lg:h-[380px]" aria-hidden>
            {/* Anchor tile: the hero product. */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="absolute left-1/2 top-1/2 flex h-[72%] w-[64%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[20px] border border-white bg-white shadow-[0_18px_44px_rgba(15,23,42,0.12)]"
            >
              <img src={heroBox} alt="" className="h-full w-full object-contain p-6" />
            </motion.div>

            <ProductTile src={heroBag} alt="" delay={0.12} tone="cream" className="left-0 top-2 h-[38%] w-[34%]" />
            <ProductTile src={heroTape} alt="" delay={0.18} tone="mint" className="bottom-2 left-[6%] h-[34%] w-[30%]" />
            <ProductTile src={heroPouch} alt="" delay={0.24} tone="white" className="bottom-6 right-0 h-[36%] w-[32%]" />

            {/* Custom-packaging cue, tied to the quote flow the CTA opens. */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="absolute right-2 top-4 rounded-full border border-green-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-green-600 shadow-sm"
            >
              Custom printing
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
