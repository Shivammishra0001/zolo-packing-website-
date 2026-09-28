# Customer / Order / Payment system — audit before building

Audited 2026-09-26 against the live dev database and the running code.
**Conclusion: ~70% of the requested system already exists. This is an EXTEND
job, not a new module.** Nothing below should be rebuilt from scratch.

## What already exists and must be reused

| Concern | Existing implementation |
|---|---|
| Customer entity | **`User`** (role `buyer`). Already carries `company`, `gstin`, `pan`, `businessType`, `alternatePhone`, `industry`, `website`, `preferences`. |
| Customer addresses | `Address` (billing/shipping, `isDefault`) |
| Orders | `Order` + `OrderItem` (frozen name/sku/specs snapshot), `OrderStatusHistory` |
| Order money | integer **paise** everywhere: `subtotalMinor`, `discountMinor`, `taxMinor`, `shippingMinor`, `grandTotalMinor`, `paidMinor` |
| Payment ledger | `Payment` (many per order, `paymentNumber`, `method`, `amountMinor`, `status`, `reference`, `paidAt`) |
| Refunds | `Refund` (never deletes the original payment) |
| Payment status | `PaymentStatus` enum incl. `PARTIAL`, `PARTIALLY_REFUNDED` |
| Derived totals | `recomputeOrderPayment` logic in `services/orders.mjs:769-780` recalculates `paidMinor` from **all** Payment rows |
| Invoices | `Invoice` + gapless `InvoiceCounter` (`ZOLO/<year>/<seq>`) |
| Audit trail | `AuditLog` + `recordEvent()` in `services/events.mjs:23` (accepts a tx) |
| Notification log | `NotificationDelivery` — per-channel rows with `SENT/FAILED/SKIPPED` |
| Dispatch pipeline | `services/notification-service.mjs` `dispatch()` — admin matrix → customer prefs → email/WhatsApp/in-app |
| Email / WhatsApp | `services/email.mjs`, `services/whatsapp.mjs`, configured from the `NotificationSetting` table with env fallback |
| Admin UI | `Customers.tsx`, `CustomerDetail.tsx` (6 tabs, incl. an **Outstanding** card), `OrdersReal.tsx`, `OrderDetailReal.tsx`, `Finance.tsx`, `AuditLogs.tsx` |

## Live database state (read-only check)

```
users 4 (3 buyer, 1 admin)   customerRows 0    orders 6
orderItems 8    payments 2    refunds 0    invoices 2
addresses 3     notificationDeliveries 49   auditLogs 542
orders WITH customerId: 0 of 6
```

### The `Customer` table is dead code
`schema.prisma:49` already states *"User is the single source of truth; the
legacy `Customer` table is unused"*. The live data confirms it: **0 Customer
rows, and every order has `customerId = null`.** `newCustomerCode()`
(`lib/commerce.mjs:27`) is exported but never called.

**Decision: do NOT write to `Customer`, and do NOT add a second customer
entity.** Extend `User`. Introducing a parallel customer table is exactly the
duplication the brief forbids.

> Note: the comment at `routes/admin.mjs:97-101` says "0 rows while 564 buyers
> exist". This dev database has only 3 buyers — the 564 figure is stale.

## Real gaps (what actually has to be built)

1. **No admin customer create/update.** `POST/PATCH /admin/customers` do not
   exist; the only `user.create` is self-registration (`services/auth.mjs:100`).
   The "New Customer" dialog was deliberately deleted because it persisted
   nothing (`Customers.tsx:31-34`).
2. **No admin order create.** The sole order-creation path is
   `POST /checkout/place`, which is bound to the *buyer's own cart* and an
   `Address` the buyer owns. Unusable for an admin creating an order on
   someone's behalf.
3. **No way to record a payment.** `PATCH /admin/payments/:id` only *updates* an
   existing row. The only code that CREATES a `Payment` outside checkout is the
   PaymentRequest approve flow. There is no `POST /admin/orders/:id/payments`.
4. **Custom (non-catalog) line items** are not supported by any create path.
5. **No due date** on `Order`, so `OVERDUE` cannot be derived.
6. **`paidMinor` drifts.** Two places set it manually instead of recomputing:
   `services/orders.mjs:623` and `:1017` (COD delivered). Once partial payments
   exist these become the inconsistency source the brief warns about (§13/§20).
7. **Pending is never shown per order.** `OrderDetailReal.tsx` shows `paidMinor`
   but no balance, and renders only `order.payments[0]` instead of the ledger.
8. **Customer list is fully client-side** (fetch-all then filter/slice,
   `Customers.tsx:68-85`) — violates §6/§38/§39.
9. **No named notification templates** — every `dispatch()` caller hand-writes
   title/body (§26/§27).

## Schema changes proposed (additive only)

Nothing is dropped or renamed; every column is optional or defaulted so
existing rows stay valid.

* `Order.dueDate DateTime?` — enables `OVERDUE`.
* `Order.expectedDeliveryDate DateTime?`
* `Order.source String?` — website | admin | whatsapp | phone | offline | quote
* `Order.createdById String?` — which admin raised it (FK → User)
* `Payment.type` enum `PaymentKind { ADVANCE PARTIAL FINAL ADJUSTMENT }` default `PARTIAL`
* `Payment.notes String?`, `Payment.receivedById String?`, `Payment.proofUrl String?`
* `OrderItem.isCustomItem Boolean @default(false)` + `OrderItem.description String?`

`Order.paidMinor` is **kept** (it is already indexed/queried and recomputed in
a transaction) but every write must go through one shared
`recomputeOrderPayment(tx, orderId)` — the two manual assignments get replaced
by it, closing gap 6.

---

# Implementation — backend (phase 1)

Migration `20260926171246_crm_admin_orders_payments`. Purely additive:
`CREATE TYPE` / `ADD COLUMN` / `CREATE INDEX` / `ADD FOREIGN KEY` only — no
DROP, no data migration, all 4 users / 6 orders / 8 items / 2 payments intact.

## The one rule

**`Order.paidMinor` and `Order.paymentStatus` are DERIVED.** No caller may set
them. `recomputeOrderPayment(tx, orderId)` (`services/crm.mjs`) is the single
writer, always inside the caller's transaction. The two places in
`services/orders.mjs` that used to assign `paidMinor = grandTotalMinor` on COD
delivery now settle the payment rows and call it instead, so the stored figure
can no longer drift from the ledger.

`OVERDUE` is deliberately **not stored** — it is a function of `dueDate` and
the clock, so it is computed at read time by `derivePaymentState()`.

### Refund accounting (bug found during live testing)
The inherited logic read refunds from `Payment.status === "REFUNDED"`, which
only flips on a *full* refund. A partial refund therefore left the order
reporting the full amount as paid. Refunds are now summed from the **`Refund`
ledger** and subtracted from the receipts of payments that still count, so a
₹5,000 refund against a ₹50,000 paid order correctly yields
`paid ₹45,000 / PARTIALLY_REFUNDED`. Covered by a regression test.

## New endpoints (all `/api/v1/admin`, admin-only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/crm/customers` | server-side paginated list + derived totals |
| POST | `/crm/customers` | create a customer (no self-registration needed) |
| PATCH | `/crm/customers/:id` | edit profile |
| GET | `/crm/customers/:id/notifications` | real delivery history |
| POST | `/crm/orders` | raise an order (multi-item, optional advance) |
| POST | `/crm/orders/:id/payments` | append a payment |
| POST | `/crm/payments/:id/refund` | refund (appends, never edits) |
| GET | `/crm/payments` | paginated + searchable transactions |
| GET | `/crm/payments/summary` | receivables dashboard figures |
| GET | `/crm/outstanding` | `?bucket=overdue\|today\|week\|month\|all` |
| POST | `/crm/orders/:id/notify` | send a templated reminder/receipt |

Existing endpoints were left untouched.

## Validation (§32)
Zero/negative amounts, unknown methods, overpayment beyond the outstanding
balance (unless `allowOverpayment: true`), duplicate transaction reference on
the same order, refunds beyond the refundable remainder, empty item lists,
zero quantities, unnamed custom items, duplicate customer email/phone.
All return a friendly message plus a stable `code` — never a raw Prisma error.

## Notifications
`services/crm-notifications.mjs` adds the named templates the codebase lacked:
`ORDER_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_DUE`, `PAYMENT_OVERDUE`. They
render from real order data and go through the existing `dispatch()` pipeline,
so the admin channel matrix and customer opt-ins still apply. **Unconfigured
providers record `SKIPPED` with the reason** — verified live:
`{"email":{"status":"SKIPPED","error":"Email channel disabled by admin"},
"whatsapp":{"status":"SKIPPED","error":"WhatsApp channel disabled by admin"}}`.
Nothing is ever reported as sent when it was not.

## Tests — `server/test/crm.test.mjs`, 15/15 passing
Covers the brief's TEST 1–6 and TEST 10, plus payment validation, refund
history preservation, the partial-refund regression, the audit trail
(who created the customer/order/payment), pagination, and admin-only access.

## Still to build (phase 2 — admin UI)
Customer create/edit form; "New Order" builder with the product picker and
custom line items; the Record Payment modal; the order-detail payment ledger
and balance; the payments dashboard; outstanding/dues views; reminder buttons;
CSV export. The backend for every one of these now exists.

---

# What was built (backend phase)

Migration `20260926171246_crm_admin_orders_payments` — **additive only**
(`CREATE TYPE`, `ADD COLUMN`, `CREATE INDEX`, `ADD FOREIGN KEY`; no DROP, no
data touched). Verified before and after: 4 users / 6 orders / 8 items /
2 payments / 542 audit logs, all intact.

## `server/src/services/crm.mjs`

| Export | Purpose |
|---|---|
| `recomputeOrderPayment(tx, orderId)` | **The one place `paidMinor`/`paymentStatus` are written.** Derives them from the Payment rows + the Refund ledger. |
| `derivePaymentState(order)` | Read-time `pendingMinor` + `OVERDUE` (never stored — it depends on the clock). |
| `createCustomer` / `updateCustomer` | Admin-created customers as `User(role=buyer)`, with an optional default address in the same transaction. |
| `createOrder` | Multi-item admin order (catalog **and** custom lines), frozen snapshots, optional advance recorded as a real Payment row. |
| `addPayment` | Appends a payment; validates amount, method, overpayment and duplicate reference. |
| `refundPayment` | Appends a `Refund`; the original Payment is never deleted or reduced. |
| `listCustomers` / `listPayments` / `listOutstanding` / `paymentSummary` | Server-side paginated + DB-aggregated reads. |

## `server/src/services/crm-notifications.mjs`

Named templates (`ORDER_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_DUE`,
`PAYMENT_OVERDUE`) rendered from real order data and sent through the existing
`dispatch()` pipeline, so the admin channel matrix and customer opt-ins still
apply and every attempt lands in `NotificationDelivery`.

## Endpoints (all under `/api/v1/admin`, admin-only)

```
GET    /crm/customers                 list + derived totals (paginated)
POST   /crm/customers                 create
PATCH  /crm/customers/:id             update
GET    /crm/customers/:id/notifications
POST   /crm/orders                    create order (+ optional advance)
POST   /crm/orders/:id/payments       record a payment
POST   /crm/orders/:id/notify         send a templated message
POST   /crm/payments/:id/refund       refund
GET    /crm/payments                  transactions (paginated, searchable)
GET    /crm/payments/summary          receivables dashboard
GET    /crm/outstanding               ?bucket=overdue|today|week|month|all
```

## Two defects found and fixed along the way

1. **`paidMinor` drift.** `services/orders.mjs:623` and `:1017` assigned
   `paidMinor = grandTotalMinor` directly on COD delivery. Both now settle the
   payment rows and call `recomputeOrderPayment()`, so the stored figure can
   never disagree with the ledger.
2. **Partial refunds were invisible to the totals.** The inherited logic read
   refunds from `Payment.status === "REFUNDED"`, which only happens on a FULL
   refund. A ₹5,000 refund against a ₹20,000 payment left the order reading
   fully paid. Refunds are now summed from the `Refund` ledger
   (status `processed`), and the order falls to `PARTIALLY_REFUNDED`.
   Regression test: *"PARTIAL refund reduces paid and flips the order to
   PARTIALLY_REFUNDED"*.

## Tests — `server/test/crm.test.mjs`, 15 passing

Covers the brief's TEST 1–6 and TEST 10 plus validation, refunds, the audit
trail, pagination, notification honesty and admin-only access.

---

# UI phase

Built on the endpoints above. No new backend work; no new tables.

## New files

| File | What |
|---|---|
| `src/lib/api/admin-crm.ts` | Typed client for `/admin/crm/*`, with the shapes the server actually returns. |
| `src/admin/crm/money.ts` | Rupee ⇄ paise parsing, status tone/label vocabulary, and `friendlyError()` — the one place an API code becomes admin-facing copy (§54). |
| `src/admin/crm/CustomerFormDialog.tsx` | Add / edit customer, sectioned per §4. Only name, email and phone are required. |
| `src/admin/crm/OrderFormDialog.tsx` | The order builder: multiple lines, catalog **or** custom items, live totals, optional advance (§10–13). |
| `src/admin/crm/RecordPaymentDialog.tsx` | Record payment with the live total / paid / this / remaining panel (§46). |
| `src/admin/crm/OrderPaymentPanel.tsx` | Order-level balance + full payment ledger + reminder sender (§23). |
| `src/admin/pages/crm/CrmCustomers.tsx` | Customers list — server-side search, filters and pagination (§5, §6, §38, §39). |
| `src/admin/pages/crm/CrmPayments.tsx` | Payments dashboard: Transactions and Outstanding tabs (§21, §25). |

## Changed

* `AdminRoutes.tsx` — `/admin/customers` now renders the CRM list; new `/admin/payments`.
* `Sidebar.tsx` — Payments added between Orders and Finance.
* `CustomerDetail.tsx` — quick-action bar: Create order · Send payment request · Edit customer (§45).
* `OrderDetailReal.tsx` — the read-only payment box is replaced by `OrderPaymentPanel`.
* `components/ui.tsx` — `Select` accepts `id` (so a visible `<label htmlFor>` binds); `Dialog` accepts `size`.

## Rules the UI follows

* **Never computes money it can display from the server.** The dialogs preview
  arithmetic while typing purely to prevent mistakes; after every write the
  server's `totals` are what get shown and stored.
* **Never fakes a delivery.** `describeDispatch()` shows an *error* toast when
  every channel came back SKIPPED, naming the reason and pointing at
  Settings → Notifications. A green "Sent" appears only for a real SENT (§28).
* **Never shows a raw backend error.** `friendlyError()` maps known codes to
  plain sentences and falls back to a generic message for 5xx (§54).

## Verified

`tsc` clean · `vite build` clean · 39/39 frontend tests · 329/329 server tests.
Driven in a real browser against live data: the Record Payment dialog
(₹30,000 → ₹35,000, three ledger rows, status stayed PARTIAL) and the order
builder (₹11,250 total, ₹5,000 advance, ₹6,250 pending).

One layout bug found and fixed during that pass: the order dialog was clipped
at `max-w-md`, hiding the unit price, line total and the totals panel.

## Not built

* Product picker in the order builder — lines are free-text today. The API
  already accepts `productId`, so this is a UI addition, not a backend change.
* CSV export of customers/orders/payments (§51).
* `src/admin/pages/Customers.tsx` (the old client-side list) is now unrouted
  but left in place for comparison; delete it once the new page has been used.
