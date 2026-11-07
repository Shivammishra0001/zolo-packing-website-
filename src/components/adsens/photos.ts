// ============================================================
// Photography for the AdSens page.
//
// Hosted on the Unsplash CDN under the Unsplash License, which permits
// commercial use without attribution. Each URL is pinned to a specific photo
// id and carries explicit crop parameters, so a card's framing never changes
// under us.
//
// Every photo here was reviewed before being used, against three rules:
//
//   1. NO IDENTIFIABLE FACES. A portrait beside an invented testimonial, or
//      on a card claiming client work, reads as a real person endorsing
//      Zolo. Hands, backs and out-of-focus figures are fine.
//      (photo 1596526131083 was wired in and then removed for exactly this:
//      it shows Apple Mail beside a BBC News tile.)
//   2. NO THIRD-PARTY BRANDS. A Netflix, BBC, Adobe or Amazon logo on a card
//      titled "TechSprint SaaS Growth" implies a relationship that does not
//      exist. (Several otherwise-good candidates were rejected for this.)
//      The one exception is the social-media service tile, where platform
//      icons ARE the subject and assert nothing about Zolo.
//   3. RELEVANT, NOT DECORATIVE. The photo has to show the work the card
//      describes — a dashboard for analytics, swatches for branding.
//
// `alt` describes what is in the photograph, never a result or a claim.
// ============================================================

/** Shared transform: crop to the card's ratio, modest quality, WebP-capable. */
const SRC = (id: string, w = 800, h = 600) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=75&auto=format`;

export interface Photo {
  src: string;
  /** Wider source for 2x displays. */
  srcSet: string;
  alt: string;
}

const photo = (id: string, alt: string, w = 800, h = 600): Photo => ({
  src: SRC(id, w, h),
  srcSet: `${SRC(id, w, h)} 1x, ${SRC(id, w * 2, h * 2)} 2x`,
  alt,
});

/* ---------------------------------------------------------- campaigns
   Ad creatives. The reference shows the creative a campaign is running. */

export const CAMPAIGN_PHOTO = {
  // META / StyleHaus — Spring Collection: a retail storefront.
  stylehaus: photo("1472851294608-062f824d29cc", "An OPEN sign hanging in a shop window"),
  // GOOGLE / GreenLeaf — Organic Growth: a search-analytics dashboard.
  greenleaf: photo("1460925895917-afdab827c52f", "A laptop displaying a web analytics dashboard"),
  // LINKEDIN / TechSprint — SaaS Playbook: a performance dashboard.
  techsprint: photo("1551288049-bebda4e38f71", "A screen showing campaign performance charts"),
  // EMAIL / FitZone — VIP Retention: a mobile creative being reviewed.
  fitzone: photo("1545235617-9465d2a55698", "A phone showing a mobile ad creative beside a laptop"),
} as const;

/* ---------------------------------------------------------- portfolio
   Case-study tiles. The reference uses workplace and dashboard photography. */

export const PORTFOLIO_PHOTO = {
  "techsprint-saas-growth": photo("1591696205602-2f950c417cb9", "A rising performance graph on a laptop screen"),
  "greenleaf-ecommerce": photo("1563013544-824ae1b704d3", "Online shopping on a laptop, card in hand"),
  "stylehaus-brand-launch": photo("1572044162444-ad60f128bdea", "A designer working with colour swatches and a drawing tablet"),
  "fitzone-retention": photo("1486312338219-ce68d2c6f44d", "Hands typing on a laptop at a desk"),
  "cloudnine-b2b-leads": photo("1460925895917-afdab827c52f", "A laptop displaying a web analytics dashboard"),
  "eduvate-content-engine": photo("1533750349088-cd871a92f312", "A desk flat-lay with a note reading Marketing Strategy"),
} as const;

/* ---------------------------------------------------------- services
   One photo per service card, showing that discipline's actual work. */

export const SERVICE_PHOTO = {
  seo: photo("1557838923-2985c318be48", "Letter tiles spelling DIGITAL MARKETING", 400, 300),
  ppc: photo("1526628953301-3e589a6a8b74", "A screen showing click-through and conversion metrics", 400, 300),
  social: photo("1611926653458-09294b3142bf", "A phone showing a folder of social media apps", 400, 300),
  content: photo("1533750349088-cd871a92f312", "A desk flat-lay with a note reading Marketing Strategy", 400, 300),
  email: photo("1486312338219-ce68d2c6f44d", "Hands typing on a laptop at a desk", 400, 300),
  analytics: photo("1460925895917-afdab827c52f", "A laptop displaying a web analytics dashboard", 400, 300),
  branding: photo("1572044162444-ad60f128bdea", "A designer working with colour swatches and a drawing tablet", 400, 300),
  web: photo("1586717791821-3f44a563fa4c", "A tablet showing a wireframe layout being sketched", 400, 300),
} as const;

/* ---------------------------------------------------------- insights */

export const ARTICLE_PHOTO = {
  "meta-ads": photo("1543286386-713bdd548da4", "A hand-drawn growth chart on graph paper"),
  "seo-2025": photo("1557838923-2985c318be48", "Letter tiles spelling DIGITAL MARKETING"),
  "content-engine": photo("1533750349088-cd871a92f312", "A desk flat-lay with a note reading Marketing Strategy"),
} as const;

/* ---------------------------------------------------------- hero */

export const HERO_PHOTO = photo(
  "1460925895917-afdab827c52f",
  "A laptop displaying a web analytics dashboard",
  900, 675,
);
