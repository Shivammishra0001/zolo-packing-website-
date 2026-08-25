# Zolo Packing — Database

PostgreSQL 16 via **Prisma 6**. The database is the single source of truth for the
commerce domain; the legacy MongoDB backend has been decommissioned.

## Stack

| Concern | Choice |
|---|---|
| Engine | PostgreSQL 16 |
| ORM / migrations | Prisma (`server/prisma/schema.prisma`) |
| Client | Single shared `PrismaClient` — `server/src/lib/prisma.mjs` |
| API | Express 5 (ESM), `server/src/app.mjs` |
| Validation | Zod (`server/src/lib/validation.mjs`) |
| Auth | JWT access + rotating refresh sessions (bcrypt hashes) |

## Conventions

- **Money is an integer in minor units (paise).** Never a float. `basePriceMinor = 0`
  means *quotation-based*, and must never render as ₹0.
- **Timestamps** are `timestamptz`, stored UTC.
- **Snapshots:** order/quotation line items freeze product name, SKU and price so
  historical records survive later catalog edits.
- **Append-only:** history, ledger and audit tables are never cascade-deleted.
- **Soft delete** (`deletedAt`) only where a real archive is needed — products,
  categories, customers, coupons. Orders, payments and audit logs stay immutable.

## Domains (40 tables)

- **Identity** — `User`, `Session`, `Organization`, `OrganizationMember`
- **Supplier onboarding** — `SupplierProfile` + `SupplierLocation`, `Capability`,
  `Capacity`, `Machine`, `Material`, `Certification`, `Document`, `BankAccount`,
  `Quality`, `Logistics`, `StatusHistory`, `ChangeRequest`
- **Catalog** — `Product`, `Category`, `ProductAiAnalysis`
- **Customers** — `Customer`, `Address`
- **Commerce** — `Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `Review`
- **Orders** — `Order`, `OrderItem`, `OrderStatusHistory`, `Invoice`, `InvoiceCounter`
- **Money** — `Payment`, `Refund`, `Coupon`, `CouponRedemption`
- **Fulfilment** — `Shipment`, `ShipmentEvent`
- **Platform** — `Notification`, `AuditLog`

## Local setup

```bash
# 1. PostgreSQL 16 (Homebrew)
brew services start postgresql@16
createdb zolo_packing

# 2. Configure
cd server && cp .env.example .env    # then fill in real values

# 3. Schema + client
npm install
npm run db:migrate
npm run db:seed                      # admin user from ADMIN_* env vars

# 4. Run
npm run dev                          # API on :5001
```

Or the whole stack in one command — Postgres, API and web:

```bash
docker compose up
```

> If Postgres refuses to start with `lock file "postmaster.pid" already exists`,
> the pid file is stale. Confirm no postgres process owns that PID
> (`ps -p <pid>`), then remove `/usr/local/var/postgresql@16/postmaster.pid`.

## Environment variables

Server-side only — **never expose these to the frontend bundle.**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required. |
| `PORT` | API port (default 5001) |
| `JWT_SECRET` | Access/refresh token signing. Required in production. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL_DAYS` | Token lifetimes |
| `BANK_ENC_KEY` | Exactly 32 bytes — AES-256-GCM for bank account fields |
| `UPLOADS_BASE_URL` | Public base URL for uploaded files |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_ROLE` | Consumed by `db:seed` |

`server/src/lib/env.mjs` fails fast on missing secrets in production.
`.env` is git-ignored; `.env.example` is the committed template.

## Commands

```bash
npm run db:migrate         # create + apply a migration (dev)
npm run db:migrate:deploy  # apply pending migrations (production)
npm run db:status          # show migration state
npm run db:generate        # regenerate Prisma client
npm run db:seed            # idempotent admin upsert
npm run db:studio          # browse data
npm test                   # 37 integration tests against a real database
```

There is intentionally **no `db:reset` script** — this database holds real data.
To reset a scratch database, run `prisma migrate reset` explicitly against a
`DATABASE_URL` you have confirmed is disposable.

## Transactions

Order placement is one atomic `prisma.$transaction`: validate cart → lock stock
rows → verify availability → price server-side → validate coupon → create order,
items (snapshotted), payment, status history → decrement stock → redeem coupon →
clear cart. Any failure rolls the whole thing back — there is never an order
without its items, stock movement or payment row. Cancellation restores stock in
the same way. Covered by tests: idempotency, oversell, rollback, coupon single-use.

## Security

- All queries go through Prisma (parameterized — no string-built SQL).
- Passwords are bcrypt hashes; bank account numbers are AES-256-GCM encrypted and
  returned masked.
- Totals are always computed server-side; client-supplied prices are ignored.
- Ownership and role checks live in `server/src/middleware/auth.mjs`.
- Errors are normalized in `server/src/lib/http.mjs` — no stack traces in responses.
- Secrets, tokens and `DATABASE_URL` are never logged.

## Backup & restore

**Not currently automated — this must be configured before production launch.**

```bash
pg_dump -Fc zolo_packing > zolo_$(date +%F).dump   # backup
pg_restore -d zolo_packing_restore zolo_2026-08-20.dump   # restore (verify first)
```

For production, use the managed provider's automated backups plus PITR, verify
restores on a schedule, and keep credentials least-privilege.

## Deployment

Deploy target is DigitalOcean App Platform (`.do/app.yaml`); Docker images exist
for API (`server/Dockerfile`) and web (`Dockerfile.web`). The app needs only
`DATABASE_URL` plus the secrets above. Never hand-edit production tables.

Migrations now run as part of the App Platform build:

```
build_command: npm run build && npm run migrate:deploy
```

`prisma migrate deploy` is production-safe and idempotent — it applies pending
migrations in order and never resets, drops or rewrites data. A deploy with
nothing pending is a no-op. It needs `DATABASE_URL` at BUILD time, so that
variable is scoped `RUN_AND_BUILD_TIME`.

### Symptom: every data route 500s, health still 200

```
PrismaClientKnownRequestError  code: P2021
The table `public.User` does not exist in the current database.
```

The database is reachable but has no tables — it was created and never
migrated. `/api/v1/public/health` still returns 200 because it never touches
the database; `/api/v1/public/ready` returns 200 too (it connects fine). That
combination — ready 200, `/products` 500 — means *schema missing*, as opposed
to ready 503 which means *cannot connect*.

Fix it by applying the existing migrations. From a machine with the production
connection string exported:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:25060/DB?sslmode=require'
npm run migrate:status   # inspect first — reports pending migrations
npm run migrate:prod     # applies them
npm run migrate:status   # expect "Database schema is up to date!"
```

`migrate:prod` wraps `migrate deploy` with guards: it refuses to run without
`DATABASE_URL`, refuses a localhost target unless `ALLOW_LOCAL_MIGRATE=1`, and
can only ever invoke `migrate deploy` — never `reset` or `db push`. It also
neutralises `server/.env`, which Prisma otherwise auto-loads and which would
**override** the URL you exported and silently migrate the dev database.

Never run `prisma migrate reset` or `db push --force-reset` against production.
