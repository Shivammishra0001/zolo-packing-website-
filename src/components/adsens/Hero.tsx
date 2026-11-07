import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, TrendingUp } from "lucide-react";
import { HERO_AD, HERO_STATS } from "./content";
import { fadeUp, stagger, viewportOnce } from "./shared";

/* =========================================================
   Section 1 — Hero.

   Reference composition: copy block left, live-ad panel right, four stats
   beneath the CTAs. The reference renders this on near-black; this app is
   light, so the band is the app's cream surface and the ad panel keeps a
   dark inner face — that panel is a screenshot of an ads console in the
   reference, and a dark chrome is what makes it read as one.
   ========================================================= */

export function Hero() {
  const calm = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-b border-dark-200 bg-cream-50">
      {/* Soft brand wash. Decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(21,128,61,0.13), transparent 70%)" }}
      />

      <div className="shell relative grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14 lg:py-16">
        {/* ---------------- copy ---------------- */}
        <motion.div
          variants={calm ? undefined : stagger}
          initial={calm ? undefined : "hidden"}
          animate={calm ? undefined : "visible"}
        >
          <motion.span
            variants={calm ? undefined : fadeUp}
            className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-green-600"
          >
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Performance Marketing Agency
          </motion.span>

          <motion.h1 variants={calm ? undefined : fadeUp} className="h1 mt-4 text-dark-900">
            We Drive <span className="text-green-500">Measurable Growth</span> For Ambitious Brands
          </motion.h1>

          <motion.p variants={calm ? undefined : fadeUp} className="lead mt-4 max-w-xl">
            Performance marketing, SEO, paid ads, and content—weaved together for sustainable growth.
            We turn data into revenue.
          </motion.p>

          <motion.div variants={calm ? undefined : fadeUp} className="mt-7 flex flex-wrap gap-3">
            {/* Orange is this app's conversion colour, reserved for the one
                primary action on the screen. */}
            <Link to="/contact" className="btn btn-lg btn-primary !bg-primary-700 hover:!bg-primary-800">
              Get Your Free Strategy Call
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href="#portfolio" className="btn btn-lg btn-outline">View Our Work</a>
          </motion.div>

          {/* ---------------- stats ---------------- */}
          <motion.dl
            variants={calm ? undefined : stagger}
            className="mt-9 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4"
          >
            {HERO_STATS.map((s) => (
              <motion.div key={s.label} variants={calm ? undefined : fadeUp}>
                <dd className="font-display text-[26px] font-extrabold leading-none tabular-nums text-green-500 sm:text-[30px]">
                  {s.value}
                </dd>
                <dt className="mt-1.5 text-[13px] font-medium leading-tight text-dark-600">{s.label}</dt>
              </motion.div>
            ))}
          </motion.dl>
        </motion.div>

        {/* ---------------- live ad panel ---------------- */}
        <motion.div
          variants={calm ? undefined : fadeUp}
          initial={calm ? undefined : "hidden"}
          whileInView={calm ? undefined : "visible"}
          viewport={viewportOnce}
          className="relative mx-auto w-full max-w-[460px] lg:max-w-none"
        >
          <AdPanel calm={Boolean(calm)} />
        </motion.div>
      </div>
    </section>
  );
}

/**
 * The hero's advertising-console mock. Drawn in markup rather than shipped as
 * an image so it stays crisp, themeable and readable to a screen reader.
 */
function AdPanel({ calm }: { calm: boolean }) {
  return (
    <div className="card card-shadow-lg overflow-hidden">
      {/* rail */}
      <div className="flex items-center gap-2 border-b border-dark-200 bg-dark-50 px-4 py-2.5">
        <span
          className={`h-2 w-2 rounded-full bg-green-400 ${calm ? "" : "animate-pulse"}`}
          aria-hidden
        />
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-dark-600">
          {HERO_AD.rail}
        </span>
      </div>

      {/* dark console face */}
      <div className="bg-navy-950 p-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
            {HERO_AD.source}
          </span>
          <span className="rounded-md border border-white/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/70">
            {HERO_AD.sponsored}
          </span>
        </div>

        <p className="mt-4 font-display text-lg font-extrabold leading-tight">{HERO_AD.brand}</p>
        <p className="mt-1 text-[13px] leading-snug text-white/65">{HERO_AD.campaign}</p>

        {/* A simple rising bar motif: decorative, so it is hidden from
            assistive tech and carries no numbers of its own. */}
        <div className="mt-4 flex h-16 items-end gap-1.5" aria-hidden>
          {[34, 46, 38, 58, 66, 54, 78, 88].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-gradient-to-t from-green-400/40 to-green-400"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>

      {/* metric rows */}
      <dl className="divide-y divide-dark-200">
        {HERO_AD.rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="text-[13px] text-dark-600">{r.label}</dt>
            <dd className="text-[13px] font-bold tabular-nums text-dark-900">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
