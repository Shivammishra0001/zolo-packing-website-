// Restore product imagery after an ephemeral container restart.
//
// App Platform starts every deploy from the built image, so anything written
// to ./uploads is gone: the Product row survives, the file does not, and the
// storefront renders a broken image (404 on /uploads/...).
//
// The real fix is object storage (see object-storage.mjs) — once SPACES_* is
// configured this does nothing, because images then live outside the container
// entirely. Until then, the images the catalogue actually references ship in
// the repo under server/seed-images and are copied into place at boot, so a
// redeploy can no longer blank the storefront.
//
// Only copies files that are MISSING. An image uploaded through the admin UI
// after deploy is never overwritten by the seeded copy.
import { readdirSync, existsSync, copyFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UPLOADS_PATH } from "./storage.mjs";

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "seed-images");

export function restoreSeedImages() {
  // NOT skipped when object storage is enabled. Rows written before the Spaces
  // switch still carry plain "/uploads/<file>" keys, and getUrl() serves those
  // from this container's disk — which a deploy wipes. Restoring the bundled
  // copies keeps that existing catalogue rendering while new uploads go to
  // Spaces. Once every row has a "public/..." key this becomes a no-op.
  if (!existsSync(SEED_DIR)) return "no seed images bundled";

  mkdirSync(UPLOADS_PATH, { recursive: true });

  let restored = 0;
  let present = 0;
  for (const name of readdirSync(SEED_DIR)) {
    const src = join(SEED_DIR, name);
    if (!statSync(src).isFile()) continue;
    const dest = join(UPLOADS_PATH, name);
    // Never clobber a live upload with the bundled copy.
    if (existsSync(dest) && statSync(dest).size > 0) {
      present++;
      continue;
    }
    try {
      copyFileSync(src, dest);
      restored++;
    } catch {
      // A single unreadable file must not stop the server from starting.
    }
  }
  return restored > 0 ? `${restored} restored, ${present} already present` : `${present} already present`;
}
