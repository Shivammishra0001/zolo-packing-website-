# Handoff Spec: AdSens by Zolo — `/adsens`

**Audience:** the engineer implementing the attached mockup against the existing codebase.
**Status:** the page is **built and pushed** (`d219669`). This spec therefore documents what exists AND the deltas between the current build and the mockup, so you know which parts are implementation work and which are already done.

**Stack:** React 19 · Vite 7 · TypeScript · Tailwind v4 (CSS-first `@theme`) · framer-motion + GSAP · Express 5 + Prisma 6 + PostgreSQL 16.

---

## 1. Overview

A marketing landing page for AdSens, Zolo's digital-marketing business unit. It has two jobs: explain what AdSens sells, and capture consultation leads into the existing CRM pipeline.

The page sits inside the normal Zolo shell (global header, announcement bar, footer, WhatsApp FAB). Only the content between them belongs to this spec.

**Route:** `/adsens` — registered in `src/App.tsx`, no params, no auth.
**Page component:** `src/pages/AdSens.tsx` (135 lines, pure composition).
**Sections:** `src/components/adsens/*.tsx`.

---

## 2. Section order

Nine sections, in this order. This matches the mockup exactly.

| # | Section | Component | Content source |
|---|---|---|---|
| 1 | Hero | `DarkHero.tsx` | Authored + published campaigns |
| 2 | Services Overview | `ServicesOverview.tsx` | `MarketingService` table |
| 3 | Active Campaigns | `ActiveCampaigns.tsx` | `MarketingCampaign` table |
| 4 | Our Portfolio | `Portfolio.tsx` | `MarketingCaseStudy` table |
| 5 | Our Approach | `Approach.tsx` | Authored (hardcoded, 4 steps) |
| 6 | Why Choose AdSens | `WhyAdSens.tsx` | Authored (hardcoded, 7 reasons) |
| 7 | Zolo + AdSens | `PackagingPromotion.tsx` | Authored |
| 8 | Consultation CTA | `ConsultationCta.tsx` | Opens `ConsultationModal` |
| 9 | FAQ | `Faq.tsx` | Authored (hardcoded, 8 Q&A) |

**Three dark bands** (`#0B1220`) alternate with six light sections, per the approved design: **Hero**, **Active Campaigns** and **Zolo Advantage**. The band is a local surface on those three sections, *not* a palette change — `--dk-*` stays light so every other section keeps its tokens, and the elements inside a band that need light-on-dark say so explicitly.

> `DarkHead` renders `--dk-ink` (near-black) and is therefore **not used inside a dark band**. Those two sections carry their own heading markup rather than adding a `tone` prop used twice.

**No pricing section anywhere.** The `MarketingPackage` table still exists (`MarketingLead.packageId` is an FK to it, and admins quote from it privately) but nothing public renders a price.

---

## 3. Design tokens

### 3.1 Page-scoped tokens

Set as inline CSS variables on the `DarkGround` wrapper in `dark.tsx`. **Nothing outside the wrapper is affected** — the global theme, header and footer are untouched.

> **Why `--dk-*` and not `--ads-*`?** These began life as a dark palette and were flipped to light in place. Renaming would touch nine components for no behavioural gain, and the names are already scoped. Changing the page's theme means editing this one block.

| Token | Resolves to | Hex | Usage |
|---|---|---|---|
| `--dk-bg` | — | `#ffffff` | Page ground, card fill |
| `--dk-bg-2` | `--color-dark-50` | `#f8fafc` | Tinted section bands (Active Campaigns) |
| `--dk-panel` | `--color-dark-50` | `#f8fafc` | Badge and chip fill |
| `--dk-panel-2` | `--color-dark-100` | `#f1f5f9` | Icon tiles, skeletons, hover fill |
| `--dk-line` | `--color-dark-200` | `#e2e8f0` | Card borders, dividers |
| `--dk-line-2` | `--color-dark-300` | `#cbd5e1` | Emphasised borders |
| `--dk-ink` | `--color-dark-900` | `#0f172a` | Headings, body |
| `--dk-muted` | `--color-dark-600` | `#475569` | Secondary text |
| `--dk-faint` | `--color-dark-500` | `#64748b` | Captions, metric labels |
| `--dk-cyan` | — | `#0E7490` | Accent, gradient start |
| `--dk-blue` | — | `#2563EB` | Gradient middle |
| `--dk-violet` | — | `#7C3AED` | Gradient end |
| `--dk-orange` | `--color-primary-500` | `#f97316` | Fills: buttons, badges, and orange text **on the dark bands** (6.68:1) |
| `--dk-orange-ink` | `--color-primary-700` | `#c2410c` | Orange **text on light surfaces** — eyebrows, "Learn More", heading accents |

**`DK_GRADIENT`** = `linear-gradient(100deg, var(--dk-cyan), var(--dk-blue) 55%, var(--dk-violet))`.
Used on: headline accent words, active filter chip, metric values, primary CTA, service feature icon, the `+` connector.

> **Two oranges, deliberately.** `primary-500` on white is **2.80:1** — it fails AA at every size, so it must never be used for text on a light section. `--dk-orange-ink` (`primary-700`, 5.18:1) exists for that. On the dark bands plain `--dk-orange` measures 6.68:1 and is correct. Picking the wrong one is the easiest accessibility mistake to make on this page.

> **The cyan/blue/violet accents are the one place this page leaves the design system.** The system has no mid-dark cyan or violet. They are chosen so white text clears AA on each (5.36 / 5.17 / 5.70:1) — see §9.

### 3.2 Global tokens consumed

| Token | Value | Usage |
|---|---|---|
| `--shell-max` | `1320px` | Content width (`.shell`) |
| `--shell-pad` | `clamp(1rem, 2.5vw, 2rem)` | Side gutters |
| `--radius-card` | `12px` | All cards |
| `--radius-btn` | `8px` | All buttons |
| `--shadow-card` | `0 6px 18px rgba(15,23,42,.05)` | Card resting |
| `--shadow-card-hover` | `0 14px 30px rgba(15,23,42,.09)` | Card hover |
| `--font-display` | Plus Jakarta Sans | `h1`–`h3`, metric values |
| `--font-sans` | Inter | Body |

**Never hardcode a hex.** Use the token. The page's theme is one block; a stray hex breaks that guarantee.

### 3.3 Typography utilities

| Utility | Mobile | Desktop | Usage |
|---|---|---|---|
| `.h1` | 2rem | 3rem | Hero only (one per page) |
| `.h2` | 1.625rem | 2.25rem | Section headings |
| `.h3` | 1.25rem | 1.375rem | Feature card titles |

Section vertical rhythm: `py-14 lg:py-20` (56px → 80px).

---

## 4. Components

| Component | Props | Notes |
|---|---|---|
| `DarkGround` | `children` | Owns the palette + grid texture. Wraps the whole page. |
| `DarkHead` | `badge?`, `title`, `accent?`, `subtitle?`, `align?` | `accent` renders in `DK_GRADIENT` after `title`. |
| `GradientFrame` | `children`, `glow?`, `className?` | 1px gradient edge via a padded wrapper, not `border-image` (Safari renders that inconsistently on rounded corners). |
| `Glow` | `color`, `size`, `className` | Decorative blur. `aria-hidden`. |
| `Particles` | `count` | Returns `null` under reduced motion. |
| `Orbit` | `size`, `className` | SVG rings. CSS rotation, no JS per frame. |
| `PlateTint` / `PLATE_FILTER` | — | Unifying wash over product photography. Spread the filter on `<img>`, render `<PlateTint/>` as its sibling. |
| `useReveal(selector, {y, stagger})` | — | GSAP ScrollTrigger reveal. Returns a ref for the scope. |
| `useCalm()` | — | `true` when the visitor asked for reduced motion. **Gate every animation on this.** |

### 4.1 Campaign card — exact anatomy

This is the section the mockup is most specific about.

```
┌──────────────────────────┐
│ [PLATFORM]               │  platform badge, top-left, 12px inset
│                          │
│      campaign creative   │  aspect-[4/5], object-cover
│                          │
│ BrandName                │  11px, white/75
│ Campaign title    [LIVE] │  14px bold white + status chip
├────────────┬─────────────┤
│   value    │    value    │  gradient text, 16px extrabold
│   label    │    label    │  11px, --dk-faint
└────────────┴─────────────┘
```

- Card: `bg-[--dk-bg]`, `border-[--dk-line]`, `rounded-[--radius-card]`, `shadow-card`.
- Caption scrim: `linear-gradient(to top, rgba(2,6,23,.88), rgba(2,6,23,.52) 48%, transparent)`, height 128px. **Required** — the caption sits on an unpredictable photograph.
- Platform badge colour comes from `PLATFORM_META` in `dark.tsx`, keyed by `campaign.platform`. Unknown platforms fall back to `other` rather than disappearing.
- Metric footer renders only if `metrics.length > 0`. One metric → `grid-cols-1`; two → `grid-cols-2 divide-x`.

---

## 5. States and interactions

| Element | State | Behaviour |
|---|---|---|
| Primary CTA | Hover | White sheen sweeps left→right, 700ms. Suppressed under reduced motion. |
| Campaign card | Hover | `-translate-y-1.5`, border → cyan/45, shadow → `--shadow-card-hover`, image `scale(1.07)` over 600ms |
| Campaign card | No linked case study | Renders as `<article>`, not `<button>` — a clickable element that does nothing is worse than a plain one |
| Campaign card | Linked | `<button>`; an ↗ affordance fades in on hover; `.sr-only` text names the destination |
| Portfolio chip | Active | `DK_GRADIENT` fill, white text, `aria-pressed="true"` |
| Portfolio chip | Inactive | `--dk-panel` fill, `--dk-line` border, `aria-pressed="false"` |
| Portfolio card | Hover | Lift + image zoom + arrow `translate-x-1` |
| FAQ item | Open | Border → cyan/40, fill → `--dk-panel-2`, chevron rotates 180° |
| FAQ item | Closed | **Answer is unmounted, not hidden** — a closed answer must not be reachable by Tab or read by a screen reader |
| Service card | Hover | Lift 4px, arrow slides |
| Dialogs | Open | Body scroll locked, focus moved in and trapped, Escape and backdrop close |

### 5.1 Status chip logic — read this before changing it

```
status === "live"        → green chip, pulsing dot, "Live"
isIllustrative === true  → neutral chip, "Illustrative"
otherwise                → neutral chip, "Paused" | "Completed"
```

**The server guarantees `status` is never `"live"` for an illustrative row** — `publicCampaign()` rewrites it to `"illustrative"` before sending. The LIVE branch is unreachable for sample content by construction. Do not add a client-side override.

---

## 6. Responsive behaviour

| Breakpoint | Hero | Services | Campaigns | Portfolio |
|---|---|---|---|---|
| ≥1280px | 2 col | feature + 2 + 3 | **4 / row** | **3 / row** |
| 1024–1279px | 2 col | feature + 2 + 3 | 2 / row | 3 / row |
| 768–1023px | 1 col | feature + 1 + 2 | 2 / row | 2 / row |
| <768px | 1 col, CTAs full-width | all stacked | 1 / row | 1 / row |

Verified with no horizontal overflow at **320 / 375 / 390 / 414 / 768 / 1024 / 1280 / 1440 / 1920 / 2560**.

Specific mobile behaviour:
- Hero CTAs become full-width stacked buttons (44px min height — WCAG 2.5.8).
- Hero indicator row: 4 columns → 2×2 grid.
- Services feature panel drops its photo column entirely.
- Approach rail switches from horizontal to a short vertical joint.
- Dialogs become bottom sheets (`rounded-t-[16px]`, `max-h-[92dvh]`). **`dvh`, not `vh`** — mobile browser chrome changes viewport height as it hides, and `vh` leaves the submit button under the address bar.

---

## 7. Content and data

### 7.1 What is admin-managed vs hardcoded

| Section | Managed where |
|---|---|
| Services | **Admin → Marketing → (DB only today)** — `MarketingService`, seeded by `npm run seed:adsens`. No admin screen yet. |
| Active Campaigns | **Admin → Marketing → AdSens campaigns** |
| Portfolio | **Admin → Marketing → AdSens portfolio** |
| Hero, Approach, Why, Zolo+AdSens, FAQ | Hardcoded in their components |

### 7.2 Character limits

| Field | Limit | Overflow |
|---|---|---|
| Campaign title | 160 (server) | `truncate` — single line |
| Campaign client name | 160 | `truncate` |
| Metric label / value | 60 each | No truncation; keep them short |
| Case study title | 160 | Wraps, no clamp |
| Case study summary | 400 | Wraps, no clamp |
| Service summary | — | Wraps |

> Campaign titles truncate rather than wrap because the caption sits in a fixed-height scrim; a two-line title would push out of it.

### 7.3 Empty and loading states

| Condition | Behaviour |
|---|---|
| No published campaigns | **Section does not render.** Hero preview falls back to a labelled Zolo packaging plate. |
| No published case studies | **Section does not render.** |
| No services | Dashed-border message: "Our service list is being updated…" |
| Services loading | Six pulsing skeleton cards |
| Case study loading | Skeleton inside the dialog |
| Case study fetch fails | "We couldn't load this case study. Please close this and try again." |
| Catalog fetch fails | Page still renders; form still works (separate request, deliberately) |
| Campaign has no image | Borrows a Zolo packaging plate from `showcase-art.ts` |
| Campaign has no metrics | Footer omitted entirely |
| Filter matches nothing | "Nothing published under X yet" + a "Show all work" reset |

**No skeleton cards for empty rails.** A placeholder grid in a results section reads as a claim about work that does not exist.

---

## 8. Motion

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Section children | Scroll into view (82%) | opacity 0→1, y +28→0, stagger 60–80ms | 600ms | `power3.out` |
| Hero preview card | Mount | opacity + scale 0.95→1, y 20→0 | 600ms | `[0.16, 1, 0.3, 1]` |
| Card hover | Pointer | translateY −6px | 300ms | default |
| Card image | Pointer | scale 1→1.07 | 600ms | `ease-out` |
| CTA sheen | Pointer | translateX −100%→100% | 700ms | default |
| Particles | Always | translateY ±24px, opacity 0.18↔0.6 | 7–16s loop | `ease-in-out` |
| Orbit rings | Always | rotate 360° | 13/19/26s | `linear` |
| Live dot | Always | Tailwind `animate-pulse` | — | — |

### 8.1 Reduced motion — non-negotiable

`prefers-reduced-motion: reduce` must produce: **0 particles, 0 orbit spins, 0 pulses, no hover zoom, no sheen.**

> **The trap:** `useReveal` animates *from* `opacity: 0`. If you skip the tween without setting the final state, content stays invisible. The hook calls `gsap.set(items, {opacity: 1, y: 0})` in the calm branch for exactly this reason. **If you add a reveal, add the same guard**, and verify all revealed elements are at opacity 1 — currently 47 of 47.

---

## 9. Accessibility

### Contrast (measured, AA)

| Pair | Ratio | Verdict |
|---|---|---|
| `--dk-ink` on white | 17.85:1 | ✓ |
| `--dk-muted` on white | 7.58:1 | ✓ |
| `--dk-faint` on white | 4.76:1 | ✓ |
| White on `--dk-cyan` | 5.36:1 | ✓ |
| White on `--dk-blue` | 5.17:1 | ✓ |
| White on `--dk-violet` | 5.70:1 | ✓ |
| ~~`dark-400` on white~~ | ~~2.56:1~~ | ✗ — **removed; do not reintroduce** |

### Requirements

- **One `h1`** (hero). Sections use `h2`; card titles `h3`. Do not skip levels.
- Every `<img>` carries `alt`. Decorative layers are `aria-hidden`.
- FAQ: each question is a `<button>` with `aria-expanded` + `aria-controls`; each answer is a `role="region"` labelled by its button.
- Portfolio filters: `role="group"` with `aria-label`, each chip `aria-pressed`.
- Hero carousel: dots carry `aria-label` naming the campaign and `aria-current`.
- Indicator row is a `<dl>`; visible numbers are `<dd>`, labels are `.sr-only` `<dt>`.
- Dialogs: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trapped, Escape closes, scroll restored on close.
- Touch targets ≥44px on coarse pointers.
- 11 images lazy-loaded below the fold; hero preview is eager.

---

## 10. Data-integrity rules (enforced server-side)

The mockup shows "12.4K Clicks", "#1 Ranking", "89K Visits" and named client brands. **Those are invented and must not be implemented as literals.** Four rules in `server/src/services/adsens-showcase.mjs` make that impossible from the client:

| Rule | Enforcement |
|---|---|
| A sample can never claim LIVE | `publicCampaign()` rewrites `status` → `"illustrative"` |
| Real client work needs a named client | `assertCampaignHonesty()`, validated against the merged row so it can't be flipped on without one |
| A metric is a complete label+value pair | `metricsOf()` drops half-pairs — no placeholder slot exists |
| Unverified results never ship | `publicCaseStudyFull()` returns `results: []` unless `resultsVerified` |

Covered by 21 tests in `server/test/adsens-showcase.test.mjs`. **Do not add a client-side path around any of these.**

---

## 11. Deltas: mockup vs. build — resolved

These were open when the spec was first written. All but one are now implemented.

| # | Item | Resolution |
|---|---|---|
| 1 | Orange eyebrow with a leading dash, vs. a cyan pill | **Implemented.** `DarkHead` renders a 20px orange rule + uppercase label. |
| 2 | Orange headline accent, vs. the cyan→violet gradient | **Implemented**, using `--dk-orange-ink` on light and `--dk-orange` on dark. The design system reserves orange for CTAs; an eyebrow and a heading accent are not actions, and the rule exists to stop orange *text that looks clickable*. |
| 3 | Six equal service cards, vs. feature + tall + compact | **Implemented.** Uniform 3×2 grid, orange icon tile, three headline deliverables, "Learn More". |
| 4 | Campaign metrics as icon + label pairs | **Not done.** Needs a `metric1Icon` column and an admin field. The current value-over-label footer carries the same information. |
| 5 | Consultation form inline beside the Zolo Advantage panel | **Not done.** The dialog is built, tested and wired to the lead pipeline; moving it inline is a layout change plus re-testing the submit path. Worth doing if conversion matters more than page length. |
| 6 | "View All Campaigns →" link | **Not done.** Needs an `/adsens/campaigns` index route. |
| 7 | Arrows between Approach steps | **Not done.** A continuous rail is in place; cosmetic. |

## 12. Implementation checklist

Running the page locally:

```bash
npm run dev:all            # API :5001 + Vite :5173 — NOT `npm run dev`
npm --prefix server test   # 403 tests, serial
npm run build              # tsc + vite; there is no lint script
```

Content: **Admin → Marketing → AdSens campaigns / AdSens portfolio**. Both rails stay hidden until something is published.

Before you call it done:

- [ ] No horizontal overflow at all ten widths
- [ ] Reduced motion: 0 animations AND every revealed element at opacity 1
- [ ] Contrast ≥4.5:1 for any new text colour
- [ ] Empty state: both rails hidden, no skeletons
- [ ] Filters update the grid with `aria-pressed` correct
- [ ] Both dialogs trap focus and restore scroll
- [ ] No console errors on `/adsens`, `/`, `/products`, `/eco-rewards`, `/contact`
- [ ] `npm run build` and the server suite both clean

---

## 13. Known gaps

- **No admin UI for services** — `MarketingService` rows are managed by `npm run seed:adsens` or SQL.
- **No admin UI for hero content** — headline, description and CTA labels are hardcoded.
- **No `/adsens/campaigns` index** — needed for mockup delta #6.
- **No lint script** in the repo; `npm run build` typechecks.
- **GSAP adds ~44 kB gzipped.** It earns its place via `useGSAP`'s ScrollTrigger cleanup on route change, but framer-motion could cover most of this if bundle size matters more.
