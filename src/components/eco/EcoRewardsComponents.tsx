import type { ReactNode } from "react";
import step1 from "../../../images/step-1.png";
import step2 from "../../../images/step-2.png";
import step3 from "../../../images/step-3.png";
import step4 from "../../../images/step-4.png";
import step5 from "../../../images/step-5.png";

/** Step illustrations for the recycling process, in step order. */
const recyclingStepImages = [step1, step2, step3, step4, step5];
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Award,
  ArrowRight,
  BadgeCheck,
  Boxes,
  CheckCircle2,
  Crown,
  Gift,
  Leaf,
  Medal,
  PackageCheck,
  Recycle,
  ShieldCheck,
  Sparkles,
  Star,
  TicketPercent,
  TreePine,
  Truck,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { Button, SectionHeader } from "../UI";

type IconType = typeof Leaf;

export const ecoStats = [
  { label: "Trees Saved", value: "12,480", icon: TreePine, note: "Across customer orders" },
  { label: "Plastic Reduced", value: "38.6t", icon: Recycle, note: "Single-use plastic avoided" },
  { label: "Carbon Saved", value: "92t", icon: Leaf, note: "Estimated CO2e reduction" },
  { label: "Boxes Recycled", value: "184k", icon: Boxes, note: "Returned to circular use" },
  { label: "Customer Contribution", value: "21k", icon: Users, note: "Eco actions completed" },
  { label: "Reward Points Earned", value: "8.4M", icon: Award, note: "Issued to customers" },
];

export const customerImpact = [
  { label: "Your Trees Saved", value: "28", icon: TreePine, note: "Through verified orders" },
  { label: "Your Carbon Reduction", value: "142kg", icon: Leaf, note: "From low carbon materials" },
  { label: "Recycling History", value: "16 returns", icon: Recycle, note: "Packaging pickups completed" },
  { label: "Sustainable Purchases", value: "34", icon: PackageCheck, note: "Eco product orders" },
  { label: "Reward Progress", value: "72%", icon: Award, note: "Toward Eco Platinum" },
  { label: "Eco Badge Collection", value: "9", icon: BadgeCheck, note: "Unlocked sustainability badges" },
];

export const wallet = {
  current: 4850,
  earned: 12800,
  redeemed: 7950,
  tier: "Eco Gold",
  nextTier: "Eco Platinum",
  nextTierPoints: 15000,
  progress: 72,
  impact: "142 kg carbon saved",
};

export const earnRules = [
  { title: "Buy Eco Product", points: 100, icon: Leaf },
  { title: "Upload Packaging for Recycling", points: 250, icon: Recycle },
  { title: "Return Used Packaging", points: 200, icon: PackageCheck },
  { title: "Refer Friend", points: 300, icon: Users },
  { title: "Monthly Eco Challenge", points: 500, icon: Sparkles },
  { title: "Bulk Sustainable Orders", points: 1000, icon: Boxes },
  { title: "Complete Profile", points: 50, icon: BadgeCheck },
  { title: "First Order", points: 100, icon: Gift },
];

export const rewards = [
  { title: "Shopping Discount", points: 1200, value: "₹500 off", icon: TicketPercent },
  { title: "Free Shipping", points: 800, value: "Next order", icon: Truck },
  { title: "Premium Packaging Upgrade", points: 2200, value: "Matte finish", icon: Sparkles },
  { title: "Gift Voucher", points: 3000, value: "Partner perks", icon: Gift },
  { title: "Free Samples", points: 1500, value: "Eco sample kit", icon: PackageCheck },
  { title: "Special Offers", points: 1800, value: "Private deals", icon: Star },
  { title: "Priority Production", points: 4200, value: "Fast lane", icon: Zap },
  { title: "VIP Membership", points: 7000, value: "90 days", icon: Crown },
];

export const tiers = [
  { name: "Green Member", points: "0 pts", discount: "2%", support: "Standard", icon: Leaf, benefits: ["Eco wallet", "Monthly missions", "Basic coupons"] },
  { name: "Eco Silver", points: "2,500 pts", discount: "5%", support: "Priority queue", icon: Medal, benefits: ["Free pickup credits", "Silver badges", "Early campaigns"] },
  { name: "Eco Gold", points: "7,500 pts", discount: "8%", support: "Priority support", icon: Award, benefits: ["Reward multipliers", "Premium coupons", "Sample access"] },
  { name: "Eco Platinum", points: "15,000 pts", discount: "12%", support: "VIP desk", icon: Crown, benefits: ["Priority production", "Exclusive offers", "Sustainability reports"] },
];

export const pointHistory = [
  { date: "28 Jul 2026", activity: "Returned kraft mailers", earned: 200, redeemed: 0, balance: 4850 },
  { date: "21 Jul 2026", activity: "Redeemed free shipping", earned: 0, redeemed: 800, balance: 4650 },
  { date: "17 Jul 2026", activity: "Bulk sustainable order", earned: 1000, redeemed: 0, balance: 5450 },
  { date: "08 Jul 2026", activity: "Monthly eco challenge", earned: 500, redeemed: 0, balance: 4450 },
  { date: "30 Jun 2026", activity: "Recycling upload approved", earned: 250, redeemed: 0, balance: 3950 },
];

export const coupons = [
  { code: "ECO500", title: "₹500 Sustainable Order Discount", expires: "31 Aug 2026", points: 1200 },
  { code: "SHIPGREEN", title: "Free shipping on eco products", expires: "15 Aug 2026", points: 800 },
  { code: "SAMPLEKIT", title: "Compostable sample pack", expires: "30 Sep 2026", points: 1500 },
];

export const sustainableProducts = [
  "Biodegradable",
  "Compostable",
  "Reusable",
  "Recyclable",
  "Plastic Free",
  "FSC Certified",
  "Water Based Ink",
  "Low Carbon Products",
];

export const recyclingSteps = [
  { title: "Collect Used Packaging", desc: "Keep clean kraft, corrugated, reusable, and recyclable packs aside.", icon: Boxes },
  { title: "Schedule Pickup", desc: "Choose a convenient pickup slot from your customer dashboard.", icon: Truck },
  { title: "Inspection", desc: "Our team verifies material condition and recycling eligibility.", icon: ShieldCheck },
  { title: "Recycling", desc: "Approved packaging moves into responsible recovery streams.", icon: Recycle },
  { title: "Reward Points Added", desc: "Points land in your reward wallet after verification.", icon: WalletCards },
];

export const achievements = [
  { title: "Referral Rewards", desc: "Invite brands and earn 300 points after their first order.", icon: Users },
  { title: "Monthly Eco Challenges", desc: "Complete sustainable actions for high-value bonus points.", icon: Sparkles },
  { title: "Leaderboard", desc: "See top contributors across recycling and eco purchases.", icon: Medal },
  { title: "Achievements", desc: "Unlock milestones for returns, referrals, and product choices.", icon: Award },
  { title: "Badges", desc: "Collect visible eco badges as your impact grows.", icon: BadgeCheck },
  { title: "Seasonal Campaigns", desc: "Limited campaigns reward focused climate actions.", icon: Leaf },
  { title: "Limited Offers", desc: "Redeem time-boxed discounts and sample kits.", icon: TicketPercent },
  { title: "Eco Missions", desc: "Follow guided missions that build greener habits.", icon: CheckCircle2 },
];

const cardSurface = "bg-white dark:bg-dark-900 border border-dark-100 dark:border-dark-800 card-shadow";
const titleText = "text-dark-900 dark:text-white";
const bodyText = "text-dark-500 dark:text-dark-300";
const mutedText = "text-dark-400 dark:text-dark-500";
const iconSurface = "bg-primary-50 dark:bg-primary-500/10";
const insetSurface = "bg-dark-50 dark:bg-dark-800 border border-dark-100 dark:border-dark-700";

export function StatisticCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: IconType }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`${cardSurface} rounded-2xl p-5`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`h-10 w-10 rounded-xl ${iconSurface} flex items-center justify-center`}>
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
        <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${mutedText}`}>Impact</span>
      </div>
      <div className={`font-display text-3xl font-extrabold ${titleText} mt-4`}>{value}</div>
      <div className={`font-semibold text-sm ${titleText} mt-1`}>{label}</div>
      <p className={`text-xs ${bodyText} mt-1.5 leading-relaxed`}>{note}</p>
    </motion.div>
  );
}

export function ImpactCard(props: { label: string; value: string; note: string; icon: IconType }) {
  return <StatisticCard {...props} />;
}

export function ProgressCircle({ value, label }: { value: number; label: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" role="img" aria-label={`${label}: ${value}%`}>
        <circle cx="56" cy="56" r={radius} fill="none" stroke="rgba(226,232,240,0.9)" strokeWidth="10" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="#f97316"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (value / 100) * circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-display text-2xl font-extrabold ${titleText}`}>{value}%</span>
        <span className={`text-[10px] uppercase tracking-wider ${bodyText}`}>{label}</span>
      </div>
    </div>
  );
}

export function RewardWallet() {
  return (
    <div className="bg-gradient-to-br from-dark-950 via-dark-900 to-dark-800 rounded-3xl p-6 text-white relative overflow-hidden card-shadow-lg">
      <div className="absolute inset-0 grid-bg-light opacity-10" />
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary-500/20 blur-3xl" />
      <div className="relative flex flex-col lg:flex-row gap-6 lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10 px-3 py-1 text-xs font-bold text-primary-200">
            <WalletCards className="h-3.5 w-3.5" /> Reward Wallet
          </div>
          <div className="font-display text-5xl font-extrabold mt-4">{wallet.current.toLocaleString("en-IN")}</div>
          <div className="text-sm text-dark-300 mt-1">Current reward points</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ["Total Earned", wallet.earned.toLocaleString("en-IN")],
            ["Redeemed", wallet.redeemed.toLocaleString("en-IN")],
            ["Tier", wallet.tier],
            ["Impact", wallet.impact],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-white/10 border border-white/10 p-4 min-w-[130px]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-dark-400">{label}</div>
              <div className="font-display font-bold text-lg mt-1">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RewardCard({ title, points, value, icon: Icon }: { title: string; points: number; value: string; icon: IconType }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`group ${cardSurface} rounded-2xl card-shadow-hover p-5`}
    >
      <div className={`h-11 w-11 rounded-xl ${iconSurface} flex items-center justify-center group-hover:bg-primary-500 transition-colors`}>
        <Icon className="h-5 w-5 text-primary-600 group-hover:text-white transition-colors" />
      </div>
      <h3 className={`font-display font-bold ${titleText} mt-4`}>{title}</h3>
      <p className={`text-sm ${bodyText} mt-1`}>{value}</p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-primary-600">{points.toLocaleString("en-IN")} pts</span>
        <Button size="sm" variant="outline">Redeem</Button>
      </div>
    </motion.div>
  );
}

export function TierCard({ tier }: { tier: (typeof tiers)[number] }) {
  const Icon = tier.icon;
  return (
    <div className={`${cardSurface} rounded-2xl p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`h-11 w-11 rounded-xl ${iconSurface} flex items-center justify-center`}>
            <Icon className="h-5 w-5 text-primary-600" />
          </div>
          <h3 className={`font-display text-lg font-bold mt-4 ${titleText}`}>{tier.name}</h3>
          <p className={`text-xs ${bodyText} mt-1`}>Required Points: {tier.points}</p>
        </div>
        <span className="rounded-full bg-dark-900 px-3 py-1 text-xs font-bold text-white">{tier.discount} off</span>
      </div>
      <div className={`mt-4 text-sm ${bodyText}`}>Priority Support: <span className={`font-semibold ${titleText}`}>{tier.support}</span></div>
      <ul className="mt-4 space-y-2">
        {tier.benefits.map((benefit) => (
          <li key={benefit} className={`flex items-center gap-2 text-sm ${bodyText}`}>
            <CheckCircle2 className="h-4 w-4 text-primary-600" /> {benefit}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CouponCard({ title, code, expires, points }: { title: string; code: string; expires: string; points: number }) {
  return (
    <div className="rounded-2xl border border-dashed border-primary-300 dark:border-primary-500/40 bg-primary-50/70 dark:bg-primary-500/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`font-display font-bold ${titleText}`}>{title}</div>
          <div className={`text-xs ${bodyText} mt-1`}>Expires {expires}</div>
        </div>
        <TicketPercent className="h-5 w-5 text-primary-600" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <code className="rounded-lg bg-white dark:bg-dark-950 border border-primary-200 dark:border-primary-500/30 px-3 py-1.5 text-xs font-bold text-primary-700 dark:text-primary-300">{code}</code>
        <span className={`text-xs font-semibold ${bodyText}`}>{points} pts</span>
      </div>
    </div>
  );
}

export function Timeline() {
  return (
    <div className={`${cardSurface} rounded-2xl p-5`}>
      <h3 className={`font-display text-lg font-bold ${titleText} mb-5`}>Point History</h3>
      <div className="space-y-4">
        {pointHistory.map((item) => (
          <div key={`${item.date}-${item.activity}`} className="grid gap-3 sm:grid-cols-[120px_1fr_auto] sm:items-center relative">
            <div className={`text-xs font-semibold ${bodyText}`}>{item.date}</div>
            <div className="flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary-500 ring-4 ring-primary-100 dark:ring-primary-500/20" />
              <div>
                <div className={`text-sm font-semibold ${titleText}`}>{item.activity}</div>
                <div className={`text-xs ${bodyText} mt-1`}>
                  Earned +{item.earned} · Redeemed -{item.redeemed} · Balance {item.balance.toLocaleString("en-IN")}
                </div>
              </div>
            </div>
            <div className="text-sm font-bold text-primary-600 sm:text-right">
              {item.earned ? `+${item.earned}` : `-${item.redeemed}`} pts
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Badge({ children, icon: Icon = Leaf }: { children: ReactNode; icon?: IconType }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border border-dark-200 dark:border-dark-700 bg-white dark:bg-dark-900 px-3 py-1.5 text-xs font-bold ${titleText}`}>
      <Icon className="h-3.5 w-3.5 text-primary-600" /> {children}
    </span>
  );
}

export function AchievementCard({ title, desc, icon: Icon }: { title: string; desc: string; icon: IconType }) {
  return (
    <div className={`${cardSurface} rounded-2xl p-5`}>
      <div className={`h-10 w-10 rounded-xl ${insetSurface} flex items-center justify-center`}>
        <Icon className="h-5 w-5 text-primary-600" />
      </div>
      <div className={`font-display font-bold ${titleText} mt-4`}>{title}</div>
      <p className={`text-sm ${bodyText} mt-1.5 leading-relaxed`}>{desc}</p>
    </div>
  );
}

export function ImpactDashboard({ personal = false }: { personal?: boolean }) {
  const stats = personal ? customerImpact : ecoStats;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map((stat) => <ImpactCard key={stat.label} {...stat} />)}
    </div>
  );
}

export function EcoRewardDashboard() {
  return (
    <div className="space-y-6">
      <RewardWallet />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total Points Earned", value: wallet.earned.toLocaleString("en-IN"), icon: Award, note: "Lifetime rewards" },
            { label: "Points Redeemed", value: wallet.redeemed.toLocaleString("en-IN"), icon: Gift, note: "Used for perks" },
            { label: "Current Tier", value: wallet.tier, icon: Crown, note: "8% order discount" },
          ].map((stat) => <StatisticCard key={stat.label} {...stat} />)}
        </div>
        <div className={`${cardSurface} rounded-2xl p-5 flex items-center gap-5`}>
          <ProgressCircle value={wallet.progress} label="Progress" />
          <div>
            <div className={`font-display font-bold ${titleText}`}>Reward Progress</div>
            <p className={`text-sm ${bodyText} mt-1`}>Earn {wallet.nextTierPoints - wallet.current} more points to reach {wallet.nextTier}.</p>
          </div>
        </div>
      </div>
      <ImpactDashboard personal />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Timeline />
        <div className="space-y-3">
          {coupons.map((coupon) => <CouponCard key={coupon.code} {...coupon} />)}
        </div>
      </div>
    </div>
  );
}

export function EarnPointsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {earnRules.map((rule) => (
        <div key={rule.title} className={`${cardSurface} rounded-2xl p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div className={`h-10 w-10 rounded-xl ${iconSurface} flex items-center justify-center`}>
              <rule.icon className="h-5 w-5 text-primary-600" />
            </div>
            <span className="font-display text-lg font-extrabold text-primary-600">+{rule.points}</span>
          </div>
          <div className={`font-semibold ${titleText} mt-4`}>{rule.title}</div>
          <div className={`text-xs ${bodyText} mt-1`}>Points added after verification</div>
        </div>
      ))}
    </div>
  );
}

export function RewardStoreGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {rewards.map((reward) => <RewardCard key={reward.title} {...reward} />)}
    </div>
  );
}

export function TierGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {tiers.map((tier) => <TierCard key={tier.name} tier={tier} />)}
    </div>
  );
}

export function SustainabilityIntro() {
  const pillars = [
    "Our Mission",
    "Environmental Commitment",
    "Sustainable Materials",
    "Green Manufacturing",
    "Carbon Reduction",
    "Circular Economy",
    "Eco Certifications",
    "Future Goals",
  ];
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      {pillars.map((pillar, index) => (
        <div key={pillar} className={`${cardSurface} rounded-2xl p-5`}>
          <div className="font-display text-3xl font-extrabold grad-text">{String(index + 1).padStart(2, "0")}</div>
          <h3 className={`font-display font-bold ${titleText} mt-3`}>{pillar}</h3>
          <p className={`text-sm ${bodyText} mt-2 leading-relaxed`}>
            Practical packaging choices that reduce waste while keeping products protected and premium.
          </p>
        </div>
      ))}
    </div>
  );
}

export function SustainableProductGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {sustainableProducts.map((product) => (
        <div key={product} className={`group ${cardSurface} rounded-2xl p-5 overflow-hidden`}>
          <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-primary-50 via-white to-dark-50 dark:from-primary-500/10 dark:via-dark-900 dark:to-dark-800 border border-dark-100 dark:border-dark-800 flex items-center justify-center">
            <Leaf className="h-12 w-12 text-primary-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className={`font-display font-bold ${titleText} mt-4`}>{product}</div>
          <p className={`text-sm ${bodyText} mt-1.5`}>Premium materials selected for lower impact production.</p>
        </div>
      ))}
    </div>
  );
}

export function RecyclingProcess() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {recyclingSteps.map((step, index) => (
        <div key={step.title} className={`relative ${cardSurface} rounded-2xl p-5`}>
          {index < recyclingSteps.length - 1 && (
            <div className="hidden lg:flex absolute -right-5 top-1/2 z-10 h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white dark:bg-dark-900 border border-dark-100 dark:border-dark-800 shadow-sm">
              <ArrowRight className="h-4 w-4 text-primary-600" />
            </div>
          )}
          <div className={`aspect-square rounded-2xl ${insetSurface} flex items-center justify-center mb-5 overflow-hidden`}>
            <img
              src={recyclingStepImages[index]}
              alt={step.title}
              loading="lazy"
              className="h-full w-full object-contain p-3"
            />
          </div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary-600">Step {index + 1}</div>
          <h3 className={`font-display font-bold ${titleText} mt-2`}>{step.title}</h3>
          <p className={`text-sm ${bodyText} mt-2 leading-relaxed`}>{step.desc}</p>
        </div>
      ))}
    </div>
  );
}

export function MarketingFeatures() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {achievements.map((item) => <AchievementCard key={item.title} {...item} />)}
    </div>
  );
}

export function EcoLandingSection() {
  return (
    <section className="py-20 bg-dark-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 grid-bg-light opacity-15" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-400/50 to-transparent" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-1.5 text-xs font-bold text-primary-200 mb-6">
              <Leaf className="h-3.5 w-3.5" /> Zolo Eco Rewards
            </div>
            <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05]">
              Every Order Makes a Difference
            </h2>
            <p className="mt-5 text-lg text-dark-300 max-w-2xl">
              Earn Eco Rewards while helping create a sustainable future.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/products?search=eco" className="inline-flex items-center gap-2 rounded-full bg-primary-500 px-6 py-3 text-sm font-bold text-white hover:bg-primary-600 transition-colors">
                Explore Eco Products
              </Link>
              <Link to="/sustainability#recycling" className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-6 py-3 text-sm font-bold text-white hover:bg-white/15 transition-colors">
                Learn About Recycling
              </Link>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 max-w-2xl">
              {[
                { title: "Eco Rewards", desc: "Wallet, tiers, coupons, activities, and badges.", to: "/eco-rewards", icon: Award },
                { title: "Sustainability", desc: "Materials, recycling, impact, and future goals.", to: "/sustainability", icon: Recycle },
              ].map((item) => (
                <Link
                  key={item.title}
                  to={item.to}
                  className="group rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur transition-colors hover:bg-white/15"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
                      <item.icon className="h-5 w-5 text-primary-300" />
                    </span>
                    <span>
                      <span className="block font-display font-bold text-white">{item.title}</span>
                      <span className="block text-xs text-dark-300 mt-0.5">{item.desc}</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <RewardWallet />
          </div>
        </div>
      </div>
    </section>
  );
}

export function PageShell({ eyebrow, title, subtitle, children }: { eyebrow: string; title: ReactNode; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="bg-white dark:bg-dark-950">
      <section className="py-16 sm:py-20 bg-dark-50 dark:bg-dark-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} align="center" />
        </div>
      </section>
      {children}
    </main>
  );
}
