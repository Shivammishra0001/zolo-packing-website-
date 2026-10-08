# Zolo Packaging

B2B packaging marketplace: a customer storefront, a seller portal and an admin
console over one Express + Prisma + PostgreSQL API.

- **Frontend** — React 19 + Vite 7 + TypeScript (`src/`)
- **API** — Express 5 (ESM) + Prisma 6 + PostgreSQL 16 (`server/`)

## Running it locally

**Two processes must run: the Vite frontend AND the API.** `npm run dev` starts
only the frontend, which then has nothing to talk to — every sign-in shows
"Can't reach the server", because the browser is calling
`http://localhost:5001` and nothing is listening there.

Start both with one command:

```bash
npm run dev:all        # API on :5001 + frontend on :5173
```

Or in two terminals, if you want their logs separate:

```bash
npm run server         # terminal 1 — API on :5001
npm run dev            # terminal 2 — frontend on :5173
```

### First-time setup

```bash
npm install                            # also installs server/ deps
cp server/.env.example server/.env     # then fill in the values
npm --prefix server run db:migrate     # create the schema
```

`server/.env` needs at minimum `DATABASE_URL`, `JWT_SECRET` and
`BANK_ENC_KEY`; the template documents every variable the code actually reads.
The API refuses to start in production with a missing or placeholder
`JWT_SECRET` — that is deliberate.

### Signing in as admin

One canonical admin is ensured at every boot from `ADMIN_EMAIL` /
`ADMIN_PASSWORD` in `server/.env`. It is **idempotent and never overwrites an
existing password**, so changing it in the app sticks across restarts. The boot
log tells you which account it found:

```
Admin: admin present (password preserved) -> superadmin@zolopackaging.com
```

## Is it actually up?

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/v1/public/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/v1/public/ready
```

- `health` answers even when the database is down — it proves the process is alive.
- `ready` queries PostgreSQL, so **503 means the database is unreachable** while
  200 means the API can serve data.

That pair is the fastest triage in this repo:

| Symptom | Meaning |
| --- | --- |
| Connection refused | the API is not running — use `npm run dev:all` |
| `ready` 503 | API up, database unreachable (check `DATABASE_URL`) |
| `ready` 200 but routes 500 | schema not migrated — run `db:migrate` |

## Checks

```bash
npm run typecheck              # tsc, no emit
npm run build                  # production frontend build
npm --prefix server test       # API test suite
```

The server suite runs serially (`--test-concurrency=1`): the tests share one
database, so running them in parallel lets one suite's fixtures perturb
another's assertions.

## Conventions worth knowing before you change code

- **Money is always integer minor units (paise)** — `*Minor` columns, never
  floats. Forms take rupees and convert on the way in; only the formatter
  converts back.
- **Commission is integer basis points** (`800` = 8.00%) and is *snapshotted*
  onto each order line, so repricing a product later never restates a
  historical payout.
- **Order and quotation lines snapshot their product details.** A catalogue
  rename or reprice must not retroactively change what was quoted or agreed.
- **Identity comes from the session, never the request body.** A seller's
  `supplierId` is resolved from `req.supplierProfile`; buyer-owned records are
  queried as `{ id, userId }` and return **404, not 403**, for someone else's
  row — the API never confirms that another user's record exists.
- **No mock or fabricated data on production paths.** A failed fetch must
  surface as an error, not as an empty list that reads like "no records".

## Known limitation: uploaded files are not durable in production

`server/src/lib/storage.mjs` writes uploads to `./uploads` on the container's
own disk, and DigitalOcean App Platform containers are **ephemeral** - every
deploy, restart or scale event starts from the built image. Files uploaded
through the admin UI are therefore lost on the next deploy: the database row
survives, the file does not, and the product renders a broken image with a
`404` on `/uploads/...`.

Recognising it: if `/uploads/<a current filename>` returns 200 while older
ones 404, this is the cause - not a routing or CORS fault. The epoch-ms prefix
in the filename tells you when it was uploaded; compare that to the last
deploy.

Before relying on admin image uploads, move them to DigitalOcean Spaces
(S3-compatible, survives deploys, and works with more than one instance, which
local disk does not) or mount a volume at the uploads path. Until then, commit
product imagery to the repo so it ships with the build.

## Importing the historical order book

The trading record from the operations spreadsheet (May-Oct 2026: customers,
orders, and the payment ledger) is loaded by:

```
cd server
npm run import:legacy          # dry run - reports what it would create
npm run import:legacy -- --yes # perform the import
```

**The data file is not in this repository and must not be.** It holds real
customer names, company names and mobile numbers, and this repo is public -
git history is permanent, so committing it would publish personal contact
details irreversibly. `server/data/legacy-orders.json` is gitignored; keep it
locally and run the import against whichever database you are targeting.
`server/data/legacy-orders.example.json` documents the file's shape with
fictional data.

The importer is **idempotent**: every order it creates is tagged
`[legacy:ORD001]` in `Order.notes` and every customer gets a deterministic
`@legacy.zolopacking.invalid` address, so a second run creates nothing. It is
safe to re-run after a partial failure.

Two things it deliberately does not do. It creates no catalog `Product` rows -
these are bespoke print jobs described by a free-text name, not SKUs anyone can
reorder, so each line is a custom order item. And it skips the vendor-payment
and salary sheets, which are accounts-payable records the schema has no model
for.

Reconciliation is the subtle part. The spreadsheet records money twice: a
per-order "Amount Received" column, and a dated receipts sheet whose entries
are per **customer account**, not per order - one of Rahul Dangi's payments
settles two orders at once. The importer pools each customer's receipts and
allocates them oldest-order-first, then reports every place the two sources
disagree rather than silently picking one.

## Deployment

DigitalOcean App Platform via `.do/app.yaml`, one process serving both halves
(`server.mjs`): the API at `/api/v1` and the built SPA in front of it.
Migrations run at startup, so a new database is never left empty. See
`DATABASE.md` for the migration runbook.
