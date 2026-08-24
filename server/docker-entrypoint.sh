#!/bin/sh
# Runs on API container start: apply migrations, then launch the server.
# No demo/test data is seeded — the database starts empty. Provision your own
# admin with: docker compose exec api npm run seed:admin  (ADMIN_EMAIL/PASSWORD env)
set -e

echo "→ Applying database migrations…"
npx prisma migrate deploy

echo "→ Starting Zolo API…"
exec node index.mjs
