# Running Zolo with Docker

One command brings up **everything** — PostgreSQL, the API (migrations applied automatically), and the frontend. The database starts empty; you create your own accounts and products.

## Prerequisite (one time)

Install **Docker Desktop** for Mac: https://www.docker.com/products/docker-desktop/
Open it once so the Docker engine is running (whale icon in the menu bar).

## Start

```bash
cd /Users/mac/Downloads/zolo_packing-main
docker compose up --build
```

First run builds the images (a few minutes). Subsequent runs are fast:

```bash
docker compose up
```

When you see `Zolo API on http://localhost:5001` and nginx started, open:

- Storefront → http://localhost:5173
- Seller portal → http://localhost:5173/seller/login
- Admin seller review → http://localhost:5173/admin/sellers
- API health → http://localhost:5001/api/v1/health

## Accounts (create your own)

The database starts **empty** — no demo users, suppliers, or products.

- **Seller account** — sign up at http://localhost:5173/seller/login ("Become a Supplier").
- **Admin account** — provision one with the seed-admin script (credentials from env):

  ```bash
  docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='YourPass@123' api npm run seed:admin
  ```

  Then sign in at http://localhost:5173/admin/sellers with those credentials.

## Everyday commands

```bash
docker compose up -d        # start in the background
docker compose logs -f api  # watch API logs
docker compose down         # stop everything (keeps the database)
docker compose down -v      # stop AND wipe the database volume
docker compose up --build   # rebuild after code changes
```

## Why this fixes the "Could not connect" error

The API and its database now live in containers that start together and stay up
as long as the stack is running — you can't forget to start Postgres or the API.
The frontend talks to the API at `http://localhost:5001`, which your browser
reaches via the port Docker publishes.

## Notes

- Data persists in the `zolo_pgdata` volume across restarts. `down -v` clears it
  (and the next `up` re-seeds the test users).
- The secrets in `docker-compose.yml` are **dev-only** — change `JWT_SECRET` and
  `BANK_ENC_KEY` before deploying anywhere real.
- Prefer running without Docker? See the two-terminal instructions in the repo
  (`npm run dev` in `server/`, then `npm run dev` at the root).
