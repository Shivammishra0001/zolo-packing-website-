# ADR-001: Supplier-owned catalog products

**Status:** Accepted
**Date:** 2026-10-30
**Deciders:** Shivam (owner/developer)

## Context

Zolo Packaging today is a **house catalog**: all 516 products have
`sellerId = null`, and the admin is the only party who creates products.
Suppliers register, submit an application, get approved — and then can do
nothing except look at a dashboard of locked tiles.

The decision taken was to let suppliers own catalog products: a supplier lists
a product, the admin approves the listing, and it appears in the storefront.
That turns Zolo from a shop into a marketplace, which is a bigger change than
the UI section the request originally described.

### What already exists

| Fact | Where | Consequence |
|---|---|---|
| `Product.sellerId String?` → **User** | `schema.prisma:604` | A per-product owner slot exists and is unused (0/516). |
| `SupplierProfile.organizationId` → **Organization** | `schema.prisma` | The approved entity is an ORG, not a user. **There is no direct Product→SupplierProfile join.** |
| `OrganizationMember` joins User ↔ Organization | 226 rows | The bridge exists, but it is many-to-many. |
| `ProductStatus = draft \| active \| archived` | `schema.prisma` | **No "awaiting review" state.** |
| Storefront shows `status === "active"` only | `src/lib/products.ts:47` | Anything not `active` is already invisible to buyers. |
| `Product.commissionBps Int?` | `schema.prisma:666` | Marketplace economics are already modelled per product. |
| Admin writes **strip** `sellerId` | `routes/products.mjs:155` | Ownership cannot currently be set or moved by accident. |
| `OrderItem` snapshots name/price/commission | `schema.prisma` | A supplier editing a product never restates past orders. |

### Forces

1. **Ownership must survive staff churn.** A supplier is a company. If the
   employee who listed a product leaves and their user is deactivated,
   the company must not lose the listing.
2. **Nothing unreviewed may reach buyers.** The storefront must not become
   publishable by anyone who completes a registration form.
3. **History must not move.** Orders snapshot their lines, and that must hold
   when a supplier edits or withdraws a product.
4. **No regression for the house catalog.** 516 products with `sellerId = null`
   must keep working exactly as they do now.

## Decision

Attach product ownership to the **supplier organisation**, not to the user who
typed the form, and add an explicit review state to `ProductStatus`.

1. Add `Product.supplierProfileId String?` → `SupplierProfile` (nullable;
   null = house catalog, which is every existing row).
2. Keep `Product.sellerId` as the *submitting user* for attribution only. It is
   already nullable with `onDelete: SetNull`, so a departing employee nulls the
   attribution without touching ownership.
3. Add `pending_review` to `ProductStatus`. The storefront filter
   (`status === "active"`) already excludes it, so no buyer-facing code changes.
4. Supplier writes go through a **seller-scoped** service that force-sets
   `supplierProfileId` from `req.supplierProfile` and `status` to
   `pending_review` — never from the request body.

## Options considered

### Option A — Use the existing `sellerId` (User) as owner

| Dimension | Assessment |
|---|---|
| Complexity | Low — no migration |
| Correctness | **Poor** |
| Scalability | Breaks with >1 staff member |

**Pros:** Zero schema change; the column already exists and is indexed.

**Cons:** Ownership is a *person*, not the approved company. A supplier with an
owner plus two staff gets three disjoint product sets. Deactivating a leaver
(`onDelete: SetNull`) silently converts their listings into house catalog.
Admin can't answer "show me everything from this supplier" without walking
`OrganizationMember`, and the answer changes as staff come and go.

### Option B — `supplierProfileId` on Product (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Medium — one additive migration |
| Correctness | Good |
| Scalability | Survives staff changes |

**Pros:** Ownership sits on the entity the admin actually approves. The admin
supplier page becomes a single indexed query. `sellerId` is kept for "who
submitted this", which is genuinely useful in an audit. Purely additive: every
existing row stays `null` = house catalog.

**Cons:** Two owner-ish columns invite confusion; the distinction
(organisation = owner, user = submitter) must be documented and enforced in
one service, not scattered across routes.

### Option C — Separate `SupplierListing` table

| Dimension | Assessment |
|---|---|
| Complexity | **High** |
| Correctness | Good |
| Scalability | Good |

**Pros:** Cleanest separation; a listing could carry supplier-specific pricing
and MOQ independent of a shared product definition. This is what a multi-seller
marketplace (several suppliers offering the *same* SKU) eventually needs.

**Cons:** Everything that reads products — storefront, search, cart, RFQ,
import, CRM order builder — would need to understand two shapes. Zolo does not
yet have the multi-seller-per-SKU problem this solves. Premature.

## Trade-off analysis

The real choice is **A vs B**: whether ownership is a person or a company.

Zolo's supplier onboarding approves a **company** — legal name, GSTIN, PAN,
bank account, documents. Approval is granted to `SupplierProfile`. Hanging the
products off a `User` means the thing that was approved and the thing that owns
the products are different entities, and they drift the moment staff change.
The low cost of A is a loan against that drift.

C is correct for a later Zolo and wrong for this one: it pays a large,
immediate integration cost across every product consumer to solve a problem
(many suppliers, one SKU) that does not exist yet. B does not block C — a
future `SupplierListing` can carry the same `supplierProfileId`.

The `pending_review` state is not really a choice. The alternative — publishing
on submit and relying on the admin to archive bad listings — makes the
storefront publishable by any registrant, which fails force #2.

## Consequences

**Easier**
- "Show this supplier's products" is one indexed query on the approved entity.
- Admin moderation is a status filter, reusing the existing catalog screens.
- Supplier staff can be added/removed without touching listings.

**Harder**
- Two ownership-ish columns need a single documented rule, enforced in one
  service. Admin routes must keep stripping both from client input.
- Every "is this visible?" path must now consider `pending_review`. The
  storefront is safe by construction (`=== "active"`), but admin counts,
  facets and the importer need an explicit decision per call site.
- **Every supplier edit to an approved listing returns it to
  `pending_review`** (decided). The listing leaves the storefront until an
  admin re-approves. Simple to reason about and impossible to game; the cost
  is that a typo fix also needs a re-approval, so the moderation queue must be
  quick to work through.

**To revisit**
- If two suppliers ever need to offer the same SKU, revisit Option C.
- **Commission is admin-only, set at approval** (decided). Suppliers never
  send `commissionBps`; the seller service strips it like the admin routes
  already do. If approving every listing by hand becomes a bottleneck, revisit
  a configurable default rate.

## Action items

1. [ ] Migration: add `Product.supplierProfileId` + index; add `pending_review`
       to `ProductStatus`. Additive only — no backfill, no data touched.
2. [ ] `services/seller-products.mjs`: list/create/update/withdraw, always
       scoped to `req.supplierProfile`; force `supplierProfileId` and
       `pending_review`; never trust body-supplied ownership or status.
3. [ ] Admin: moderation queue (approve → `active`, reject → `draft` + reason)
       and a Products section on the supplier detail page.
4. [ ] Seller UI: "My products" list + create/edit form, gated by
       `RequireApproved`.
5. [ ] Tests: ownership cannot be forged; a supplier sees only their own
       products; submitted products never reach the storefront before approval;
       the 516 house-catalog rows are unaffected.
