import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Award,
  Boxes,
  Check,
  ChevronRight,
  Cloud,
  Crown,
  Gift,
  Leaf,
  Medal,
  Package,
  PackageCheck,
  Recycle,
  Repeat,
  Search,
  Star,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import heroScene from "../../images/hero-bg1.png";
import sellBox from "../../images/cardboardbox.png";
import reuseBox from "../../images/kraft mailer box.png";
import recycleBin from "../../images/step-5.png";
import ctaScene from "../../images/herobg-2.png";
import { tiers } from "../components/eco/EcoRewardsComponents";
import { useAuthSession } from "../components/auth/AuthContext";
import { useAuthGuard } from "../components/auth/AuthGuard";
import { returnsApi } from "../lib/api/returns";

/* =========================================================
   ECO REWARDS — the one sustainability / circular-economy page.
   Route: /eco-rewards (/sustainability redirects here — see App.tsx).

   Layout follows the supplied design reference. Data (impact statistics,
   five-step loop, membership tiers) is the page's existing content; the
   Eco Wallet reads the customer's REAL balance from GET /returns/points.

   Actions:
     Recycle → the existing flow: a recycling request starts from an order
               (Account → Orders → order → Recycle). Guests sign in first
               and land there automatically.
     Sell / Reuse → no self-serve flow exists yet; both route to the real
               Contact page (partnership topic) rather than a fake form.
========================================================= */

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const viewportOnce = { once: true, amount: 0.2 } as const;

/* ---------- Existing page data (unchanged values) ---------- */

const heroBenefits = [
  { icon: Leaf, label: "Reduce Waste" },
  { icon: Cloud, label: "Lower Emissions" },
  { icon: Recycle, label: "Circular Economy" },
  { icon: Users, label: "Stronger Communities" },
];

const loopSteps = [
  { number: "01", title: "Collect", text: "Keep used packaging aside.", icon: Package },
  { number: "02", title: "Schedule Pickup", text: "Choose a convenient collection slot.", icon: Truck },
  { number: "03", title: "Inspection", text: "We verify material and check eligibility.", icon: Search },
  { number: "04", title: "Recycle / Reuse", text: "Approved packaging enters recovery or resale streams.", icon: Recycle },
  { number: "05", title: "Get Rewarded", text: "You receive money and/or ZOLO points.", icon: Gift },
];

const stats = [
  { value: "10K+", label: "Participants", icon: Users },
  { value: "50K+", label: "Packs Recycled", icon: PackageCheck },
  { value: "120T", label: "CO₂ Reduced", icon: Leaf },
  { value: "1M+", label: "Points Issued", icon: Award },
];

/* Tier thresholds mirror the membership table (the `points` strings). */
const tierThresholds = tiers.map((t) => ({ ...t, min: Number(t.points.replace(/[^\d]/g, "")) || 0 }));
const tierFor = (balance: number) => [...tierThresholds].reverse().find((t) => balance >= t.min) ?? tierThresholds[0];

const tierLook: Record<string, { card: string; circle: string; name: string; icon: typeof Leaf }> = {
  "Green Member": { card: "border-green-200 bg-gradient-to-b from-green-50 to-white", circle: "bg-green-100 text-green-700", name: "text-green-800", icon: Leaf },
  "Eco Silver": { card: "border-slate-200 bg-gradient-to-b from-slate-50 to-white", circle: "bg-slate-200 text-slate-600", name: "text-dark-900", icon: Medal },
  "Eco Gold": { card: "border-amber-200 bg-gradient-to-b from-amber-50 to-white", circle: "bg-amber-200 text-amber-700", name: "text-dark-900", icon: Star },
  "Eco Platinum": { card: "border-dark-200 bg-gradient-to-b from-dark-50 to-white", circle: "bg-dark-900 text-white", name: "text-dark-900", icon: Crown },
};

/* ---------- Building blocks ---------- */

const btnBase = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-3 text-sm font-bold transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const btnOrange = `${btnBase} bg-primary-500 text-white shadow-md shadow-primary-500/25 hover:bg-primary-600 focus-visible:ring-primary-500`;
const btnDark = `${btnBase} bg-dark-950 text-white hover:bg-dark-800 focus-visible:ring-dark-900`;
const btnOutline = `${btnBase} border border-dark-200 bg-white text-dark-900 hover:border-dark-900 focus-visible:ring-dark-900`;
const btnOutlineOrange = `${btnBase} border-2 border-primary-500 bg-white text-primary-600 hover:bg-primary-50 focus-visible:ring-primary-500`;
const btnGreen = `${btnBase} bg-green-700 text-white shadow-md shadow-green-700/25 hover:bg-green-800 focus-visible:ring-green-700`;

function Eyebrow({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "light" | "orange" }) {
  const color = tone === "light" ? "text-lime-300" : tone === "orange" ? "text-primary-500" : "text-green-700";
  return <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${color}`}>{children}</p>;
}

/* ---------- Eco Wallet (real balance from the points ledger) ---------- */

function EcoWalletMini() {
  const { isAuthenticated, authReady, openAuthModal } = useAuthSession();
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; balance: number }>({ status: "idle", balance: 0 });

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) { setState({ status: "idle", balance: 0 }); return; }
    let alive = true;
    setState((s) => ({ ...s, status: "loading" }));
    returnsApi.points()
      .then((r) => { if (alive) setState({ status: "ready", balance: r.balance }); })
      .catch(() => { if (alive) setState({ status: "error", balance: 0 }); });
    return () => { alive = false; };
  }, [authReady, isAuthenticated]);

  const tier = tierFor(state.balance);
  const next = tierThresholds.find((t) => t.min > state.balance) ?? null;
  const progress = next ? Math.min(100, Math.round(((state.balance - tier.min) / (next.min - tier.min)) * 100)) : 100;

  return (
    <aside aria-label="Your Eco Wallet" className="mt-6 rounded-2xl border border-green-100 bg-white p-4 shadow-sm">
      <p className="inline-flex items-center gap-2 text-xs font-bold text-green-800"><WalletCards className="h-4 w-4" aria-hidden /> Your Eco Wallet</p>
      {!isAuthenticated ? (
        <p className="mt-2 text-sm text-dark-500">
          <button type="button" onClick={() => openAuthModal({ tab: "login" })} className="font-bold text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">Sign in</button> to see your points and membership level.
        </p>
      ) : state.status === "error" ? (
        <p className="mt-2 text-sm text-red-600">We couldn't load your wallet right now.</p>
      ) : (
        <>
          <p className="mt-2 font-display text-3xl font-extrabold tabular-nums text-dark-900">
            {state.status === "loading" ? <span className="inline-block h-8 w-24 animate-pulse rounded bg-dark-100" /> : state.balance.toLocaleString("en-IN")}
            <span className="ml-1.5 text-sm font-bold text-green-700">pts</span>
          </p>
          <p className="mt-1 text-xs text-dark-500"><span className="font-semibold text-dark-800">{tier.name}</span> · {tier.discount} off orders</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-dark-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next membership tier">
            <div className="h-full rounded-full bg-green-600 transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-dark-400">{next ? `${(next.min - state.balance).toLocaleString("en-IN")} pts to ${next.name}` : "Top tier reached"} · <Link to="/account/recycle" className="font-semibold text-green-700 hover:underline">Recycling history</Link></p>
        </>
      )}
    </aside>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function EcoRewards() {
  const nav = useNavigate();
  const guard = useAuthGuard();
  const startRecycling = () => guard(() => nav("/account/orders"), { label: "start a recycling request" });

  // Page-level metadata (the app has no per-route SEO layer; restored on leave).
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content") ?? null;
    document.title = "ZOLO Eco Rewards | Sustainable Packaging & Recycling";
    meta?.setAttribute("content", "Give your packaging a second life with ZOLO. Sell reusable packaging, explore reuse options, recycle eligible materials and earn Eco Rewards.");
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== null) meta.setAttribute("content", prevDesc);
    };
  }, []);

  const actionCards = [
    {
      key: "sell", icon: Boxes, title: "Sell Your Packaging", text: "Get paid for reusable or surplus packaging.",
      bullets: ["Used or unused packaging", "Quick valuation process", "Pickup from your location", "Get money + reward points"],
      cta: "Sell Packaging", image: sellBox, alt: "Open corrugated cardboard box ready to be sold", imageClass: "object-contain p-6",
      tint: "bg-gradient-to-br from-green-50 to-emerald-50/60 border-green-100", iconBg: "bg-green-700 text-white", btn: btnOrange,
      onClick: () => nav("/contact?topic=partnership"),
    },
    {
      key: "reuse", icon: Repeat, title: "Reuse Packaging", text: "Give packaging another life. List it for other businesses.",
      bullets: ["List reusable packaging", "Help other businesses", "Earn rewards", "Support circular economy"],
      cta: "List for Reuse", image: reuseBox, alt: "Kraft mailer box with a blank logo area, ready for reuse", imageClass: "object-cover",
      tint: "bg-gradient-to-br from-orange-50 to-amber-50/60 border-orange-100", iconBg: "bg-primary-500 text-white", btn: btnOutlineOrange,
      onClick: () => nav("/contact?topic=partnership"),
    },
    {
      key: "recycle", icon: Recycle, title: "Recycle & Earn", text: "Recycle damaged or used packaging and earn points.",
      bullets: ["Easy pickup scheduling", "Verified recycling partners", "Track your impact", "Earn ZOLO reward points"],
      cta: "Recycle Now", image: recycleBin, alt: "Green recycling bin filled with used kraft boxes and paper bags", imageClass: "object-contain p-4",
      tint: "bg-gradient-to-br from-green-50 to-lime-50/60 border-green-100", iconBg: "bg-green-700 text-white", btn: btnGreen,
      onClick: startRecycling,
    },
  ];

  return (
    <main className="bg-white">
      {/* =====================================================
          1. HERO
      ====================================================== */}
      <section className="relative overflow-hidden bg-gradient-to-r from-green-50 via-green-50/60 to-white">
        <div className="shell grid items-stretch gap-8 lg:grid-cols-[1.08fr_1fr] lg:gap-0">
          {/* Copy */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="relative z-10 py-10 lg:py-14 lg:pr-10">
            <motion.span animate={{ y: [0, -8, 0], rotate: [0, 8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} className="pointer-events-none absolute right-2 top-8 hidden text-green-500 lg:block" aria-hidden>
              <Leaf className="h-10 w-10 -rotate-45" />
            </motion.span>
            <Eyebrow>Packaging with purpose</Eyebrow>
            <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-dark-950 sm:text-5xl xl:text-[3.4rem]">
              Give Your Packaging
              <br />
              <span className="text-green-700">a Second Life</span>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-dark-600 sm:text-lg">
              Don’t throw packaging away. Sell it, return it or recycle it and earn rewards for a cleaner, greener tomorrow.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/contact?topic=partnership" className={btnOrange}><Package className="h-4 w-4" aria-hidden /> Sell Packaging</Link>
              <button type="button" onClick={startRecycling} className={btnDark}><Recycle className="h-4 w-4" aria-hidden /> Recycle &amp; Earn</button>
              <a href="#membership" className={btnOutline}><Gift className="h-4 w-4 text-primary-500" aria-hidden /> Explore Eco Rewards</a>
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8" aria-label="Why it matters">
              {heroBenefits.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2.5 text-sm font-semibold text-dark-800">
                  <Icon className="h-6 w-6 shrink-0 text-green-700" aria-hidden />
                  <span className="max-w-[6.5rem] leading-tight">{label}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Photo + floating impact card */}
          <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }} className="relative -mx-[var(--shell-pad)] min-h-[300px] sm:min-h-[380px] lg:mx-0 lg:-mr-[var(--shell-pad)] lg:min-h-[420px]">
            <img
              src={heroScene}
              alt="ZOLO kraft and green branded boxes on a table beside leafy plants"
              width={1728}
              height={918}
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover object-[65%_center]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-green-50 via-transparent to-transparent lg:from-green-50/90 lg:via-green-50/10" aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="absolute bottom-5 right-5 w-[200px] rounded-2xl bg-gradient-to-br from-green-700 to-[#0b4a2b] p-4 text-white shadow-[0_20px_50px_rgba(2,6,23,0.35)] sm:w-[220px] lg:top-6 lg:bottom-auto lg:right-8"
            >
              <Leaf className="absolute right-4 top-4 h-6 w-6 text-lime-300" aria-hidden />
              <p className="font-display text-xl font-bold leading-tight">Small<br />Actions<br /><span className="font-extrabold">Big Impact</span></p>
              <div className="mt-4 rounded-xl bg-white p-4 text-dark-900">
                <Leaf className="h-6 w-6 text-green-700" aria-hidden />
                <p className="mt-2 font-display text-2xl font-extrabold leading-none">50K+</p>
                <p className="mt-1.5 text-sm font-medium leading-snug text-dark-600">Packs Recycled Together</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          2. SELL / REUSE / RECYCLE
      ====================================================== */}
      <section id="actions" className="py-10 lg:py-14">
        <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="shell grid gap-5 lg:grid-cols-3">
          {actionCards.map(({ key, icon: Icon, title, text, bullets, cta, image, alt, imageClass, tint, iconBg, btn, onClick }) => (
            <motion.article key={key} variants={fadeUp} whileHover={{ y: -6 }} className={`group grid overflow-hidden rounded-2xl border shadow-[0_10px_40px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_22px_60px_rgba(15,23,42,0.12)] ${tint} grid-cols-1 sm:grid-cols-[42%_1fr]`}>
              <div className="relative h-48 overflow-hidden bg-white/40 sm:h-auto sm:min-h-[260px]">
                <img src={image} alt={alt} loading="lazy" className={`absolute inset-0 h-full w-full transition-transform duration-700 group-hover:scale-105 ${imageClass}`} />
              </div>
              <div className="flex flex-col p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconBg}`}><Icon className="h-5 w-5" aria-hidden /></span>
                  <h2 className="font-display text-lg font-extrabold uppercase leading-tight tracking-tight text-dark-950 sm:text-xl">{title}</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-dark-600">{text}</p>
                <ul className="mt-3 space-y-1.5">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-dark-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" strokeWidth={3} aria-hidden /> {b}</li>
                  ))}
                </ul>
                <button type="button" onClick={onClick} className={`${btn} mt-5 self-start whitespace-nowrap`}>
                  {cta} <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* =====================================================
          3. HOW IT WORKS
      ====================================================== */}
      <section id="how-it-works" className="py-8 lg:py-12">
        <div className="shell">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mx-auto max-w-2xl text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-dark-950 sm:text-4xl">A Simple Loop for a Better Tomorrow</h2>
            <p className="mt-3 text-base text-dark-500 sm:text-lg">Five easy steps turn your used packaging into real impact and real rewards.</p>
          </motion.div>

          <motion.ol variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="no-scrollbar mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3 lg:grid lg:grid-cols-5 lg:gap-6 lg:overflow-visible lg:pb-0" aria-label="Recycling steps">
            {loopSteps.map(({ number, title, text, icon: Icon }, index) => (
              <motion.li key={title} variants={fadeUp} className="relative w-[80%] shrink-0 snap-start sm:w-[46%] lg:w-auto">
                <article className="h-full rounded-2xl border border-dark-100 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.05)] transition hover:-translate-y-1.5 hover:shadow-[0_18px_44px_rgba(15,23,42,0.1)]">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700"><Icon className="h-6 w-6" aria-hidden /></span>
                    <div>
                      <p className="font-display text-xl font-bold text-green-700">{number}</p>
                      <h3 className="font-display text-sm font-extrabold text-dark-950">{title}</h3>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-dark-600">{text}</p>
                </article>
                {index < loopSteps.length - 1 && (
                  <ChevronRight className="absolute -right-[19px] top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 text-green-700 lg:block" strokeWidth={3} aria-hidden />
                )}
              </motion.li>
            ))}
          </motion.ol>
        </div>
      </section>

      {/* =====================================================
          4. IMPACT BAND (full-bleed)
      ====================================================== */}
      <section className="relative mt-8 overflow-hidden bg-gradient-to-r from-[#052f1c] via-[#0b4a2b] to-[#0e5a34] py-8 text-white">
        <Leaf className="pointer-events-none absolute -left-4 -top-6 h-28 w-28 rotate-12 text-green-400/20" aria-hidden />
        <Leaf className="pointer-events-none absolute -bottom-8 right-[28%] h-24 w-24 -rotate-45 text-lime-300/15" aria-hidden />
        <div className="shell grid items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2.4fr)_auto]">
          <div>
            <h2 className="font-display text-2xl font-extrabold">Our Impact So Far</h2>
            <p className="mt-1 text-sm text-green-100/85">Together we&rsquo;re building a cleaner, greener planet.</p>
          </div>
          <motion.ul variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="grid grid-cols-2 gap-y-5 sm:grid-cols-4 sm:divide-x sm:divide-white/15" aria-label="Impact statistics">
            {stats.map(({ value, label, icon: Icon }) => (
              <motion.li key={label} variants={fadeUp} className="flex flex-col items-start gap-1 sm:px-6 sm:first:pl-0">
                <Icon className="h-6 w-6 text-lime-300" aria-hidden />
                <p className="font-display text-2xl font-extrabold leading-none sm:text-3xl">{value}</p>
                <p className="text-xs text-green-100/85">{label}</p>
              </motion.li>
            ))}
          </motion.ul>
          <a href="#actions" className={`${btnOrange} whitespace-nowrap`}>Be Part of the Change <ArrowRight className="h-4 w-4" aria-hidden /></a>
        </div>
      </section>

      {/* =====================================================
          5. MEMBERSHIP
      ====================================================== */}
      <section id="membership" className="py-12 lg:py-16">
        <div className="shell grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,3fr)] lg:gap-10">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce}>
            <Eyebrow>Eco Rewards Membership</Eyebrow>
            <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight text-dark-950 sm:text-4xl">Grow Your Impact.<br />Unlock More.</h2>
            <p className="mt-3 text-sm leading-6 text-dark-600 sm:text-base">Your contribution moves you through membership levels with better benefits.</p>
            <a href="#actions" className={`${btnOutlineOrange} mt-6`}>Explore All Benefits <ArrowRight className="h-4 w-4" aria-hidden /></a>
            <EcoWalletMini />
          </motion.div>

          <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {tiers.map((tier) => {
              const look = tierLook[tier.name] ?? tierLook["Green Member"];
              const Icon = look.icon;
              const lines = [`${tier.discount} off`, tier.support, ...tier.benefits];
              return (
                <motion.article key={tier.name} variants={fadeUp} whileHover={{ y: -6 }} className={`flex flex-col rounded-2xl border p-6 text-center shadow-[0_8px_30px_rgba(15,23,42,0.05)] transition-shadow hover:shadow-[0_20px_50px_rgba(15,23,42,0.12)] ${look.card}`}>
                  <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${look.circle}`}><Icon className="h-6 w-6" aria-hidden /></span>
                  <h3 className={`mt-4 font-display text-lg font-extrabold ${look.name}`}>{tier.name}</h3>
                  <p className="mt-0.5 text-sm font-bold text-dark-700">{tier.points}</p>
                  <ul className="mt-5 space-y-2 text-left">
                    {lines.map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-dark-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" strokeWidth={3} aria-hidden /> {line}</li>
                    ))}
                  </ul>
                </motion.article>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          6. FINAL CTA
      ====================================================== */}
      <section className="pb-16">
        <div className="shell">
          <motion.div initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={viewportOnce} transition={{ duration: 0.7 }} className="relative overflow-hidden rounded-3xl bg-[#073b23] text-white">
            <img src={ctaScene} alt="ZOLO Packaging product range — kraft, black and gift boxes on stone plinths" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-45" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#031f12] via-[#073b23]/85 to-[#073b23]/40" aria-hidden />
            <div className="relative z-10 grid gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:px-14 lg:py-12">
              <div>
                <Eyebrow tone="orange">Better tomorrow starts today</Eyebrow>
                <h2 className="mt-3 font-display text-3xl font-extrabold leading-[1.1] sm:text-4xl lg:text-[2.6rem]">
                  Every action <span className="text-primary-400">counts.</span>
                  <br />
                  Every pack <span className="text-primary-400">matters.</span>
                </h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-green-50/85 sm:text-base">
                  Choose better packaging, return what you can and get rewarded for building a more circular future.
                </p>
              </div>
              <div className="lg:justify-self-end">
                <ul className="grid grid-cols-2 gap-4 rounded-2xl bg-white p-5 text-dark-900 shadow-xl sm:grid-cols-4 sm:gap-2 sm:divide-x sm:divide-dark-100" aria-label="Impact statistics">
                  {stats.map(({ value, label, icon: Icon }) => (
                    <li key={label} className="flex items-center gap-2.5 sm:px-3 sm:first:pl-0 sm:last:pr-0">
                      <Icon className="h-6 w-6 shrink-0 text-green-700" aria-hidden />
                      <span><span className="block font-display text-lg font-extrabold leading-none">{value}</span><span className="mt-1 block text-[11px] text-dark-500">{label}</span></span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap gap-3 lg:justify-end">
                  <button type="button" onClick={startRecycling} className={btnOrange}>Start Recycling <ArrowRight className="h-4 w-4" aria-hidden /></button>
                  <a href="#how-it-works" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/50 bg-white/5 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">Learn More</a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
