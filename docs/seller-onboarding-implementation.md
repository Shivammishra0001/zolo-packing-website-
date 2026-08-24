# Zolo Seller / Supplier Onboarding — Implementation

Real, end-to-end seller onboarding built on the existing **Express + Prisma + PostgreSQL** backend (`server/`, port 5001). No mock data, no in-memory stores — PostgreSQL is the source of truth.

## Current architecture

- **Frontend:** React 19 + Vite + Tailwind (`src/`). Storefront + admin ERP + buyer portal.
- **Working backend:** `server/` — was a single 111-line flat file with only a `Product` model and fully-open endpoints. Refactored into a modular structure and extended with auth, org, and the full supplier domain.
- **Legacy (unused):** `backend/` (MongoDB) — not touched; the frontend does not depend on it.

### Backend module layout (new)
```
server/
  index.mjs                 # thin entrypoint → createApp()
  src/
    app.mjs                 # composes Express app (exported for tests)
    lib/     prisma, env, http (envelope + error handler), crypto (bcrypt/JWT/AES-GCM), storage, validation (zod)
    middleware/ auth.mjs     # authenticate, requireAdmin/requireSeller, loadSupplierOrg, requireRole
    services/  auth, onboarding, documents, admin, events (audit+notify), notifications, dashboard, matching, ai-tools
    routes/    auth, products, seller, admin, notifications
  scripts/ seed-admin.mjs
  test/    auth / onboarding / admin (.test.mjs) + helpers  (node:test, 22 tests)
```

## Reused vs. built

**Reused:** Prisma+Postgres wiring, the `{success,data}` response envelope and Prisma-error→HTTP mapping (generalized into `lib/http`), the local-disk upload path (generalized into `lib/storage`), and the existing `Product` model + catalog/storefront (untouched — the catalog API contract is preserved verbatim in `routes/products.mjs`).

**Built from scratch (none existed):** authentication (JWT + bcrypt + sessions), RBAC, the entire supplier data model, server-side validation (zod), a document-storage abstraction supporting PDFs, notifications, audit log, domain events, RFQ matching / scoring / AI foundations, and the test suite.

## Database changes

One non-destructive migration (`20260810060005_add_auth_org_supplier_onboarding`) — 19 new tables, `Product` unchanged:

`User`, `Session`, `Organization`, `OrganizationMember`, `SupplierProfile`, `SupplierLocation`, `SupplierCapability`, `SupplierCapacity`, `SupplierMachine`, `SupplierMaterial`, `SupplierCertification`, `SupplierDocument`, `SupplierBankAccount`, `SupplierQuality`, `SupplierLogistics`, `SupplierStatusHistory`, `SupplierChangeRequest`, `AuditLog`, `Notification`.

Enums: `UserRole`, `OrgKind`, `OrgMemberRole`, `SupplierStatus` (DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED → APPROVED / REJECTED / SUSPENDED / INACTIVE), `VerificationStatus`, `BusinessType`, `LocationType`, `DocumentType`, `NotificationStatus`.

## API (all under `/api/v1`)

**Public:** `GET /health`, `POST /auth/register|login|refresh|logout`, `GET /auth/me`, plus the existing product/upload routes (kept open).

**Seller** (`authenticate` + `requireSeller` + `loadSupplierOrg`, scoped to the caller's own org):
- `GET/PATCH /sellers/me/onboarding`, `POST /sellers/me/onboarding/submit`
- `POST/DELETE /sellers/me/{locations|capabilities|machinery|materials|certifications|bank-accounts}[/:id]`
- `PUT /sellers/me/{capacity|quality|logistics}`
- `GET/POST/DELETE /sellers/me/documents[/:id]`, `GET /sellers/me/documents/:id/url`
- `GET /sellers/me/dashboard`, `GET /sellers/me/ai/{review-summary|suggested-categories|missing-documents}`

**Admin** (`authenticate` + `requireAdmin`):
- `GET /admin/sellers`, `GET /admin/sellers/:id`
- `POST /admin/sellers/:id/{review|approve|reject|request-changes|suspend|reactivate}`
- `POST /admin/documents/:id/verify`, `GET /admin/documents/:id/url`

**Notifications** (`authenticate`): `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`.

## Event model

Domain events → `AuditLog` (metadata scrubbed of secrets). Emitted: `seller.created`, `seller.onboarding.{saved,submitted,resubmitted,review_started,changes_requested}`, `seller.{approved,rejected,suspended,reactivated}`, `seller.document.{uploaded,verified,rejected,removed}`, `seller.{location,capability,capacity,bank_details,quality,logistics,certification}.updated/added/removed`. Notifications mirror the seller-facing subset and admin alerts on submission.

## Security model

- **Identity from token only** — `req.user` resolved from a verified JWT; `organizationId`/`userId` from the client are never trusted. Sellers act only on their own org (`loadSupplierOrg`).
- **RBAC** — `requireSeller` / `requireAdmin` / `requireRole`; `seller_staff` is read-only for onboarding.
- **Passwords** bcrypt-hashed; generic login errors (no user enumeration).
- **Sessions** persisted as sha256 hashes; logout revokes; refresh checks revocation/expiry.
- **Bank numbers** AES-256-GCM encrypted at rest; API returns only `accountLast4`.
- **Documents** — validated mime (jpg/png/webp/pdf) + 10 MB cap; `storageKey` never exposed; downloads via authorized URL endpoints.
- **Validation** — zod is the final authority; GST/PAN/IFSC/CIN format-checked and normalized; GST/PAN unique across suppliers.
- **Editing** locked once `SUBMITTED`/`UNDER_REVIEW`; only `DRAFT`/`CHANGES_REQUESTED` are editable.
- **Transactions** — submit, approve, reject, suspend, request-changes are atomic (profile + status history + event + notification).

## Verification (honesty)

Documents are **not** government-verified — `verificationStatus` reflects manual admin review only. Supplier scoring reports **"Insufficient data"** for dimensions without operational history rather than inventing numbers. Dashboard modules not yet built (RFQs, quotes, orders, production, QC, inventory, payments) return `available:false` empty states.

## Zolo AI foundation

Read-only, authorization-scoped tools in `services/ai-tools.mjs`: `getSellerOnboardingStatus`, `getMissingSellerInformation`, `summarizeSellerProfile`, `suggestSellerCategories` (from real `Product` taxonomy), `detectMissingDocuments`, `detectExpiringDocuments`, `summarizeSellerCapabilities`, `prepareSellerReviewSummary`. **No** AI tool approves/rejects sellers or mutates bank/legal/verification data — those require a human admin.

## Commands
```
cd server
npm install
npx prisma migrate dev          # apply schema
npm run seed:admin              # ADMIN_EMAIL=… ADMIN_PASSWORD=… env required
npm run dev                     # start API on :5001
npm test                        # 22 node:test cases
```

## Implementation checklist

- [x] Auth (JWT, bcrypt, sessions, refresh, RBAC)
- [x] Supplier data model + migration (non-destructive)
- [x] Onboarding draft / resume / autosave-friendly PATCH / submit
- [x] All onboarding sections (business, legal, locations, capabilities, capacity, machinery, materials, certifications, documents, bank, quality, logistics)
- [x] Server-side completeness gate + review data
- [x] Document upload (storage abstraction, PDF support, verification)
- [x] Admin review + approve/reject/request-changes/suspend/reactivate (transactional)
- [x] Change-request → resubmit loop with history
- [x] Notifications + audit + domain events
- [x] Seller dashboard (real counts, honest empty states)
- [x] RFQ matching + scoring + AI read-only tools
- [x] Tests (22), backend verified end-to-end
- [x] Frontend: real auth client + onboarding wizard + seller dashboard + admin seller review UI

## Frontend routes

- `/seller/onboarding` — multi-step wizard (autosave draft, resume, per-section validation, review, submit, resubmit after changes).
- `/seller/dashboard` — status, verification badge, profile completion, action-required alerts, honest empty states.
- `/admin/sellers`, `/admin/sellers/:id` — list/filter + detail with approve/reject/request-changes/suspend/reactivate and document verification.
