import { useEffect, useState, type CSSProperties } from "react";
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
import { ecoCreditsApi, fmtQty, recyclingApi, type RecyclingProgram } from "../lib/api/recycling";

/* =========================================================
   ECO REWARDS — the one sustainability / circular-economy page.
   Route: /eco-rewards (/sustainability redirects here — see App.tsx).

   Visual target: the supplied reference screenshot (sections, proportions,
   spacing and colours are matched to it; the global announcement bar,
   header and footer are the site-wide components and are reused as-is).
   Data: the impact statistics, five-step loop and membership tiers are the
   page's existing content. The Eco Wallet reads the customer's REAL balance
   from GET /eco-credits (the Eco Credit ledger).

   Actions:
     Recycle → the existing flow: a recycling request starts from an order
               (Account → Orders → order → Recycle). Guests sign in first
               and land there automatically.
     Sell / Reuse → no self-serve flow exists yet; both route to the real
               Contact page (partnership topic) rather than a fake form.
========================================================= */

/* The palette this page was designed with is now the GLOBAL design system
   (src/index.css @theme). These aliases keep the page's class names readable
   while pointing at the shared tokens, so the page and the rest of the site
   can never drift apart again. */
const palette = {
  "--zolo-orange": "var(--color-primary-500)",
  "--zolo-orange-dark": "var(--color-primary-600)",
  "--zolo-navy": "var(--color-navy-900)",
  "--zolo-green": "var(--color-green-500)",
  "--zolo-green-deep": "var(--color-green-700)",
  "--zolo-green-band": "var(--color-green-800)",
  "--zolo-light-green": "var(--color-green-100)",
  "--zolo-light-orange": "var(--color-cream-200)",
  "--zolo-text": "var(--color-dark-900)",
  "--zolo-muted": "var(--color-dark-500)",
  "--zolo-border": "var(--color-dark-200)",
  "--zolo-white": "#ffffff",
} as CSSProperties;

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
const viewportOnce = { once: true, amount: 0.15 } as const;

/* ---------- Page data (existing values) ---------- */

const heroBenefits = [
  { icon: Leaf, label: ["Reduce", "Waste"] },
  { icon: Cloud, label: ["Lower", "Emissions"] },
  { icon: Recycle, label: ["Circular", "Economy"] },
  { icon: Users, label: ["Stronger", "Communities"] },
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

const tierThresholds = tiers.map((t) => ({ ...t, min: Number(t.points.replace(/[^\d]/g, "")) || 0 }));
const tierFor = (balance: number) => [...tierThresholds].reverse().find((t) => balance >= t.min) ?? tierThresholds[0];

const tierLook: Record<string, { card: string; circle: string; name: string; icon: typeof Leaf }> = {
  "Green Member": { card: "border-[#cfe9d6] bg-[var(--zolo-light-green)]", circle: "bg-[#d3efdb] text-[var(--zolo-green)]", name: "text-[var(--zolo-green)]", icon: Leaf },
  "Eco Silver": { card: "border-[var(--zolo-border)] bg-white", circle: "bg-[#e2e8f0] text-[#64748b]", name: "text-[var(--zolo-text)]", icon: Medal },
  "Eco Gold": { card: "border-[#f5e6b8] bg-[#fffbea]", circle: "bg-[#f7d98a] text-[#b45309]", name: "text-[var(--zolo-text)]", icon: Star },
  "Eco Platinum": { card: "border-[var(--zolo-border)] bg-white", circle: "bg-[#1e293b] text-white", name: "text-[var(--zolo-text)]", icon: Crown },
};

/* ---------- Buttons: the shared .btn system (44px, 8px radius, 15px bold) ---------- */
const btnOrange = "btn btn-primary";
const btnNavy = "btn btn-navy";
const btnOutline = "btn btn-outline";
const btnOutlineOrange = "btn border-[1.5px] border-primary-500 bg-white text-primary-600 hover:bg-cream-200";
const btnGreen = "btn btn-green";
const btnSm = "btn-sm";

function Eyebrow({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "orange" }) {
  return <p className={`text-[12px] font-bold uppercase tracking-[0.18em] ${tone === "orange" ? "text-[var(--zolo-orange)]" : "text-[var(--zolo-green)]"}`}>{children}</p>;
}

/* ---------- Live recycling rates (admin rules + reward settings) ----------
   Renders NOTHING until the admin has an active recycling rule, so the page is
   unchanged when the programme isn't configured. No figure is written in code:
   every number comes from GET /recycling/program. */
function LiveRates() {
  const [program, setProgram] = useState<RecyclingProgram | null>(null);
  useEffect(() => {
    let alive = true;
    recyclingApi.program().then((p) => { if (alive) setProgram(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!program || program.materials.length === 0) return null;
  const { reward } = program;
  return (
    <div className="mx-auto mt-7 max-w-5xl rounded-[12px] border border-[var(--zolo-border)] bg-white px-5 py-5 shadow-[0_6px_18px_rgba(15,23,42,0.05)]" aria-label="Current recycling rewards">
      <p className="text-center text-[12px] font-extrabold uppercase tracking-[0.14em] text-[var(--zolo-green)]">Today&rsquo;s recycling rewards</p>
      <ul className="mt-3 flex flex-wrap justify-center gap-2.5">
        {program.materials.map((m) => (
          <li key={m.ruleId} className="rounded-full bg-[#e8f5ec] px-4 py-1.5 text-[14px] font-bold text-[#14532d]">
            1 {m.unit} {m.material} → {fmtQty(m.creditsPerUnit)} Eco Credits
          </li>
        ))}
        {reward.enabled && reward.creditsRequired && reward.couponValueMinor ? (
          <li className="rounded-full bg-[#fff1e6] px-4 py-1.5 text-[14px] font-bold text-[var(--zolo-orange-dark)]">
            {reward.creditsRequired.toLocaleString("en-IN")} Eco Credits → ₹{(reward.couponValueMinor / 100).toLocaleString("en-IN")} coupon
          </li>
        ) : null}
      </ul>
      <p className="mt-3 text-center text-[13px] text-[var(--zolo-muted)]">
        Credits are calculated on the quantity we verify, at the rate in force when your request is approved. <Link to="/account/recycle" className="font-bold text-[var(--zolo-green)] hover:underline">Recycle &amp; earn</Link>
      </p>
    </div>
  );
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
    ecoCreditsApi.wallet()
      .then((r) => { if (alive) setState({ status: "ready", balance: r.balance }); })
      .catch(() => { if (alive) setState({ status: "error", balance: 0 }); });
    return () => { alive = false; };
  }, [authReady, isAuthenticated]);

  const tier = tierFor(state.balance);
  const next = tierThresholds.find((t) => t.min > state.balance) ?? null;
  const progress = next ? Math.min(100, Math.round(((state.balance - tier.min) / (next.min - tier.min)) * 100)) : 100;

  return (
    <aside aria-label="Your Eco Wallet" className="mt-5 rounded-xl border border-[var(--zolo-border)] bg-white p-4">
      <p className="inline-flex items-center gap-2 text-[12px] font-bold text-[var(--zolo-green)]"><WalletCards className="h-4 w-4" aria-hidden /> Your Eco Wallet</p>
      {!isAuthenticated ? (
        <p className="mt-1.5 text-[13px] leading-5 text-[var(--zolo-muted)]">
          <button type="button" onClick={() => openAuthModal({ tab: "login" })} className="rounded font-bold text-[var(--zolo-orange-dark)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--zolo-orange)]">Sign in</button> to see your points and membership level.
        </p>
      ) : state.status === "error" ? (
        <p className="mt-1.5 text-[13px] text-red-600">We couldn't load your wallet right now.</p>
      ) : (
        <>
          <p className="mt-1.5 font-display text-[28px] font-extrabold leading-none tabular-nums text-[var(--zolo-text)]">
            {state.status === "loading" ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-slate-100" /> : state.balance.toLocaleString("en-IN")}
            <span className="ml-1.5 text-[13px] font-bold text-[var(--zolo-green)]">pts</span>
          </p>
          <p className="mt-1.5 text-[12px] text-[var(--zolo-muted)]"><span className="font-semibold text-[var(--zolo-text)]">{tier.name}</span> · {tier.discount} off orders</p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next membership tier">
            <div className="h-full rounded-full bg-[var(--zolo-green)] transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--zolo-muted)]">{next ? `${(next.min - state.balance).toLocaleString("en-IN")} pts to ${next.name}` : "Top tier reached"} · <Link to="/account/recycle" className="font-semibold text-[var(--zolo-green)] hover:underline">Recycling history</Link></p>
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
      key: "sell", icon: Boxes, title: ["Sell Your", "Packaging"], text: ["Get paid for reusable or", "surplus packaging."],
      bullets: ["Used or unused packaging", "Quick valuation process", "Pickup from your location", "Get money + reward points"],
      cta: "Sell Packaging", image: sellBox, alt: "Open corrugated cardboard box ready to be sold", imageClass: "object-contain p-3",
      tint: "bg-[var(--zolo-light-green)] border-[#d6ecdc]", badge: "bg-[var(--zolo-green)] text-white", button: btnOrange,
      onClick: () => nav("/contact?topic=partnership"),
    },
    {
      key: "reuse", icon: Repeat, title: ["Reuse", "Packaging"], text: ["Give packaging another life.", "List it for other businesses."],
      bullets: ["List reusable packaging", "Help other businesses", "Earn rewards", "Support circular economy"],
      cta: "List for Reuse", image: reuseBox, alt: "Kraft mailer box with a blank logo area, ready for reuse", imageClass: "object-cover",
      tint: "bg-[var(--zolo-light-orange)] border-[#fde3c8]", badge: "bg-[var(--zolo-orange)] text-white", button: btnOutlineOrange,
      onClick: () => nav("/contact?topic=partnership"),
    },
    {
      key: "recycle", icon: Recycle, title: ["Recycle", "& Earn"], text: ["Recycle damaged or used", "packaging and earn points."],
      bullets: ["Easy pickup scheduling", "Verified recycling partners", "Track your impact", "Earn ZOLO reward points"],
      cta: "Recycle Now", image: recycleBin, alt: "Green recycling bin filled with used kraft boxes and paper bags", imageClass: "object-contain p-2",
      tint: "bg-[var(--zolo-light-green)] border-[#d6ecdc]", badge: "bg-[var(--zolo-green)] text-white", button: btnGreen,
      onClick: startRecycling,
    },
  ];

  return (
    <main className="bg-white text-[var(--zolo-text)]" style={palette}>
      {/* =====================================================
          HERO  (reference: compact, photo bleeds to the right edge)
      ====================================================== */}
      <section className="relative overflow-hidden bg-[#f7fbf8]">
        <div className="shell grid lg:min-h-[400px] lg:grid-cols-[46%_54%] xl:min-h-[420px]">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative z-10 py-9 lg:py-11 lg:pr-8">
            <Eyebrow>Packaging with purpose</Eyebrow>
            <h1 className="mt-3 font-display text-[40px] font-extrabold leading-[1.02] tracking-[-0.02em] sm:text-[46px] lg:text-[40px] xl:text-[48px] 2xl:text-[54px]">
              Give Your Packaging
              <br />
              <span className="text-[var(--zolo-green)]">a Second Life</span>
            </h1>
            <p className="mt-4 max-w-[460px] text-[15px] leading-[1.55] text-[#334155] sm:text-[17px] lg:text-[15px] xl:text-[17px]">
              Don’t throw packaging away. Sell it, return it or recycle it and earn rewards for a cleaner, greener tomorrow.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/contact?topic=partnership" className={btnOrange}><Package className="h-[18px] w-[18px]" aria-hidden /> Sell Packaging</Link>
              <button type="button" onClick={startRecycling} className={btnNavy}><Recycle className="h-[18px] w-[18px]" aria-hidden /> Recycle &amp; Earn</button>
              <a href="#membership" className={btnOutline}><Gift className="h-[18px] w-[18px] text-[var(--zolo-orange)]" aria-hidden /> Explore Eco Rewards</a>
            </div>
            <ul className="mt-7 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4 sm:gap-x-4" aria-label="Why it matters">
              {heroBenefits.map(({ icon: Icon, label }) => (
                <li key={label.join(" ")} className="flex items-center gap-2.5">
                  <Icon className="h-7 w-7 shrink-0 text-[var(--zolo-green)]" strokeWidth={1.75} aria-hidden />
                  <span className="text-[12.5px] font-semibold leading-[1.15] text-[var(--zolo-text)]">{label[0]}<br />{label[1]}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <div className="relative -mx-[var(--shell-pad)] min-h-[300px] sm:min-h-[380px] lg:mx-0 lg:-mr-[var(--shell-pad)] lg:min-h-0">
            <img
              src={heroScene}
              alt="ZOLO kraft and green branded boxes on a table beside leafy plants"
              width={1728}
              height={918}
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover object-[62%_center]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#f7fbf8] via-transparent to-transparent lg:from-[#f7fbf8] lg:via-[#f7fbf8]/0" aria-hidden />
            {/* Floating impact card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.5 }}
              className="absolute right-5 top-5 w-[196px] rounded-[14px] bg-[var(--zolo-green-deep)] p-[18px] text-white shadow-[0_24px_50px_rgba(2,6,23,0.35)] sm:w-[212px] lg:right-[var(--shell-pad)] lg:top-3"
            >
              <Leaf className="absolute right-[18px] top-[18px] h-6 w-6 text-[#a3e635]" strokeWidth={1.75} aria-hidden />
              <p className="font-display text-[21px] font-semibold leading-[1.15]">Small<br />Actions<br /><span className="font-extrabold">Big Impact</span></p>
              <div className="mt-3.5 rounded-[10px] bg-white p-3.5 text-[var(--zolo-text)]">
                <Leaf className="h-6 w-6 text-[var(--zolo-green)]" strokeWidth={1.75} aria-hidden />
                <p className="mt-2 font-display text-[26px] font-extrabold leading-none">1M+</p>
                <p className="mt-1.5 text-[13.5px] font-medium leading-[1.25] text-[#334155]">Packs Recycled<br />Together</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* =====================================================
          SELL / REUSE / RECYCLE  (reference: 3 cards, image left 45%)
      ====================================================== */}
      <section id="actions" className="pt-5 lg:pt-5">
        <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="shell grid gap-5 lg:grid-cols-3">
          {actionCards.map(({ key, icon: Icon, title, text, bullets, cta, image, alt, imageClass, tint, badge, button, onClick }) => (
            <motion.article key={key} variants={fadeUp} className={`grid overflow-hidden rounded-[18px] border ${tint} grid-cols-1 sm:grid-cols-[45%_1fr] lg:min-h-[300px]`}>
              <div className="relative h-44 overflow-hidden sm:h-auto">
                <img src={image} alt={alt} loading="lazy" className={`absolute inset-0 h-full w-full ${imageClass}`} />
              </div>
              <div className="flex flex-col p-[18px] sm:pl-4">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${badge}`}><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                  <h2 className="font-display text-[17px] font-extrabold uppercase leading-[1.1] tracking-[-0.01em]">{title[0]}<br />{title[1]}</h2>
                </div>
                <p className="mt-2.5 text-[13px] leading-[1.45] text-[#334155]">{text[0]}<br />{text[1]}</p>
                <ul className="mt-2.5 space-y-[5px]">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-[13px] leading-[1.35] text-[#1e293b]"><Check className="mt-[2px] h-[15px] w-[15px] shrink-0 text-[var(--zolo-green)]" strokeWidth={3} aria-hidden /> {b}</li>
                  ))}
                </ul>
                <button type="button" onClick={onClick} className={`${button} ${btnSm} mt-4 self-start`}>
                  {cta} <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* =====================================================
          HOW IT WORKS
      ====================================================== */}
      <section id="how-it-works" className="pb-8 pt-9 lg:pb-9 lg:pt-10">
        <div className="shell">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce} className="mx-auto max-w-2xl text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-1.5 font-display text-[28px] font-extrabold tracking-[-0.02em] sm:text-[31px]">A Simple Loop for a Better Tomorrow</h2>
            <p className="mt-1.5 text-[15px] text-[var(--zolo-muted)]">Five easy steps turn your used packaging into real impact and real rewards.</p>
          </motion.div>

          <motion.ol variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="no-scrollbar mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-5 lg:gap-[26px] lg:overflow-visible lg:pb-0" aria-label="Recycling steps">
            {loopSteps.map(({ number, title, text, icon: Icon }, index) => (
              <motion.li key={title} variants={fadeUp} className="relative w-[78%] shrink-0 snap-start sm:w-[44%] lg:w-auto">
                <article className="h-full rounded-[12px] border border-[var(--zolo-border)] bg-white px-5 py-5 shadow-[0_6px_18px_rgba(15,23,42,0.05)] transition hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(15,23,42,0.09)]">
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[#e8f5ec] text-[var(--zolo-green)]"><Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden /></span>
                    <div>
                      <p className="font-display text-[20px] font-semibold leading-none text-[var(--zolo-green)]">{number}</p>
                      <h3 className="mt-1 text-[14px] font-extrabold leading-tight">{title}</h3>
                    </div>
                  </div>
                  <p className="mt-3.5 text-[14px] leading-[1.5] text-[#475569]">{text}</p>
                </article>
                {index < loopSteps.length - 1 && (
                  <ChevronRight className="absolute -right-[22px] top-1/2 z-10 hidden h-[22px] w-[22px] -translate-y-1/2 text-[var(--zolo-green)] lg:block" strokeWidth={3} aria-hidden />
                )}
              </motion.li>
            ))}
          </motion.ol>
          <LiveRates />
        </div>
      </section>

      {/* =====================================================
          IMPACT BAND (full-bleed)
      ====================================================== */}
      <section className="relative overflow-hidden bg-[var(--zolo-green-band)] py-6 text-white">
        <img src={heroScene} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-[0.16] saturate-0" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a3a22] via-[#0d4529]/95 to-[#0f5230]/85" aria-hidden />
        <Leaf className="pointer-events-none absolute -left-3 -top-4 h-24 w-24 rotate-12 text-[#4ade80]/25" strokeWidth={1.5} aria-hidden />
        <Leaf className="pointer-events-none absolute -bottom-6 left-[46%] h-16 w-16 -rotate-[30deg] text-[#a3e635]/20" strokeWidth={1.5} aria-hidden />
        <Leaf className="pointer-events-none absolute -bottom-5 right-[22%] h-20 w-20 rotate-[25deg] text-[#4ade80]/20" strokeWidth={1.5} aria-hidden />
        <div className="shell relative grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.15fr)_auto]">
          <div>
            <h2 className="font-display text-[24px] font-extrabold leading-tight">Our Impact So Far</h2>
            <p className="mt-1 text-[13px] text-[#d1fae5]/90">Together we&rsquo;re building a cleaner, greener planet.</p>
          </div>
          <ul className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:divide-x sm:divide-white/20" aria-label="Impact statistics">
            {stats.map(({ value, label, icon: Icon }) => (
              <li key={label} className="flex flex-col items-start gap-1 sm:px-4 sm:first:pl-0 xl:px-6">
                <Icon className="h-5 w-5 text-[#bef264]" strokeWidth={1.75} aria-hidden />
                <p className="font-display text-[26px] font-extrabold leading-none">{value}</p>
                <p className="text-[12px] text-[#d1fae5]/90">{label}</p>
              </li>
            ))}
          </ul>
          <a href="#actions" className={`${btnOrange} ${btnSm}`}>Be Part of the Change <ArrowRight className="h-4 w-4" aria-hidden /></a>
        </div>
      </section>

      {/* =====================================================
          MEMBERSHIP
      ====================================================== */}
      <section id="membership" className="py-8 lg:py-9">
        <div className="shell grid gap-7 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,3.2fr)] lg:gap-8">
          <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewportOnce}>
            <Eyebrow>Eco Rewards Membership</Eyebrow>
            <h2 className="mt-2 font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em] sm:text-[33px]">Grow Your Impact.<br />Unlock More.</h2>
            <p className="mt-3 text-[14px] leading-[1.55] text-[#475569]">Your contribution moves you through membership levels with better benefits.</p>
            <a href="#actions" className={`${btnOutlineOrange} ${btnSm} mt-6`}>Explore All Benefits <ArrowRight className="h-4 w-4" aria-hidden /></a>
            <EcoWalletMini />
          </motion.div>

          <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={viewportOnce} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3 xl:gap-4">
            {tiers.map((tier) => {
              const look = tierLook[tier.name] ?? tierLook["Green Member"];
              const Icon = look.icon;
              const lines = [`${tier.discount} off`, tier.support, ...tier.benefits];
              return (
                <motion.article key={tier.name} variants={fadeUp} className={`flex flex-col rounded-[14px] border p-5 text-center xl:p-6 shadow-[0_4px_14px_rgba(15,23,42,0.04)] transition hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(15,23,42,0.09)] ${look.card}`}>
                  <span className={`mx-auto flex h-[54px] w-[54px] items-center justify-center rounded-full ${look.circle}`}><Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden /></span>
                  <h3 className={`mt-3.5 font-display text-[17px] font-extrabold ${look.name}`}>{tier.name}</h3>
                  <p className="mt-1 text-[14px] font-bold text-[#334155]">{tier.points}</p>
                  <ul className="mt-4 space-y-[7px] text-left">
                    {lines.map((line) => (
                      <li key={line} className="flex items-start gap-2 text-[13.5px] leading-[1.35] text-[#1e293b]"><Check className="mt-[2px] h-[15px] w-[15px] shrink-0 text-[var(--zolo-green)]" strokeWidth={3} aria-hidden /> {line}</li>
                    ))}
                  </ul>
                </motion.article>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* =====================================================
          FINAL CTA (full-bleed photo band)
      ====================================================== */}
      <section className="relative overflow-hidden bg-[#0b3d24] text-white">
        <img src={ctaScene} alt="ZOLO Packaging product range — kraft, black and gift boxes on stone plinths" loading="lazy" className="absolute inset-0 h-full w-full object-cover object-center opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#052a19] via-[#0b3d24]/85 to-[#0b3d24]/35" aria-hidden />
        <div className="shell relative grid items-center gap-7 py-9 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:py-10">
          <div>
            <Eyebrow tone="orange">Better tomorrow starts today</Eyebrow>
            <h2 className="mt-2.5 font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em] sm:text-[34px]">
              Every action <span className="text-[var(--zolo-orange)]">counts.</span>
              <br />
              Every pack <span className="text-[var(--zolo-orange)]">matters.</span>
            </h2>
            <p className="mt-3 max-w-[460px] text-[14px] leading-[1.55] text-[#e2f5ea]">
              Choose better packaging, return what you can and get rewarded for building a more circular future.
            </p>
          </div>
          <div className="lg:justify-self-end">
            <ul className="grid grid-cols-2 gap-3 rounded-[12px] bg-white px-4 py-3.5 text-[var(--zolo-text)] shadow-[0_18px_40px_rgba(2,6,23,0.3)] sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-[var(--zolo-border)]" aria-label="Impact statistics">
              {stats.map(({ value, label, icon: Icon }) => (
                <li key={label} className="flex items-center gap-2.5 sm:px-4 sm:first:pl-1 sm:last:pr-1">
                  <Icon className="h-[22px] w-[22px] shrink-0 text-[var(--zolo-green)]" strokeWidth={1.75} aria-hidden />
                  <span><span className="block font-display text-[18px] font-extrabold leading-none">{value}</span><span className="mt-1 block text-[10.5px] text-[var(--zolo-muted)]">{label}</span></span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3 lg:justify-end">
              <button type="button" onClick={startRecycling} className={`${btnOrange} ${btnSm}`}>Start Recycling <ArrowRight className="h-4 w-4" aria-hidden /></button>
              <a href="#how-it-works" className={`btn ${btnSm} border border-white/60 bg-transparent text-white hover:bg-white/10 focus-visible:ring-white/70`}>Learn More</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
