// ============================================================
// AdSens page content.
//
// SAMPLE CONTENT. Every figure, client name, testimonial and article on this
// page is placeholder copy reproduced verbatim from the supplied reference
// design — it is not Zolo's own performance data and describes no real
// engagement. It lives in this one module, apart from the components, so the
// whole page can be repointed at real content by editing this file alone.
//
// Imagery: every card draws its own artwork (see CardArt.tsx) — a client
// monogram over a packaging silhouette, tinted by category. The repo's
// packaging photographs are unbranded mockups printed with "YOUR LOGO HERE",
// which on a card claiming finished client work contradicts the claim.
// ============================================================


/* ---------------------------------------------------------- hero */

import type { ArtShape } from "./CardArt";
import type { ARTICLE_PHOTO, CAMPAIGN_PHOTO } from "./photos";

export const HERO_STATS = [
  { value: "250+", label: "Clients Served" },
  { value: "3.2x", label: "ROI Multiplier" },
  { value: "15+", label: "Years Experience" },
  { value: "98%", label: "Client Satisfaction" },
] as const;

/** The hero's live-ad panel, as specified in the reference. */
export const HERO_AD = {
  rail: "LIVE RUNNING ADS",
  source: "GOOGLE ADS",
  sponsored: "SPONSORED",
  brand: "GreenLeaf",
  campaign: "Organic Growth Boost - Click to expand",
  rows: [
    { label: "Efficiency Metric", value: "#1 Ranking" },
    { label: "Volume generated", value: "89K Visits" },
    { label: "Estimated ROAS", value: "3.8x ROAS" },
  ],
} as const;

/* ---------------------------------------------------------- services */

export type ServiceKey =
  | "seo" | "ppc" | "social" | "content" | "email" | "analytics" | "branding" | "web";

export interface Service {
  key: ServiceKey;
  name: string;
  body: string;
}

export const SERVICES: Service[] = [
  { key: "seo", name: "SEO", body: "Dominate search rankings with technical SEO, content strategy, and link building that drives organic traffic." },
  { key: "ppc", name: "PPC", body: "Maximize ROI with data-driven paid campaigns across Google, Meta, LinkedIn, and TikTok." },
  { key: "social", name: "Social Media", body: "Build engaged communities and drive conversions through strategic social media management." },
  { key: "content", name: "Content Marketing", body: "Create compelling content that attracts, educates, and converts your ideal customers." },
  { key: "email", name: "Email Marketing", body: "Nurture leads and boost retention with automated email flows that drive revenue." },
  { key: "analytics", name: "Analytics", body: "Transform raw data into actionable insights with advanced analytics and reporting." },
  { key: "branding", name: "Branding", body: "Build a memorable brand identity that resonates with your target audience." },
  { key: "web", name: "Web Development", body: "Create high-converting websites optimized for performance and user experience." },
];

/* ---------------------------------------------------------- campaigns */

export type Platform = "META" | "GOOGLE" | "LINKEDIN" | "EMAIL";

export interface Campaign {
  platform: Platform;
  brand: string;
  title: string;
  status: "LIVE";
  metrics: [string, string];
  /** Client initials, kept as the fallback mark if the photo fails. */
  monogram: string;
  shape: ArtShape;
  /** Which palette the artwork uses. */
  tint: string;
  /** Key into CAMPAIGN_PHOTO. */
  photo: keyof typeof CAMPAIGN_PHOTO;
}

export const CAMPAIGNS: Campaign[] = [
  {
    platform: "META", brand: "StyleHaus", title: "Spring Collection 2025", status: "LIVE",
    metrics: ["12.4K Clicks", "4.8% Engagement"],
    monogram: "SH", shape: "bag", tint: "Social",
    photo: "stylehaus",
  },
  {
    platform: "GOOGLE", brand: "GreenLeaf", title: "Organic Growth Boost", status: "LIVE",
    metrics: ["#1 Ranking", "89K Visits"],
    monogram: "GL", shape: "mailer", tint: "SEO",
    photo: "greenleaf",
  },
  {
    platform: "LINKEDIN", brand: "TechSprint", title: "SaaS Scale Playbook", status: "LIVE",
    metrics: ["28% CVR", "1,800 Leads"],
    monogram: "TS", shape: "box", tint: "PPC",
    photo: "techsprint",
  },
  {
    platform: "EMAIL", brand: "FitZone", title: "VIP Retention Series", status: "LIVE",
    metrics: ["45% Open", "18K Emails"],
    monogram: "FZ", shape: "envelope", tint: "Email",
    photo: "fitzone",
  },
];

/** Brand colours of each ad platform, used only for the small platform chip. */
export const PLATFORM_TINT: Record<Platform, string> = {
  META: "#0C63D4",   // Meta blue, darkened: white on #1877F2 is 4.23:1 (fails AA)
  GOOGLE: "#1A73E8",
  LINKEDIN: "#0A66C2",
  EMAIL: "#7C3AED",
};

/* ---------------------------------------------------------- portfolio */

export const PORTFOLIO_FILTERS = ["All", "PPC", "SEO", "Branding", "Email", "Content"] as const;
export type PortfolioFilter = (typeof PORTFOLIO_FILTERS)[number];

export interface CaseStudy {
  slug: string;
  category: Exclude<PortfolioFilter, "All">;
  client: string;
  title: string;
  body: string;
  monogram: string;
  shape: ArtShape;
}

export const PORTFOLIO: CaseStudy[] = [
  {
    slug: "techsprint-saas-growth", category: "PPC", client: "TechSprint Inc.",
    title: "TechSprint SaaS Growth",
    body: "Scaled paid campaigns across 6 international markets with optimized audience targeting and creative testing.",
    monogram: "TS", shape: "box",
  },
  {
    slug: "greenleaf-ecommerce", category: "SEO", client: "GreenLeaf Co.",
    title: "GreenLeaf E-commerce",
    body: "Built topical authority and achieved top rankings for 150+ high-intent keywords.",
    monogram: "GL", shape: "mailer",
  },
  {
    slug: "stylehaus-brand-launch", category: "Branding", client: "StyleHaus",
    title: "StyleHaus Brand Launch",
    body: "Complete brand identity creation and multi-channel launch campaign that drove massive awareness.",
    monogram: "SH", shape: "carton",
  },
  {
    slug: "fitzone-retention", category: "Email", client: "FitZone",
    title: "FitZone Retention",
    body: "Built 5 automated email flows including welcome, abandoned cart, and post-purchase nurturing.",
    monogram: "FZ", shape: "envelope",
  },
  {
    slug: "cloudnine-b2b-leads", category: "PPC", client: "CloudNine",
    title: "CloudNine B2B Leads",
    body: "LinkedIn and Google Ads strategy targeting enterprise decision-makers for SaaS lead generation.",
    monogram: "CN", shape: "jar",
  },
  {
    slug: "eduvate-content-engine", category: "Content", client: "EduVate",
    title: "EduVate Content Engine",
    body: "Built a scalable content engine with pillar pages and topic clusters generating 50+ qualified leads monthly.",
    monogram: "EV", shape: "pouch",
  },
];

/* ---------------------------------------------------------- testimonials */

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote: "AdSense transformed our digital presence. Our conversions tripled within the first quarter. Their data-driven approach is unmatched.",
    name: "Sarah Chen", role: "CMO, TechSprint",
  },
  {
    quote: "We went from page 5 to page 1 for our top keywords. The organic traffic growth has been a game-changer for our business.",
    name: "Mike Rodriguez", role: "Founder, GreenLeaf",
  },
  {
    quote: "The brand identity they created perfectly captures our vision. Our launch campaign exceeded all expectations.",
    name: "Emma Thompson", role: "VP Marketing, StyleHaus",
  },
];

/* ---------------------------------------------------------- insights */

export interface Article {
  category: string;
  date: string;
  readingTime: string;
  title: string;
  body: string;
  /** An article's artwork is keyed by category, so it needs no monogram. */
  shape: ArtShape;
  photo: keyof typeof ARTICLE_PHOTO;
}

export const ARTICLES: Article[] = [
  {
    category: "PPC", date: "Dec 5, 2024", readingTime: "8 min read",
    title: "How to Scale Your Meta Ads Without Hurting Performance",
    body: "Learn proven strategies to grow your campaigns while maintaining healthy returns.",
    shape: "box",
    photo: "meta-ads",
  },
  {
    category: "SEO", date: "Dec 2, 2024", readingTime: "10 min read",
    title: "SEO in 2025: What Actually Moves the Needle",
    body: "Forget outdated tactics. Here's what's working this year based on real data.",
    shape: "cup",
    photo: "seo-2025",
  },
  {
    category: "Content", date: "Nov 28, 2024", readingTime: "7 min read",
    title: "Building a Content Engine That Converts",
    body: "How we built a content system generating 50+ qualified leads per month.",
    shape: "carton",
    photo: "content-engine",
  },
];

/* ---------------------------------------------------------- footer */

export const FOOTER = {
  blurb:
    "A performance marketing agency based in New Delhi, India. We specialize in SEO, PPC, social media, branding, and web development. We deliver measurable growth through data-driven strategies.",
  services: ["SEO", "PPC", "Social Media", "Content Marketing", "Email Marketing", "Web Development"],
  company: ["About", "Portfolio", "Blog", "Careers", "Contact"],
  legal: ["Privacy Policy", "Terms of Service", "Cookie Policy"],
} as const;
