# Memory

Working memory for Zolo Packaging. Everything here was verified against the
running code or database, not assumed.

## Me

Shivam (`bhupendra.mishra@gmail.com`) — building and operating Zolo Packaging,
a B2B packaging marketplace, as both developer and business owner.

## The product

Zolo Packaging: a B2B packaging marketplace with three portals over one API —
a customer storefront, a seller portal and an admin console, plus a new
mobile field-sales portal.

| Thing | Where |
|---|---|
| Live site | `zolopacking.com` (and `zolopacking-y8sk3.ondigitalocean.app`) |
| Repo | `github.com/Shivammishra0001/zolo-packing-website-` |
| Host | DigitalOcean App Platform, one process serving API + SPA |

## Stack

React 19 + Vite 7 + TypeScript · Express 5 (ESM) + Prisma 6 + PostgreSQL 16.
NOT Next.js, NOT NestJS, NOT Drizzle — briefs sometimes arrive written for
those stacks and have to be translated.

## Conventions that bite

| Rule | Why it matters |
|---|---|
| Money is integer **minor units** (paise), `*Minor` columns | A float anywhere drifts every total |
| Commission is integer **basis points** (800 = 8.00%) | Same reason |
| Order/quote lines **snapshot** product details | A later rename or reprice must not restate history |
| Identity comes from the **session**, never the request body | A seller must not act as a rival |
| Foreign records return **404, not 403** | Never confirm someone else's record exists |
| No mock data on production paths | A failed fetch must read as an error, not an empty list |

Profit comes from `OrderItem.unitCostMinor`, a snapshot frozen at placement
like the price and commission beside it. It is **nullable on purpose**: null
means "cost unknown", which is not zero cost. `profitSummary()` therefore
reports its own `coverageBps` — the share of revenue that actually has cost
data — and the dashboard shows that next to the margin. A margin over 13% of
the book must never be presented as if it described all of it.

Three salesperson relationships, never merged: `Order.salespersonId` (who
CAPTURED the order — revenue credit), `User.capturedById` (who OWNS the
account) and `Payment.receivedById` (who physically took the money). A
customer owned by one rep can have an order captured by another, so adding
"their customers' orders" to "their orders" double-counts the sale.

The financial report is one row per order LINE. Line money (Qty/Rate/Sale/
Cost/Profit) sums down the column; ORDER money (Received/Balance) appears only
on the order's first row, so a SUM never multiplies one receipt by the line
count. A blank there means "see the first row", never zero.

A PARTIAL refund leaves its Payment row `PAID` and lives in the Refund ledger.
`recomputeOrderPayment` counts receipts from PAID/SUCCESS rows and subtracts
processed refunds against them, so flipping the row to PARTIALLY_REFUNDED
drops it out of receipts and zeroes the order. Every refund path must call
`recomputeOrderPayment` — two of them did not, and 20 orders drifted.

Recording a payment takes `SELECT ... FOR UPDATE` on the order first.
Without it two concurrent requests both pass the overpayment check.

Field names that have caught me out: `Order.placedAt` (not `createdAt`), CRM
custom lines use `itemName` (not `productName`), and CRM requires an explicit
`unitPriceMinor` rather than defaulting to catalog price.

## Running it

Two processes. `npm run dev` starts ONLY Vite, and the sign-in then fails with
"Can't reach the server" because nothing is on :5001.

```
npm run dev:all          # API :5001 + frontend :5173
npm --prefix server test # 343 tests, serial (--test-concurrency=1)
```

Triage: `/api/v1/public/health` 200 but `/ready` 503 = database unreachable;
both 200 but routes 500 = schema not migrated.

## Operational truths

- **Container storage is ephemeral.** Uploads written to local disk are deleted
  on every deploy — this is why product images 404. Spaces fixes it, once the
  env vars are set.
- **The admin seed never overwrites an existing password.** Deliberate, so a
  password changed in the app survives deploys. Recovery needs
  `ADMIN_PASSWORD_RESET=1`.
- **Production and local are different databases** (72 vs 56 products), so
  local credentials say nothing about production ones.
- **Production has been frozen since 27 Aug 2026** — the deploy webhook is not
  firing. Pushing more commits does not help.

## Preferences

- Verify before claiming. Run the thing, read the output, then report.
- Say plainly when something cannot be done rather than implying it was.
- Keep destructive operations behind an explicit flag, and back up first.
