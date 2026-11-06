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

## 11. Not built

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
