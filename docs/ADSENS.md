# AdSens by Zolo — development report

Phase 1 (end-to-end lead flow) is built and tested. Phase 2 — marketing
quotations, admin-managed packages and lead→client billing — is not.

## 1. Existing architecture discovered

| What I looked for | What is actually there |
|---|---|
| A "Marketing" module to extend (§15) | `Admin → Marketing` is **coupons + campaigns** — promotions for the packaging store, not a sales pipeline. No lead, service or package tables existed. |
| A lead/enquiry entity to reuse | `Rfq` is the closest, but `Rfq.userId` is **required**, so an anonymous visitor cannot submit one. Reusing it would have meant creating a shadow `User` per enquiry. Not reused. |
| A customer entity | `User` (role `buyer`). The `Customer` table is dead code — see `docs/CRM-AUDIT.md`. |
| A notification pipeline | `services/notification-service.mjs` — `dispatch()` (per-user) and `dispatchToAdmins()`. Plus `email.mjs` / `whatsapp.mjs`, which take a raw recipient. |
| Public, unauthenticated routes | `/api/v1/public/*`, e.g. `publicPayRouter`. Convention followed. |
| Rate limiting | `middleware/rate-limit.mjs` exports a reusable `rateLimit({ windowMs, max, keyFn })`. Reused, not reinvented. |
| A page-scoped theme pattern | `pages/EcoRewards.tsx` scopes a palette with CSS variables on its root. Followed, so the global theme is untouched (§2). |

**Key decision:** `dispatch()` resolves a `User` by id and an AdSens lead has no
account, so the visitor acknowledgement calls `sendMail`/`sendWhatsApp`
directly. Both write a `NotificationDelivery` row with the true outcome —
`SENT`, `FAILED`, or `SKIPPED` with the reason. The admin alert uses
`dispatchToAdmins()`.

## 2. Reused, not rebuilt

`rateLimit()` · `recordEvent()` (audit) · `dispatchToAdmins()` · `sendMail()` /
`sendWhatsApp()` · `ok`/`wrap`/`badRequest`/`notFound` · `authenticate` +
`requireAdmin` · the `.shell` container and `.btn`/`.h1`/`.h2`/`.lead`
utilities · the existing nav `links` array (desktop and mobile render from the
same source, so one entry covered both).

## 3. New files

| File | Purpose |
|---|---|
| `server/src/services/adsens.mjs` | Catalog reads, `submitLead`, admin pipeline, `notifyNewLead`. |
| `server/src/routes/adsens.mjs` | `publicAdsensRouter` (no auth, rate limited) + `adminAdsensRouter`. |
| `server/test/adsens.test.mjs` | 15 tests. |
| `server/scripts/seed-adsens-services.mjs` | The 8 services from §5 as real rows. Idempotent upsert; `npm run seed:adsens`. |
| `src/pages/AdSens.tsx` | The `/adsens` page. |
| `src/components/adsens/ConsultationForm.tsx` | The consultation form. |
| `src/lib/api/adsens.ts` | Public API client. |

## 4. Modified

`server/prisma/schema.prisma` (5 models + 1 enum, additive) ·
`server/src/app.mjs` (two mounts) · `server/package.json` (`seed:adsens`) ·
`src/App.tsx` (nav entry + route).

## 5. Migration

`20261106054230_adsens_marketing_leads` — **additive only**: 5 `CREATE TABLE`,
1 `CREATE TYPE`, indexes and FKs. Zero `DROP`/`ALTER COLUMN`. Verified before
and after: 516 products / 1398 users / 421 orders unchanged.

Models: `MarketingService`, `MarketingPackage`, `MarketingPackageService`,
`MarketingLead`, `MarketingLeadActivity`; enum `MarketingLeadStatus`
(NEW → CONTACTED → QUALIFIED → PROPOSAL_SENT → NEGOTIATION → WON/LOST).

## 6. API

**Public** (`/api/v1/public/adsens`) — no auth:
```
GET  /catalog        active services + published packages
POST /consultation   create a lead; returns ONLY a reference number
```
**Admin** (`/api/v1/admin/marketing`) — `authenticate` + `requireAdmin`:
```
GET   /leads             paginated, searchable, filterable, with status counts
GET   /leads/:id         lead + full activity history
PATCH /leads/:id         status / assignee / follow-up date / note
POST  /leads/:id/convert link a WON lead to an EXISTING customer
```

## 7. Security (§22)

* Pipeline fields (`status`, `assignedToId`, `convertedUserId`, `leadNumber`,
  `source`) are set server-side. A visitor who posts them is ignored — tested.
* Service slugs are validated against the database; unknown or inactive slugs
  are dropped rather than stored — tested.
* Consent is required; without it there is no lead.
* Two rate limits: per IP+email (5/hr) and a blunt per-IP ceiling (40/hr).
  Keyed on both because one office NAT address can hold several real
  businesses.
* The public response contains only `{ leadNumber, duplicate, message }`.
  Stored lead data never leaves the admin API — tested.
* Admin routes reject anonymous and buyer tokens — tested.
* Every admin change writes a `MarketingLeadActivity` row and an `AuditLog`.

## 8. Lead submission test (§25)

Driven in a real browser at `/adsens`:

```
title            AdSens by Zolo | Digital Marketing & Business Growth
services         8 rendered from the database
nav              AdSens present and highlighted when active
"Get started"    preselected 2 service chips and scrolled to the form
submit w/o consent  refused client-side, no success message shown
submit with consent success, reference ADS-31B3558B
```
Then verified server-side: the row was in PostgreSQL with
`status NEW`, `services ["digital-advertising"]`, `consent true`, 1 activity;
it appeared in the admin API (`byStatus {"NEW":1}`); and the acknowledgement
logged `email SKIPPED — "SMTP not configured"` rather than claiming a send.

Test rows were removed afterwards.

## 9. Responsive (§19)

No horizontal overflow at **320 / 375 / 390 / 414 / 768 / 1024 / 1280 / 1440 /
1920 / 2560**. Form measured in the DOM: 11 inputs, 0 overflowing, none under
36px tall, 1 column at 375px → 2 at 1440px, 48px submit button.

## 10. The dark showcase sections

Three reference designs (an agency hero, an "Active Campaigns" rail and an
"Our Portfolio" grid) were supplied as the direction for the top of the page.
They were recreated closely — dark navy ground, cyan/violet gradients, glowing
borders, grid texture, drifting particles, four-up and three-up card grids.

### The conflict, and how it was resolved

Every number in those references is invented: "250+ Clients Served", "3.2x ROI
Multiplier", "98% Client Satisfaction", "12.4K Clicks", "#1 Ranking", "89K
Visits", plus six named clients with testimonials. The same brief that
supplied them also says, in §2: *"Do not show invented live campaigns, client
names, clicks, conversion rates, ROAS, rankings or leads."*

So the **composition** was copied and the **content** was made admin-owned.
Two tables back it (`MarketingCampaign`, `MarketingCaseStudy`), managed under
**Admin → Marketing → AdSens campaigns / AdSens portfolio**. Nothing is
hardcoded in the frontend.

Four rules are enforced on the SERVER, not in the page:

| Rule | Where | Effect |
|---|---|---|
| A sample preview can never claim LIVE | `publicCampaign()` rewrites `status` to `"illustrative"` whenever `isIllustrative` | The UI has no code path to badge it live |
| Real client work needs a named client | `assertCampaignHonesty()`, on create AND update | A sample card cannot carry a real brand |
| A metric is a complete label+value pair | `metricsOf()` | A half-filled pair is dropped, so there is no slot for a placeholder number |
| Unverified results are never sent | `publicCaseStudyFull()` returns `results: []` unless `resultsVerified` | The page cannot leak what it never receives |

`assertCaseStudyHonesty()` also refuses to set `resultsVerified` with no
results behind it — verification is a claim about numbers, so there have to be
numbers.

These are covered by 21 tests in `server/test/adsens-showcase.test.mjs`,
including one that seeds `status: "live"` on an illustrative row and asserts
the public endpoint still reports `"illustrative"`.

### Empty by default

Both rails hide themselves entirely when nothing is published — no skeleton
cards, no "coming soon" grid. The hero's preview slot falls back to a panel
that says real creatives appear there once there is genuine work to show.
Verified on the live page with the tables empty: `hasActiveCampaigns: false,
hasPortfolio: false, hasPlaceholder: true`.

The portfolio filter chips are built from `categories`, which the server
derives from published case studies. The brief lists eight suggested filters;
offering all eight with six of them empty would advertise a portfolio that
does not exist.

### Two palettes, one page

The showcase block is dark; services, process, packages, consultation and FAQ
stay on the original light ground. Both palettes are scoped CSS variables on
their own wrapper, so the global theme and every other page are untouched.

### Motion

`prefers-reduced-motion` is honoured: particles are not rendered at all (0 vs
22, measured), entrance offsets collapse to a plain fade, hover zooms and the
pulsing live dot are dropped. Particles are CSS keyframes on transform and
opacity — no rAF loop and no per-frame React work — with positions from a
seeded LCG so re-renders do not reshuffle them.

### Dev-only image fix

Stored uploads are root-relative (`/uploads/x.jpg`), which is correct in
production where one process serves API and SPA. In development the SPA is on
Vite and the API on :5001, so those paths resolved against Vite and every
image silently rendered blank. `src/lib/asset-url.ts` derives the upload
origin from the configured API base. This was a pre-existing dev gap, not new.

## 11. Full-page redesign (Nov 2026)

The page was rebuilt as ONE dark surface in the brief's §2 order:

| # | Section | Source of content |
|---|---|---|
| 1 | Hero | Authored copy + published campaigns |
| 2 | Services Overview | `MarketingService` (DB) |
| 3 | Active Campaigns | `MarketingCampaign` (DB) |
| 4 | Our Portfolio | `MarketingCaseStudy` (DB) |
| 5 | Our Approach | Authored |
| 6 | Why Choose AdSens | Authored |
| 7 | Zolo + AdSens | Authored |
| 8 | Consultation CTA | Opens the lead dialog |
| 9 | FAQ | Authored |

### No pricing (§7)

The packages rail and its prices were REMOVED from the public page. The
`MarketingPackage` table stays — `MarketingLead.packageId` is an FK to it and
the admin still quotes from it privately — but nothing on `/adsens` renders a
price. Verified against the live page: the only currency string anywhere is
the shared Zolo announcement bar ("Free shipping on orders over ₹10000"),
which is global chrome the brief says to preserve.

### Varied service compositions (§4)

The services grid is deliberately asymmetric rather than N identical cards:
a wide FEATURE panel with real packaging photography feathered into its edge,
then two TALL cards carrying full deliverable lists, then COMPACT cards. The
layout adapts to however many services are published — three services gives a
feature and two talls with no empty row.

### The consultation dialog stays light

An eleven-field form is work, and a white panel is the more legible surface
for filling one in; dark fields with dark labels are where these pages
usually fail. The three `--ads-*` tokens the form needs are set on the dialog
itself, since the page root is no longer light.

### Verified (§18)

| Criterion | Result |
|---|---|
| Section order matches §2 | 9 sections, exact order |
| No pricing on the page | Only the global announcement bar |
| No fabricated metrics | None of the reference's figures present |
| Portfolio filters work | 5 cards → 1 on "SEO", `aria-pressed` correct |
| Case study opens | Dialog opens, Escape closes |
| Consultation saves leads | Dialog opens with 12 fields, wired to the tested pipeline |
| Desktop grid | 4 campaigns/row, 3 portfolio/row at 1440 and 1920 |
| Tablet / mobile | 2/row at 768–1024, 1/row at 375 |
| No overflow | 320/375/390/414/768/1024/1280/1440/1920/2560 |
| Console errors | None, on `/adsens` or any other route |
| Semantics | One `h1`, all images have `alt`, 11 lazy-loaded, FAQ buttons carry `aria-expanded` |
| Reduced motion | 0 animations; all 47 revealed elements visible |
| Other routes | `/`, `/products`, `/eco-rewards`, `/contact` unaffected |

## 12. Light theme (Nov 2026)

The page was flipped from the dark agency surface to Zolo's light theme, at
the user's request, with the Active Campaigns section rebuilt to the supplied
reference's exact composition.

### One change point

The flip is the `darkPalette` token block in `components/adsens/dark.tsx` and
nothing else. The variables keep their `--dk-*` names — renaming them would
touch nine components for no behavioural gain, and they are already scoped to
this page. Values now come from the design system in `index.css`
(`dark-50/100/200/500/600/900`, `primary-500`) rather than one-off hex codes.

Four things needed real adaptation rather than a token swap, because they
were *built* for a dark ground:

| Thing | Dark version | Light version |
|---|---|---|
| Grid texture | white hairlines at 3.5% | `rgba(15,23,42,0.045)` — white-on-white showed nothing |
| `GradientFrame` edge | glow + translucent whites | visible hairline + `--shadow-card` |
| `PlateTint` | heavy multiply + vignette, to drag light photos onto a dark page | a 10% brand wash; the plates already belong on white |
| Particles / `Glow` | 0.5 and 0.16 opacity | 0.28 and 0.10 — a colour blur at 0.16 vanishes into white |

### Contrast

Measured every visible text node in the page's own sections against its
painted background. **55 failures → 2**, and both remaining are white on a
`background-image` gradient, which the script reads as white-on-white; they
measure 5.17–5.70:1 by hand across all three gradient stops.

The one real fix: `--dk-faint` was `dark-400` (#94a3b8), **2.56:1 on white**
— under the 4.5 AA floor for the small text it carries (metric labels,
indicator captions). It is now `dark-500` (4.76:1), and `--dk-muted` moved to
`dark-600` (7.58:1) to keep the two tiers distinct. The accent trio was also
darkened from the neon set for the same reason: `#2DD4BF` → `#0E7490`,
`#4F7BFF` → `#2563EB`, `#A855F7` → `#7C3AED`.

### Active Campaigns, matched to the reference

```
┌──────────────────────────┐
│ [PLATFORM]               │  badge, top-left
│      campaign creative   │  4:5 image fills the card top
│ BrandName                │  brand line …
│ Campaign title    [LIVE] │  … title + status chip, over a scrim
├────────────┬─────────────┤
│   value    │    value    │  two metrics, divided
│   label    │    label    │  value over label
└────────────┴─────────────┘
```

The reference draws this dark; the card is white with a hairline border and
the scrim carries contrast over the photo. The layout is identical. The
section sits on `--dk-bg-2` (dark-50) so it reads as a band against the white
sections either side, and the `Ribbon` marquee above it was dropped — on a
light page it competed with the heading instead of separating sections.

### Still verified after the flip

Filters 5 → 1; both dialogs open and close; 4 campaign cards and 3 portfolio
cards per row at 1440/1920, 2 at tablet, 1 at mobile; no overflow at any of
the ten widths; reduced motion kills all animation with all 47 revealed
elements visible; no console errors on `/adsens` or on `/`, `/products`,
`/eco-rewards`, `/contact`.

### A flaky test, fixed

One run of the suite failed with `actual: 12, expected: 1` in "a half-filled
metric pair is dropped"; the next run passed. The cause was the test, not the
code: `publicShowcase()` takes the first 12 campaigns, this suite creates 12,
and the tests looked their row up **by title** in that listing. Once the
limit truncated, `.find()` returned the wrong row or none at all.

All five such lookups now match on the **id the create returned**, each
asserted row is pinned to the front with a distinct negative `sortOrder`, and
every lookup has an `assert.ok(row, …)` so a truncated listing fails with a
clear message instead of a confusing one further down.

## 13. Not built

* **Marketing quotations** (§15) — no `MarketingQuotation` table or UI yet.
* **Admin UI** for services, packages and leads. The APIs are complete and
  tested; those three screens are still phase 2. Services are manageable today
  only via `npm run seed:adsens` or direct SQL. (Campaigns and portfolio DO
  have admin screens — see §10.)
* **Packages** — the data model and the public section exist, but nothing is
  published, so the section hides itself. No invented tiers or prices.
* **Marketing clients / billing** (§16) — deliberately not stubbed.
* **Testimonials** (§12) — no table. The section is omitted rather than filled
  with invented quotes.
* **WhatsApp CTA** (§11) — the floating WhatsApp button already on the site
  covers this. A dedicated AdSens number needs `whatsappBusinessNumber` in
  Settings; no number is hardcoded.
* **Analytics** (§21) — no analytics infrastructure exists in the app, so
  nothing was wired. Adding fake event calls would have been worse.
