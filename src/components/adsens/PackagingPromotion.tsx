import { motion } from "framer-motion";
import { ArrowRight, Check, Megaphone, Package } from "lucide-react";
import { DK_GRADIENT, Glow, useCalm } from "./dark";

/* =========================================================
   "From Packaging to Promotion" — the brand-positioning section (§4).

   Two service areas shown as connected halves. The connector is decorative
   and hidden from assistive tech; at narrow widths it becomes a vertical
   joint so the two cards still read as one pair rather than two unrelated
   boxes.

   The list contents mirror what Zolo and AdSens actually offer. The caption
   under the CTA repeats that the two are billed separately — the brief is
   explicit that this section must not imply a bundled price.
   ========================================================= */

const ZOLO = ["Custom Packaging", "Bulk Packaging", "Product Branding", "Packaging Solutions"];
const ADSENS = ["Digital Advertising", "SEO", "Social Media Marketing", "Lead Generation", "Creative & Content"];

export function PackagingPromotion({ onCta }: { onCta: () => void }) {
  const calm = useCalm();
  const rise = calm
    ? {}
    : { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" } };

  return (
    <section className="relative border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="left-1/2 top-0 -translate-x-1/2" color="var(--dk-blue)" size={520} />

      <div className="shell relative">
        <motion.div {...rise} transition={{ duration: 0.45 }} className="mx-auto max-w-3xl text-center">
          <h2 className="h2 text-[var(--dk-ink)]">
            From Packaging to Promotion.
            <br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: DK_GRADIENT }}>
              One Platform for Your Business Growth.
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--dk-muted)]">
            Your packaging creates the first impression. Your marketing takes your brand to the right audience. With
            Zolo Packaging and AdSens, you get a connected partner for both.
          </p>
        </motion.div>

        <div className="relative mt-10 grid items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr] lg:gap-0">
          <motion.div {...rise} transition={{ duration: 0.45, delay: 0.05 }} className="lg:pr-5">
            <Half
              icon={Package}
              eyebrow="Zolo Packaging"
              title="What goes around your product"
              items={ZOLO}
              tone="var(--dk-cyan)"
            />
          </motion.div>

          {/* The joint. Horizontal on desktop, vertical when the cards stack. */}
          <div aria-hidden className="relative flex items-center justify-center lg:w-16">
            <span className="absolute h-px w-24 bg-gradient-to-r from-transparent via-[var(--dk-line-2)] to-transparent lg:h-full lg:w-px lg:bg-gradient-to-b" />
            <span
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-[0_0_28px_rgba(79,123,255,0.5)]"
              style={{ backgroundImage: DK_GRADIENT }}
            >
              +
            </span>
          </div>

          <motion.div {...rise} transition={{ duration: 0.45, delay: 0.1 }} className="lg:pl-5">
            <Half
              icon={Megaphone}
              eyebrow="AdSens"
              title="How the right people find it"
              items={ADSENS}
              tone="var(--dk-violet)"
            />
          </motion.div>
        </div>

        <div className="mt-10 text-center">
          <button
            onClick={onCta}
            className="btn btn-lg text-white shadow-[0_10px_30px_rgba(79,123,255,0.35)]"
            style={{ backgroundImage: DK_GRADIENT }}
          >
            Build Your Brand With Zolo <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <p className="mx-auto mt-3 max-w-md text-xs text-[var(--dk-faint)]">
            Packaging and marketing are separate services, quoted and billed separately. Using one does not require
            the other.
          </p>
        </div>
      </div>
    </section>
  );
}

function Half({
  icon: Icon,
  eyebrow,
  title,
  items,
  tone,
}: {
  icon: typeof Package;
  eyebrow: string;
  title: string;
  items: string[];
  tone: string;
}) {
  return (
    <div className="h-full rounded-2xl border border-[var(--dk-line)] bg-[var(--dk-panel)] p-6 sm:p-7">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: tone }}>
        {eyebrow}
      </p>
      <h3 className="mt-1 text-lg font-bold text-[var(--dk-ink)]">{title}</h3>
      <ul className="mt-4 space-y-2">
        {items.map((x) => (
          <li key={x} className="flex items-start gap-2.5 text-sm text-[var(--dk-muted)]">
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: tone }} aria-hidden />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}
