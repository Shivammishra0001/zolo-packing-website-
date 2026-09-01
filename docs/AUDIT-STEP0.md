# ZOLO Packaging — Full Application Audit (STEP 0)

Date: 2026-08-31 · Scope: entire repo (frontend `src/`, backend `server/`, config/build/deploy) · Read-only; no code changed.

Verification performed: 5 parallel deep code audits (backend, frontend, seller/admin, end-to-end flow tracing, config/deploy), plus `npm run typecheck` (PASS, 0 errors) and the backend integration suite `npm --prefix server test` (218/219 PASS — real HTTP tests against real Postgres).

---

## 1. Actual architecture (corrections to assumptions)

| Assumed | Reality |
|---|---|
| NestJS backend | **Plain Express 5** (`.mjs` ESM) + Prisma 6 + **PostgreSQL** (`server/src/app.mjs`) |
| Payment gateway | **None.** Only offline methods: `cod / neft / cheque / bank_transfer` (`server/src/lib/validation.mjs:223`). "PAID" is admin-asserted or COD-on-delivery. The admin Settings "Razorpay" toggle is a fake `useState` switch. |
| AI recommendation | **No LLM anywhere.** `server/src/services/ai-*.mjs` is rule-based filename/keyword matching, honestly disclosed in the admin UI. There is **no buyer-facing AI packaging recommender at all.** |
| OTP / phone verification | Does not exist. Phone **login** works (password-based, `server/src/services/auth.mjs:19-26,140-155`); no verification, no password reset. |

**Auth (well built):** 15-min HS256 JWT bound to a DB `Session` via `sid`, checked on every request (immediate logout); rotating refresh tokens with reuse detection revoking the family; role read from the DB row, never the JWT; login/register/refresh rate-limited; email **and** phone login both work end to end. Tokens are stored in `localStorage` (`zolo.store.*`, `zolo.seller.*`) — bearer-token architecture, no cookies (`credentials:false`).

**Money:** integer paise everywhere; no floats for money. **Server is the source of truth for pricing:** `placeOrderSchema` accepts no money fields; totals/coupons/tiers/commission computed inside the placement transaction; stock decrement uses a race-safe conditional `updateMany({stock:{gte:qty}})` with an in-transaction ledger row. Client price tampering on the cart path: **not possible** (verified).

**Deploy:** DigitalOcean App Platform, single Node process (`server.mjs`) serving both API and SPA on :8080; docker-compose (postgres + api + nginx) for local only. No secrets in git (verified via `git ls-files` + history grep).

---

## 2. What genuinely works end to end (verified)

- Registration (buyer & seller), login by email or phone, session restore, cross-tab logout, refresh rotation.
- Product browse/detail (data layer), cart CRUD, address book, checkout quote → place (COD), coupons, idempotent-ish placement, stock decrement + ledger.
- Buyer order list/detail/invoice/tracking/payments/dashboard (all real APIs, ownership-scoped).
- RFQ creation + supplier auto-matching (backend), RFQ status machine, quotation accept/reject **backend** (expiry, double-accept, ownership all enforced), negotiation-thread **backend** with correct 2-party authorization.
- Seller onboarding wizard (business info, documents, bank, submit/resubmit, change requests) and admin seller approval/rejection/KYC verification.
- Admin: dashboard/analytics, customers (read), orders (list/detail/status transitions/invoice), catalog CRUD + bulk import + image upload, RFQ list (read), inventory levels/ledger (read), audit activity API.
- Shipment/order status machines server-side (forward-only, COD settles on delivery); 219-case integration suite.

## 3. The core structural finding

**The backend is substantially ahead of the frontend.** Most "broken features" are one of:
1. A working backend endpoint with **no UI caller** (seller RFQ inbox/quoting, negotiation chat, payouts, commissions, CMS, shipment events, notifications, refunds, price tiers).
2. A real UI that is **unreachable** (buyer `MyQuotations.tsx` shadowed by a route interception) while a **mock page** with empty arrays and fake-success toasts renders in its place.
3. A handful of genuine backend security/integrity bugs (open catalog API, quotation-order gaps, MOQ).

`src/admin/mock-data.ts` / `mock-data-ext.ts` export **empty arrays**; every page still importing them renders permanently empty (or crashes).

---

## 4. Findings by severity

### CRITICAL

| # | Finding | Evidence |
|---|---|---|
| C1 | **Entire product/category/upload write API is unauthenticated.** Anyone on the internet can create/edit/delete/bulk-import products, set any field, delete categories, upload files. Deliberate (comment "kept OPEN…") but untenable. | `server/src/app.mjs:141-142`; `server/src/routes/products.mjs:44-250` (11 endpoints, no guards) |
| C2 | **Mass assignment on product update** — raw body spread into `prisma.product.update`; anonymous caller can set `basePriceMinor`, `stock`, `commissionBps`, `costMinor`, `sellerId`. Price-manipulation path even though checkout prices server-side. | `routes/products.mjs:80-91` |
| C3 | **Unauthenticated, unthrottled file upload** to container disk (content-validated but no auth, no rate limit, served statically). | `routes/products.mjs:174-178`; `lib/storage.mjs:54-60` |
| C4 | **KYC documents (PAN/GST PDFs) publicly readable** — 403 PDFs sit in `uploads/public/`, served with no auth; pre-split uploads never migrated to the private tree. | `server/src/lib/storage.mjs:25-31`; `app.mjs:103`; `scripts/migrate-uploads-split.mjs:34-45` |
| C5 | **Buyer quotation UI unreachable; RFQ flow dead-ends.** `App.tsx:794` intercepts `/account/*` → mock `buyer/pages/Quotations.tsx` (empty data, toast-only accept/cancel). The real `MyQuotations.tsx` (calls `rfqApi.accept/respond`) is dead code at `App.tsx:836`. Buyers can never see or accept a quote. | `src/App.tsx:794,836`; `src/buyer/BuyerRoutes.tsx:28`; `src/buyer/pages/Quotations.tsx:104-116`; `src/admin/mock-data.ts:28` |
| C6 | **Seller portal has 3 routes** (login/dashboard/onboarding); RFQ inbox, quote submission, decline, negotiation, orders, fulfilment, product/inventory/pricing management **do not exist in the UI**. Backend for leads/quoting/payouts exists unused. | `src/seller/SellerRoutes.tsx:37-43`; `server/src/routes/rfq.mjs:83-99`; `routes/seller.mjs:111` |
| C7 | **Admin cannot create/send a quotation** — `/admin/quotes/:id` reads empty mocks ("not found" always); `adminRfqApi.createQuotation` has zero call sites; buyer-side accept exists for quotes no one can create. | `src/admin/pages/QuotationDetail.tsx:16,65,305,331`; `src/lib/api/rfq.ts:165-171` |
| C8 | **Seller fulfilment missing at every layer** — no seller order/shipment endpoint, no UI; only admin can create shipments, and the admin UI can't either (H10). | `server/src/routes/` (absence); `SellerRoutes.tsx` |
| C9 | **`Details.tsx` calls hooks after a conditional early return** → guaranteed "more hooks than previous render" crash when a guest logs in from the product page. | `src/pages/Details.tsx:70-93` |
| C10 | **Admin "Sign out" doesn't sign out** — handler is `nav("/")`; tokens remain, session restores. | `src/admin/components/Topbar.tsx:381-389` |
| C11 | **`/admin/procurement` throws on render** (`suppliers[0].id` on empty mock array); linked from the dashboard. | `src/admin/pages/Procurement.tsx:100`; `mock-data-ext.ts:33` |

### HIGH

| # | Finding | Evidence |
|---|---|---|
| H1 | **Quotation→order skips inventory, Payment, Invoice, StatusHistory and commission.** Marketplace orders oversell silently, show as permanently unpaid, have no invoice, and settle at **0% commission** (`payouts` sums `item.commissionMinor`). | `server/src/services/rfq.mjs:360-441` vs `orders.mjs:182-279`; `payouts.mjs:79` |
| H2 | **MOQ never enforced server-side** (schema default 500; only a client-side input clamp). 1-unit orders of MOQ-500 products succeed. | `lib/validation.mjs:182-190`; `services/cart.mjs:56-94`; `orders.mjs:47-85` |
| H3 | **Quotation version history has no ownership check** — any authenticated user (rival seller) can read a quote's full price ladder by ID. | `routes/rfq.mjs:102-104`; `services/marketplace.mjs:277-279` |
| H4 | **Public product API returns every column** incl. `costMinor` (internal cost) and `commissionBps`, plus draft/archived rows; `?includeDeleted=1` open to all. | `routes/products.mjs:26-42` |
| H5 | **Four admin roles are one superuser** — `requireAdmin` is the only gate; `verification_admin` can pay payouts, refund, flip payment status. Frontend inversely **locks the 3 sub-roles out** by collapsing them to `buyer`. | `middleware/auth.mjs:10,77-81`; `src/lib/auth/service.ts:135` |
| H6 | **Buyer cancellation never cancels the invoice** — `order.invoice` tested without being `include`d (always undefined). Finance keeps counting cancelled orders' receivables. | `services/orders.mjs:395,416` (admin path at `:489` is correct) |
| H7 | **Admin Shipping cannot ship** — "Book Shipment" and "Label" are toasts; no UI exists for `POST /admin/shipments/:id/events`, so the buyer tracking timeline can never advance. Admin timeline is fabricated client-side and contradicts the buyer's real one. | `src/admin/pages/Shipping.tsx:15-34,193,203`; `routes/admin.mjs:158-168` |
| H8 | **Notifications written on every event, displayed nowhere** — bell reads empty mocks; storefront has no bell. | `routes/notifications.mjs`; `src/admin/components/Topbar.tsx:25,123` |
| H9 | **Boot-time double-refresh race logs valid users out** — module-load `hydrateCart()` and `AuthProvider` both refresh concurrently; rotation invalidates the second attempt → `tokenStore.clear()`. | `src/lib/cart-store.ts:145`; `src/lib/api/client.ts:57-99`; `AuthContext.tsx:149-172` |
| H10 | **401 in `client.ts` wipes both portals' storage without updating React state** — UI stays "authenticated" against empty storage; kills seller session from a storefront tab. | `client.ts:99-100`; `session-keys.ts:41-45` |
| H11 | **Product pages auth-walled + bounce logged-in users during session restore**; with no SSR this means zero crawlable/shareable product URLs. | `Details.tsx:58-68` |
| H12 | **Checkout shows ₹0 and keeps "Place order" enabled when the quote call fails** (silent `.catch(()=>{})` ×3). | `checkout/CheckoutPayment.tsx:25,76-84`; `CheckoutReview.tsx:34`; `CartPage.tsx:34` |
| H13 | **Contact form is a no-op with a "Sent!" state** — the marketplace's main lead form (target of Get Quote + 9 footer links) discards every enquiry. | `src/pages/Contact.tsx:29-34` |
| H14 | **Fake-success writes across ~12 admin modules and buyer Settings** — incl. "Password updated" with no request, "Product archived" with no API call, CMS/Settings/Marketing/Finance/Reports/Artwork/Production/Procurement toast-only saves. Real CMS API (`/admin/cms`) exists unused. | `buyer/pages/Settings.tsx:118-131`; `admin/pages/ProductDetail.tsx:229`; `admin/pages/Settings.tsx:52`; `CMS.tsx:93-220`; +more |
| H15 | **Stale `useMemo` deps blank three real-data admin pages** — Finance, Shipping, AuditLogs fetch real rows but memos omit them from deps → tables render empty / KPIs 0. | `Finance.tsx:68,73`; `Shipping.tsx:111,120`; `AuditLogs.tsx:43-66` |
| H16 | **Uploads on ephemeral disk in production** — every product image/KYC doc destroyed on redeploy; DB rows keep dangling references. | `lib/storage.mjs:12,27-28`; `.do/app.yaml` (no volume) |
| H17 | **Root `.dockerignore` doesn't exclude `.env`/`server/.env`** — `Dockerfile.spa-only` bakes real secrets into the image. | `.dockerignore:1-7`; `Dockerfile.spa-only:22` |
| H18 | **No security headers on the production path** (helmet absent; nginx headers are local-only). No CSP/HSTS/X-Frame-Options. | `server.mjs`; `app.mjs` |
| H19 | **No password reset / account recovery of any kind** ("Forgot password?" is a toast). | `LoginForm.tsx:80-88`; `routes/auth.mjs` (absence) |
| H20 | **No 404 route; dead `/shop` links (×4); listing shows "No products found" on API failure**; infinite "Loading your cart…" on network error. | `App.tsx:826-858`; `Listing.tsx:45,388`; `cart-store.ts:44-48` |
| H21 | **`catalog-api.ts` sends no auth token** for admin catalog writes (paired with C1 — fix together). Optimistic writes never roll back on failure. | `src/lib/catalog-api.ts:104-116`; `catalog-store.ts:124-137` |
| H22 | **1.5 MB single JS chunk** (three.js + xlsx + all three portals shipped to every visitor) + **76 MB unoptimized images**, multi-MB PNGs statically imported. | `dist/assets`; `vite.config.ts`; `pages/Categories.tsx:11-66` |

### MEDIUM (grouped)

- **Commerce integrity:** order idempotency is query-then-insert with no unique constraint (racy) — `orders.mjs:149-158`; frontend mints a new idempotency key per remount (`CheckoutPayment.tsx:22`); FAILED payment neither restocks nor cancels (`orders.mjs:643`); `OrderItem.taxMinor` hardcoded 0 (`orders.mjs:239`); reserved stock ignored by the atomic guard (`orders.mjs:29,184`); quotation-orders lack ship name/phone/line1 (`rfq.mjs:388-391`); reconcile fails to detect off-ledger stock writes (failing test `inventory-ledger.test.mjs:115`).
- **Duplicated business logic (drift risk):** GST 18% + ₹5 shipping + free-ship threshold re-implemented in the browser (`cart-store.ts:15-16,70-90` vs `commerce.mjs:8-11,59-68`); order transition table copied (`order-status.ts:51-62`); a browser-only quotation cost/margin engine with hardcoded ₹8 paper/22% margin/15% floor (`QuotationDetail.tsx:39-75`); three contradictory free-shipping thresholds (₹10,000 topbar / ₹1,000 cart-store / ₹250 Details / ₹25,000 admin Settings).
- **Fabricated storefront data:** every product shows rating "4.6 (24)" hardcoded (`lib/products.ts:64-65`) and it's a filter/sort dimension; "Bestseller" = `basePrice >= 40` (`products.ts:67`); fictitious named testimonials + "2,400+ solutions / 180+ countries" claims (`Home.tsx:42-59`); "In stock" always rendered even when out of stock (`Details.tsx:298-300`); Finance GST tab invents 42%/62% ratios; Marketing shows an invented referral leaderboard.
- **Schema/DB:** missing indexes (`OrderItem.productId`, `Quotation.supplierId`, `AuditLog` JSON-path idempotency lookup = seq scan per checkout, `Product(deletedAt,status)`); `Int` money caps at ₹21.47 crore; `PaymentStatus` has both `PAID` and `SUCCESS`; free-string `paymentMethod`/`courier`/`refType`; dead `Customer` model (0 rows vs 564 buyers).
- **Auth/session:** logout endpoint unauthenticated + unrate-limited (`routes/auth.mjs:32-35`); no timeout on boot `/auth/me` → permanently blank portal if API hangs (`AuthContext.tsx:166`); dead legacy auth writing `localStorage["user"]` (`App.tsx:710-738`); double-mounted guards (`App.tsx:796` + `BuyerRoutes.tsx:23`); two disconnected admin sessions on `/admin/sellers` (`AdminGate` vs `AdminGuard`); Google-login stub.
- **Admin chrome:** dead `/admin/audit-logs` links; six `?new=1` quick actions no page reads; inert date-range selector; global search over empty mocks; 6 routed modules missing from the sidebar; unrouted duplicate `Orders/OrderDetail` page pairs in both admin and buyer; buyer code importing admin mock stores; client-generated `PRD-####` IDs (800-value space) sent as primary keys.
- **Ops/deploy:** in-process rate limiting (breaks at >1 instance); 15 MB global JSON body limit incl. anonymous routes; `BANK_ENC_KEY` never strength-checked; broken image paths (`EcoRewards.tsx:269,426` → 404 → HTML served to `<img>`); `.env.production.example` silently gitignored; DOCKER.md/README drift; no CI/lint; `vite-plugin-singlefile` dead dependency.
- **SEO (absent):** one static title/description for all routes; no `document.title` writes, no OG/Twitter/canonical/JSON-LD, no robots.txt/sitemap, no prerender/SSR — zero product indexability.

### LOW

Artwork upload silently discarded from RFQs (only filename sent, no size check); fabricated delivery ETA + "Total paid" for COD on the success page; wishlist is unsynced React state; `href="#"` social/legal links; metric cards linking to `#`; bcrypt cost 10; JWT verify doesn't pin `algorithms` (defence-in-depth only); `Math.random` payout numbers; anonymous unknown `/api/v1/*` returns 401 not 404; toast timer without unmount cleanup; duplicated `ApiError` classes; supplier-matching failures silent to everyone; "AI" naming for rule-based logic; O(n²) "latest" sort; seller-onboarding machinery/materials APIs with no wizard step; misc (see agent traces).

---

## 5. Development plan (dependency order)

**STEP 1 — Backend security lockdown** (blocks everything; the platform is publicly writable today)
Guard the products/categories/uploads router (`authenticate` + `requireAdmin`), replace mass-assignment with an explicit zod-whitelisted update schema, add a public read `select` (hide `costMinor`/`commissionBps`/drafts, gate `includeDeleted`), fix quotation-history ownership, move stray KYC PDFs out of `uploads/public` + verify against `SupplierDocument`, add security headers to `app.mjs`/`server.mjs`, strength-check `BANK_ENC_KEY`, fix `.dockerignore`, rate-limit anonymous write/upload paths. Frontend pair: `catalog-api.ts` attaches the admin bearer token. Extend the test suite to assert 401/403 on tokenless catalog writes.

**STEP 2 — Frontend auth/session correctness**
Single-flight refresh shared across clients + defer module-load hydrations behind auth-ready (fixes the logout-on-boot race); make 401 cleanup notify `AuthContext`; real admin sign-out; map the four admin roles correctly client-side (and decide per-role backend gates); fix `Details.tsx` hook order + remove the product-page auth wall; delete dead legacy auth in `App.tsx`; add a 404 route; fix `/shop` links; boot-fetch timeout.

**STEP 3 — Commerce integrity (backend)**
MOQ enforcement in cart + checkout; bring `acceptQuotation` to parity with `placeOrder` (stock decrement + ledger, Payment, Invoice, StatusHistory, commission snapshot, full shipping address requirement); fix buyer-cancel invoice branch; per-line `taxMinor`; DB-backed idempotency (unique constraint) + stable client key; reserved-stock-aware guard; fix the failing reconcile drift test. Tests for each.

**STEP 4 — Buyer RFQ/quotation UI (make the marketplace usable for buyers)**
Route the real `MyQuotations` page (remove the `/account` interception shadow or fold it into `BuyerRoutes`), retire the mock Quotations page, fix the post-RFQ redirect, build the negotiation-chat UI on the existing authorized `/rfqs/:id/messages` API, wire quote history.

**STEP 5 — Seller portal (make the marketplace usable for sellers)**
RFQ inbox + quote submission + decline + negotiation on the existing `/sellers/rfqs*` APIs; payouts view (`/sellers/me/payouts`). Then seller fulfilment, which needs new backend (seller-scoped order/shipment endpoints) — the only step requiring significant new server code.

**STEP 6 — Admin operability**
Fix the three stale-memo pages (Finance/Shipping/AuditLogs); wire Book Shipment + shipment events UI (backend exists — this is what makes buyer tracking move); admin quotation create/send UI on `adminRfqApi.createQuotation`; notifications bell on `/notifications`; fix Procurement crash (or park the module honestly); connect CMS page to the real `/admin/cms` API; replace fake-success toasts with real calls or honest "coming soon" states; surface payouts/commission/refund/tier endpoints in the UI.

**STEP 7 — Storefront honesty & UX**
Contact form backed by a real endpoint; buyer Settings password change (+ backend `POST /auth/change-password`); remove fabricated ratings/bestseller/testimonials or back them with data; reconcile the free-shipping threshold to one server-sourced value; fix stock display; checkout error states (no ₹0 order placement); cart loading/error states; debounce cart quantity.

**STEP 8 — Production hardening & growth**
Durable object storage for uploads (DO Spaces/S3); route-level code splitting + image optimization; SEO layer (per-page titles/meta, JSON-LD, sitemap/robots, prerender for product pages); password reset flow; CI running typecheck + server tests; per-admin-role authorization; missing DB indexes; rate-limit store decision.

Rationale for the order: 1 closes the open-door vulnerabilities; 2 makes sessions trustworthy so every later flow can be tested logged-in; 3 makes order data correct before more orders flow through; 4–6 connect the existing backend to real UI (highest value per line changed); 7–8 polish and scale.
