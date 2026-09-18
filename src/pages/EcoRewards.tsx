import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Award,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Coins,
  Factory,
  Gift,
  Leaf,
  Medal,
  PackageCheck,
  Recycle,
  Repeat,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import step1 from "../../images/step-1.png";
import step2 from "../../images/step-2.png";
import step3 from "../../images/step-3.png";
import step4 from "../../images/step-4.png";
import step5 from "../../images/step-5.png";
import heroMailer from "../../images/compostable mailer.png";
import sellBox from "../../images/corrugated box.png";
import reuseBag from "../../images/shopping bag.png";
import wasteHierarchy from "../../images/recycle.jpg";
import ctaScene from "../../images/hero-bg1.png";
import { tiers } from "../components/eco/EcoRewardsComponents";
import { useAuthSession } from "../components/auth/AuthContext";
import { useAuthGuard } from "../components/auth/AuthGuard";
import { returnsApi } from "../lib/api/returns";

/* =========================================================
   ECO REWARDS — the one sustainability / circular-economy page.
   Route: /eco-rewards (/sustainability redirects here — see App.tsx).

   Data: the impact statistics, sustainability badges, five-step loop and
   membership tiers are the values this page has always shown; nothing is
   invented. The Eco Wallet reads the customer's REAL point balance from
   GET /returns/points (the points ledger) — never a hardcoded number.

   Actions:
     Recycle → the existing flow: a recycling request starts from an order
               (Account → Orders → order → Recycle). Guests are asked to sign
               in and land there afterwards.
     Sell / Reuse → no self-serve flow exists yet; both route to the real
               Contact page (partnership topic) rather than a fake form.
========================================================= */

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.09 } } };
const viewportOnce = { once: true, amount: 0.2 } as const;

/* ---------- Existing page data (unchanged values) ---------- */

const sustainabilityBadges = [
  { icon: ShieldCheck, label: "Responsible Materials", text: "Kraft, corrugated and recyclable substrates." },
  { icon: Factory, label: "Cleaner Manufacturing", text: "Lower-waste production processes." },
  { icon: Cloud, label: "Lower Carbon Impact", text: "Lighter materials, smarter logistics." },
  { icon: Recycle, label: "Circular Packaging", text: "Return, reuse and recycle streams." },
];

const loopSteps = [
  { number: "01", title: "Collect", text: "Keep used packaging aside.", image: step1, alt: "Used packaging boxes collected and set aside" },
  { number: "02", title: "Schedule Pickup", text: "Choose a convenient collection slot.", image: step2, alt: "Calendar with a scheduled pickup slot" },
  { number: "03", title: "Inspection", text: "We verify material and check eligibility.", image: step3, alt: "Packaging being inspected for material and condition" },
  { number: "04", title: "Recycle / Reuse", text: "Approved packaging enters recovery or resale streams.", image: step4, alt: "Green collection truck picking up approved packaging" },
  { number: "05", title: "Get Rewarded", text: "You receive money and/or ZOLO points.", image: step5, alt: "Reward points credited to an Eco Wallet" },
];

const stats = [
  { value: "10K+", label: "Participants", icon: Users },
  { value: "50K+", label: "Packs Recycled", icon: PackageCheck },
  { value: "120T", label: "CO₂ Reduced", icon: Cloud },
  { value: "1M+", label: "Points Issued", icon: Award },
];

const earningMethods = [
  { icon: Recycle, title: "Return Packaging", text: "Recycle eligible used packaging with us.", points: "+100 pts" },
  { icon: Users, title: "Refer a Business", text: "Invite another business to join Zolo.", points: "+250 pts" },
];

/* Tier thresholds mirror the membership table (the `points` strings above). */
const tierThresholds = tiers.map((t) => ({ ...t, min: Number(t.points.replace(/[^\d]/g, "")) || 0 }));
const tierFor = (balance: number) => [...tierThresholds].reverse().find((t) => balance >= t.min) ?? tierThresholds[0];

const tierStyle: Record<string, { ring: string; badge: string; icon: string; card: string; check: string }> = {
  "Green Member": {
    ring: "border-green-200 hover:border-green-400",
    badge: "bg-green-600 text-white",
    icon: "bg-green-50 text-green-700",
    card: "bg-white",
    check: "text-green-600",
  },
  "Eco Silver": {
    ring: "border-slate-200 hover:border-slate-400",
    badge: "bg-slate-700 text-white",
    icon: "bg-slate-100 text-slate-700",
    card: "bg-gradient-to-b from-slate-50 to-white",
    check: "text-slate-600",
  },
  "Eco Gold": {
    ring: "border-amber-200 hover:border-amber-400",
    badge: "bg-amber-500 text-dark-950",
    icon: "bg-amber-50 text-amber-600",
    card: "bg-gradient-to-b from-amber-50/70 to-white",
    check: "text-amber-600",
  },
  "Eco Platinum": {
    ring: "border-dark-800 hover:border-primary-400",
    badge: "bg-primary-500 text-white",
    icon: "bg-white/10 text-white",
    card: "bg-dark-950 text-white",
    check: "text-primary-400",
  },
};

/* ---------- Small building blocks ---------- */

function Eyebrow({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "light" }) {
  return (
    <p className={`inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] ${tone === "light" ? "text-lime-300" : "text-green-700"}`}>
      <span className={`h-1 w-6 rounded-full ${tone === "light" ? "bg-lime-300" : "bg-green-600"}`} />
      {children}
    </p>
  );
}

function SectionHeading({ eyebrow, title, description, center = true, tone = "green" }: {
  eyebrow: string; title: React.ReactNode; description?: string; center?: boolean; tone?: "green" | "light";
}) {
  return (
    <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className={`mt-3 font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl lg:text-5xl ${tone === "light" ? "text-white" : "text-dark-900"}`}>{title}</h2>
      {description && <p className={`mt-4 text-base leading-7 sm:text-lg ${tone === "light" ? "text-green-50/80" : "text-dark-500"}`}>{description}</p>}
    </motion.div>
  );
}

const primaryBtn = "inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-primary-500/25 transition hover:-translate-y-0.5 hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2";
const darkBtn = "inline-flex items-center justify-center gap-2 rounded-full bg-dark-900 px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-dark-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dark-900 focus-visible:ring-offset-2";
const ghostBtn = "inline-flex items-center justify-center gap-2 rounded-full border border-dark-200 bg-white px-6 py-3 text-sm font-bold text-dark-800 transition hover:-translate-y-0.5 hover:border-dark-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dark-900 focus-visible:ring-offset-2";

/* ---------- Eco Wallet (real balance from the points ledger) ---------- */

function EcoWallet() {
  const { isAuthenticated, authReady, openAuthModal, user } = useAuthSession();
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
    <motion.aside
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      aria-label="Your Eco Wallet"
      className="relative overflow-hidden rounded-[28px] bg-dark-950 p-6 text-white shadow-[0_24px_60px_rgba(2,6,23,0.25)] sm:p-8"
    >
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-green-500/20 blur-3xl" aria-hidden />
      <div className="absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-primary-500/15 blur-3xl" aria-hidden />
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold text-green-200">
          <WalletCards className="h-3.5 w-3.5" aria-hidden /> Eco Wallet
        </span>

        {!isAuthenticated ? (
          <div className="mt-5">
            <p className="font-display text-2xl font-extrabold">Your points, in one place</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-dark-300">
              Sign in to see your Eco Wallet balance, your membership level and how close you are to the next tier.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => openAuthModal({ tab: "login" })} className={primaryBtn}>Sign in</button>
              <button type="button" onClick={() => openAuthModal({ tab: "register" })} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                Create an account
              </button>
            </div>
          </div>
        ) : state.status === "error" ? (
          <p className="mt-5 text-sm text-red-300">We couldn't load your wallet right now. Please try again shortly.</p>
        ) : (
          <div className="mt-5 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="text-sm text-dark-300">{user?.firstName ? `${user.firstName}, you have` : "You have"}</p>
              <p className="mt-1 font-display text-5xl font-extrabold tabular-nums sm:text-6xl">
                {state.status === "loading" ? <span className="inline-block h-12 w-40 animate-pulse rounded-lg bg-white/10" /> : state.balance.toLocaleString("en-IN")}
                <span className="ml-2 text-lg font-bold text-green-300">Points</span>
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-3 py-1 text-xs font-bold text-green-200"><tier.icon className="h-3.5 w-3.5" aria-hidden /> {tier.name}</span>
                <span className="text-xs text-dark-300">{tier.discount} off orders · {tier.support} support</span>
              </div>
            </div>
            <div className="w-full sm:w-64">
              <div className="flex items-center justify-between text-xs text-dark-300">
                <span>{next ? `Next: ${next.name}` : "Top tier reached"}</span>
                <span>{next ? `${(next.min - state.balance).toLocaleString("en-IN")} pts to go` : "🎉"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next membership tier">
                <div className="h-full rounded-full bg-gradient-to-r from-green-400 to-lime-300 transition-all duration-700" style={{ width: `${progress}%` }} />
              </div>
              <Link to="/account/recycle" className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-green-200 hover:text-white">
                View recycling history <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function EcoRewards() {
  const nav = useNavigate();
  const guard = useAuthGuard();

  // Recycling requests start from an order (Account → Orders → order → Recycle);
  // guests sign in first and are taken there automatically.
  const startRecycling = () => guard(() => nav("/account/orders"), { label: "start a recycling request" });

  // Page-level metadata (the app has no per-route SEO layer; restore on leave).
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
      key: "sell",
      icon: Coins,
      eyebrow: "Sell",
      title: "Sell Your Packaging",
      text: "Get paid for reusable or surplus packaging.",
      bullets: ["Used or unused packaging", "Quick valuation process", "Pickup from your location", "Get money + reward points"],
      cta: "Sell Packaging",
      image: sellBox,
      alt: "Plain kraft corrugated shipping box ready for resale",
      accent: "from-amber-50 to-orange-50",
      onClick: () => nav("/contact?topic=partnership"),
    },
    {
      key: "reuse",
      icon: Repeat,
      eyebrow: "Reuse",
      title: "Reuse Packaging",
      text: "Give packaging another life. List it for other businesses.",
      bullets: ["List reusable packaging", "Help other businesses", "Earn rewards", "Support circular economy"],
      cta: "List for Reuse",
      image: reuseBag,
      alt: "Navy paper shopping bag with rope handles, reusable branded packaging",
      accent: "from-sky-50 to-slate-50",
      onClick: () => nav("/contact?topic=partnership"),
    },
    {
      key: "recycle",
      icon: Recycle,
      eyebrow: "Recycle",
      title: "Recycle & Earn",
      text: "Recycle damaged or used packaging and earn points.",
      bullets: ["Easy pickup scheduling", "Verified recycling partners", "Track your impact", "Earn ZOLO reward points"],
      cta: "Recycle Now",
      image: step4,
      alt: "Green collection truck scheduled for a packaging pickup",
      accent: "from-green-50 to-lime-50",
      onClick: startRecycling,
    },
  ];

  return (
    <main className="bg-white">
      {/* =====================================================
          1. HERO
      ====================================================== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-green-50/70 via-white to-white">
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-green-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-20 top-40 h-80 w-80 rounded-full bg-primary-200/40 blur-3xl" aria-hidden />
        <motion.div animate={{ y: [0, -10, 0], rotate: [0, 6, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }} className="pointer-events-none absolute left-[6%] top-24 hidden text-green-300 lg:block" aria-hidden>
          <Leaf className="h-10 w-10" />
        </motion.div>
        <motion.div animate={{ y: [0, 12, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} className="pointer-events-none absolute right-[8%] top-16 hidden text-green-300/70 lg:block" aria-hidden>
          <Leaf className="h-7 w-7 rotate-45" />
        </motion.div>

        <div className="shell grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <Eyebrow>Packaging with purpose</Eyebrow>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-dark-900 sm:text-5xl lg:text-6xl">
              Give Your Packaging
              <br />
              <span className="grad-text">a Second Life</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-dark-500 sm:text-lg sm:leading-8">
              Don’t throw packaging away. Sell it, return it or recycle it and earn rewards for a cleaner, greener tomorrow.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/contact?topic=partnership" className={primaryBtn}>Sell Packaging</Link>
              <button type="button" onClick={startRecycling} className={darkBtn}>Recycle &amp; Earn</button>
              <a href="#membership" className={ghostBtn}>Explore Eco Rewards <ArrowRight className="h-4 w-4" aria-hidden /></a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-dark-600" aria-label="Ways to earn">
              {["Sell", "Reuse", "Recycle"].map((w) => (
                <li key={w} className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden /> {w}</li>
              ))}
            </ul>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: 0.8 }} className="relative mx-auto w-full max-w-[560px]">
            <div className="absolute -inset-6 rounded-[40px] bg-green-200/40 blur-3xl" aria-hidden />
            <div className="relative overflow-hidden rounded-[32px] border border-green-100 bg-gradient-to-br from-green-50 to-lime-50 p-6 shadow-[0_30px_80px_rgba(22,101,52,0.18)] sm:p-10">
              <img
                src={heroMailer}
                alt="ZOLO 100% compostable mailer bag with leaf artwork"
                width={1216}
                height={1312}
                fetchPriority="high"
                className="mx-auto aspect-[4/5] w-full max-w-[360px] object-contain drop-shadow-[0_24px_30px_rgba(22,101,52,0.25)]"
              />
            </div>
            {/* Floating impact card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="absolute -bottom-6 -left-2 w-[220px] rounded-2xl bg-[#0b4a2b] p-4 text-white shadow-[0_20px_50px_rgba(2,6,23,0.3)] sm:-left-8 sm:w-[250px] sm:p-5"
            >
              <p className="font-display text-base font-extrabold leading-tight sm:text-lg">Small Actions<br />Big Impact</p>
              <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10"><Award className="h-5 w-5 text-lime-300" aria-hidden /></span>
                <div>
                  <p className="font-display text-2xl font-extrabold leading-none">1M+</p>
                  <p className="mt-1 text-xs text-green-100/80">Points Issued</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          2. BENEFIT STRIP
      ====================================================== */}
      <section className="border-y border-green-100 bg-white">
        <motion.ul variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="shell grid grid-cols-1 gap-3 py-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:py-0">
          {sustainabilityBadges.map(({ icon: Icon, label, text }) => (
            <motion.li key={label} variants={fadeUp} className="flex items-center gap-4 rounded-2xl border border-green-100 bg-green-50/40 px-4 py-4 lg:rounded-none lg:border-0 lg:border-r lg:bg-transparent lg:py-6 lg:last:border-r-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-600 text-white shadow-md shadow-green-600/20"><Icon className="h-5 w-5" aria-hidden /></span>
              <div className="min-w-0">
                <p className="font-display text-sm font-bold text-dark-900">{label}</p>
                <p className="truncate text-xs text-dark-500">{text}</p>
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </section>

      {/* =====================================================
          3. SELL / REUSE / RECYCLE
      ====================================================== */}
      <section id="actions" className="py-16 lg:py-24">
        <div className="shell">
          <SectionHeading
            eyebrow="Three ways to earn"
            title={<>Sell it. Reuse it. <span className="grad-text">Recycle it.</span></>}
            description="Every pack you keep out of landfill comes back to you as money, points or both."
          />
          <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {actionCards.map(({ key, icon: Icon, eyebrow, title, text, bullets, cta, image, alt, accent, onClick }) => (
              <motion.article key={key} variants={fadeUp} whileHover={{ y: -8 }} className="group flex flex-col overflow-hidden rounded-[28px] border border-dark-100 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
                <div className={`relative flex h-56 items-center justify-center overflow-hidden bg-gradient-to-br ${accent} p-6`}>
                  <img src={image} alt={alt} loading="lazy" className="h-full w-auto max-w-[80%] object-contain drop-shadow-[0_18px_24px_rgba(15,23,42,0.18)] transition-transform duration-700 group-hover:scale-105" />
                  <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-dark-800 shadow-sm">
                    <Icon className="h-3.5 w-3.5 text-green-600" aria-hidden /> {eyebrow}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-6 sm:p-7">
                  <h3 className="font-display text-xl font-extrabold text-dark-900">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-dark-500">{text}</p>
                  <ul className="mt-5 space-y-2.5">
                    {bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm text-dark-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden /> {b}</li>
                    ))}
                  </ul>
                  <button type="button" onClick={onClick} className={`${darkBtn} mt-7 w-full sm:w-auto group-hover:bg-primary-500`}>
                    {cta} <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          4. HOW IT WORKS
      ====================================================== */}
      <section id="how-it-works" className="border-y border-green-100 bg-gradient-to-b from-green-50/70 via-white to-white py-16 lg:py-24">
        <div className="shell">
          <SectionHeading eyebrow="How it works" title="A Simple Loop for a Better Tomorrow" description="Five easy steps turn your used packaging into real impact and real rewards." />

          {/* Desktop: 5 across with connectors. Below lg: horizontal snap strip. */}
          <motion.ol variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="no-scrollbar mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4 lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0" aria-label="Recycling steps">
            {loopSteps.map(({ number, title, text, image, alt }, index) => (
              <motion.li key={title} variants={fadeUp} className="relative w-[78%] shrink-0 snap-start sm:w-[46%] lg:w-auto">
                <article className="group h-full rounded-[24px] border border-dark-100 bg-white p-4 shadow-[0_8px_35px_rgba(15,23,42,0.05)] transition hover:-translate-y-2 hover:shadow-[0_20px_50px_rgba(15,23,42,0.1)]">
                  <div className="relative h-40 overflow-hidden rounded-[18px] bg-green-50">
                    <img src={image} alt={alt} loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
                    <span className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white shadow-md">{number}</span>
                  </div>
                  <div className="px-2 pb-2 pt-5">
                    <h3 className="font-display text-lg font-bold text-dark-900">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-dark-500">{text}</p>
                  </div>
                </article>
                {index < loopSteps.length - 1 && (
                  <span className="absolute -right-[22px] top-[76px] z-10 hidden h-9 w-9 items-center justify-center rounded-full border border-green-100 bg-white shadow-md lg:flex" aria-hidden>
                    <ArrowRight className="h-4 w-4 text-green-600" />
                  </span>
                )}
              </motion.li>
            ))}
          </motion.ol>

          {/* Sell · Reuse · Recycle at a glance (existing waste-hierarchy graphic) */}
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mt-12 grid items-center gap-8 rounded-[28px] border border-green-100 bg-white p-6 shadow-sm md:grid-cols-[220px_1fr] lg:p-8">
            <img src={wasteHierarchy} alt="Waste hierarchy chart: rethink and refuse, reduce, reuse and repair, repurpose, recycle, rot" loading="lazy" className="mx-auto w-full max-w-[220px] rounded-2xl" />
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { icon: Coins, title: "Sell", text: "Get paid for reusable or surplus packaging." },
                { icon: Repeat, title: "Reuse", text: "Give packaging another life through the ZOLO marketplace." },
                { icon: Recycle, title: "Recycle", text: "Send eligible packaging for recycling and earn ZOLO points." },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl bg-green-50/60 p-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-green-700 shadow-sm"><Icon className="h-5 w-5" aria-hidden /></span>
                  <p className="mt-3 font-display font-bold text-dark-900">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-dark-500">{text}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          5. IMPACT
      ====================================================== */}
      <section className="py-16 lg:py-24">
        <div className="shell">
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.98 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={viewportOnce} transition={{ duration: 0.8 }} className="relative overflow-hidden rounded-[32px] bg-[#073b23] px-6 py-14 text-white sm:px-12 lg:px-16 lg:py-20">
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-lime-400/15 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-green-400/15 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute inset-0 grid-bg-light opacity-10" aria-hidden />
            <div className="relative grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <Eyebrow tone="light">Our Impact So Far</Eyebrow>
                <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">Together we&rsquo;re building a cleaner, greener planet.</h2>
                <p className="mt-4 max-w-md leading-7 text-green-50/80">Every return, reuse and recycling pickup adds up. These are the numbers so far.</p>
                <a href="#actions" className="mt-7 inline-flex items-center gap-2 rounded-full bg-lime-400 px-6 py-3 text-sm font-bold text-green-950 transition hover:-translate-y-0.5 hover:bg-lime-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#073b23]">
                  Be Part of the Change <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
              </div>
              <motion.ul variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="grid grid-cols-2 gap-4 lg:grid-cols-2" aria-label="Impact statistics">
                {stats.map(({ value, label, icon: Icon }) => (
                  <motion.li key={label} variants={fadeUp} className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm transition hover:bg-white/15">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime-400/20 text-lime-300"><Icon className="h-5 w-5" aria-hidden /></span>
                    <p className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">{value}</p>
                    <p className="mt-1 text-sm text-green-100/80">{label}</p>
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          6. EARN + ECO WALLET
      ====================================================== */}
      <section className="border-y border-dark-100 bg-dark-50 py-16 lg:py-24">
        <div className="shell grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionHeading center={false} eyebrow="Eco Rewards" title="Small actions. Real rewards." description="Earn points through the actions that create the most meaningful impact." />
            <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mt-8 grid gap-4 sm:grid-cols-2">
              {earningMethods.map(({ icon: Icon, title, text, points }) => (
                <motion.div key={title} variants={fadeUp} whileHover={{ y: -6 }} className="group rounded-[24px] border border-dark-100 bg-white p-5 shadow-sm transition hover:shadow-xl">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-green-700 transition group-hover:scale-110"><Icon className="h-6 w-6" aria-hidden /></span>
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">{points}</span>
                  </div>
                  <h3 className="mt-5 font-display text-lg font-bold text-dark-900">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-dark-500">{text}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
          <EcoWallet />
        </div>
      </section>

      {/* =====================================================
          7. MEMBERSHIP
      ====================================================== */}
      <section id="membership" className="py-16 lg:py-24">
        <div className="shell">
          <SectionHeading eyebrow="Eco Rewards Membership" title={<>Grow Your Impact.<br />Unlock More.</>} description="Your contribution moves you through membership levels with better benefits." />
          <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {tiers.map((tier) => {
              const s = tierStyle[tier.name] ?? tierStyle["Green Member"];
              const Icon = tier.icon;
              const dark = tier.name === "Eco Platinum";
              return (
                <motion.article key={tier.name} variants={fadeUp} whileHover={{ y: -8 }} className={`relative flex flex-col rounded-[28px] border p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_24px_60px_rgba(15,23,42,0.12)] ${s.ring} ${s.card}`}>
                  {dark && <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-primary-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-300"><Sparkles className="h-3 w-3" aria-hidden /> Top tier</span>}
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${s.icon}`}><Icon className="h-6 w-6" aria-hidden /></span>
                  <h3 className={`mt-5 font-display text-xl font-extrabold ${dark ? "text-white" : "text-dark-900"}`}>{tier.name}</h3>
                  <p className={`mt-1 text-sm ${dark ? "text-dark-300" : "text-dark-500"}`}>Required Points: <span className={`font-semibold ${dark ? "text-white" : "text-dark-800"}`}>{tier.points}</span></p>
                  <div className="mt-5 flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${s.badge}`}>{tier.discount} off</span>
                    <span className={`text-xs ${dark ? "text-dark-300" : "text-dark-500"}`}>on orders</span>
                  </div>
                  <p className={`mt-4 text-sm ${dark ? "text-dark-300" : "text-dark-500"}`}>Priority Support: <span className={`font-semibold ${dark ? "text-white" : "text-dark-800"}`}>{tier.support}</span></p>
                  <ul className={`mt-5 space-y-2.5 border-t pt-5 ${dark ? "border-white/10" : "border-dark-100"}`}>
                    {tier.benefits.map((b) => (
                      <li key={b} className={`flex items-center gap-2.5 text-sm ${dark ? "text-dark-200" : "text-dark-700"}`}><CheckCircle2 className={`h-4 w-4 shrink-0 ${s.check}`} aria-hidden /> {b}</li>
                    ))}
                  </ul>
                </motion.article>
              );
            })}
          </motion.div>
          <p className="mt-6 text-center text-xs text-dark-400">
            <Medal className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden /> Levels are based on the points in your Eco Wallet. <Gift className="ml-2 mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden /> Benefits apply automatically at checkout.
          </p>
        </div>
      </section>

      {/* =====================================================
          8. FINAL CTA
      ====================================================== */}
      <section className="pb-20">
        <div className="shell">
          <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={viewportOnce} transition={{ duration: 0.8 }} className="relative overflow-hidden rounded-[32px] bg-dark-950 text-white">
            <img src={ctaScene} alt="ZOLO kraft packaging range on a studio table with green plants" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#052f1c] via-[#073b23]/90 to-[#073b23]/30" aria-hidden />
            <div className="relative z-10 px-7 py-14 sm:px-12 lg:px-16 lg:py-20">
              <Eyebrow tone="light">Better tomorrow starts today</Eyebrow>
              <h2 className="mt-4 max-w-2xl font-display text-3xl font-extrabold leading-[1.1] sm:text-5xl">
                Every action <span className="text-lime-400">counts.</span>
                <br />
                Every pack <span className="text-lime-400">matters.</span>
              </h2>
              <p className="mt-5 max-w-lg leading-7 text-green-50/85">
                Choose better packaging, return what you can and get rewarded for building a more circular future.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" onClick={startRecycling} className="inline-flex items-center gap-2 rounded-full bg-lime-400 px-6 py-3 text-sm font-bold text-green-950 transition hover:-translate-y-0.5 hover:bg-lime-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#073b23]">
                  Start Recycling <Truck className="h-4 w-4" aria-hidden />
                </button>
                <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                  Learn More <ClipboardCheck className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
