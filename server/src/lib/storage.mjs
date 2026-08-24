// Storage abstraction. Business logic depends on this interface, not on a
// provider. Today it writes to local disk under ./uploads and returns an opaque
// storageKey; swapping in S3/GCS later means reimplementing put/getUrl/remove
// without touching callers.
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { env } from "./env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "..", "..", "uploads");

// Two classes of file, with different access rules:
//
//   public/  product images. The storefront renders these in <img> tags for
//            anonymous visitors, so they are served as static files.
//
//   private/ KYC documents (GST, PAN, bank proof). These must NEVER be
//            reachable without authentication. They are streamed by
//            GET /documents/:id/file, which checks ownership first.
//
// The split is enforced by the directory a file is written to, so a caller
// cannot accidentally publish a document by choosing the wrong URL.
const PUBLIC_DIR = join(UPLOADS_DIR, "public");
const PRIVATE_DIR = join(UPLOADS_DIR, "private");
mkdirSync(PUBLIC_DIR, { recursive: true });
mkdirSync(PRIVATE_DIR, { recursive: true });

// Only the public subtree is ever mounted as static files.
export const UPLOADS_PATH = PUBLIC_DIR;
export const PRIVATE_UPLOADS_PATH = PRIVATE_DIR;

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const supportedMime = (mime) => Boolean(EXT_BY_MIME[mime]);

const safeName = (name) =>
  name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9_-]/g, "-").slice(0, 60) || "file";

function makeKey(name, ext) {
  return `${Date.now()}-${randomBytes(8).toString("hex")}-${safeName(name)}.${ext}`;
}

/**
 * Persist a PUBLIC file (product imagery). Returns an opaque storageKey.
 * Never pass a KYC document here — use putPrivate().
 */
export function put({ name, mime, buffer }) {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`Unsupported file type ${mime}`);
  const key = makeKey(name, ext);
  writeFileSync(join(PUBLIC_DIR, key), buffer);
  return key;
}

/**
 * Persist a PRIVATE file (KYC document). The returned key is NOT addressable
 * over HTTP: there is no static mount for this directory, so the only way to
 * read the bytes back is through an authorized route calling readPrivate().
 */
export function putPrivate({ name, mime, buffer }) {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`Unsupported file type ${mime}`);
  const key = makeKey(name, ext);
  writeFileSync(join(PRIVATE_DIR, key), buffer);
  return key;
}

/** Public URL for a public storageKey. */
export const getUrl = (storageKey) => `${env.uploadsBaseUrl}/${storageKey}`;

/**
 * Resolve a private key to an absolute path, refusing anything that escapes the
 * private directory. `storageKey` reaches us from the database rather than the
 * network, but a traversal guard here means a future caller cannot turn this
 * into an arbitrary-file-read.
 */
export function privatePath(storageKey) {
  const resolved = resolve(PRIVATE_DIR, String(storageKey ?? ""));
  if (resolved !== join(PRIVATE_DIR, String(storageKey ?? "")) || !resolved.startsWith(PRIVATE_DIR + sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

/** Read a private file's bytes. Callers MUST authorize before calling this. */
export function readPrivate(storageKey) {
  const p = privatePath(storageKey);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

export function remove(storageKey) {
  // A key may live in either subtree; remove whichever exists.
  for (const dir of [PUBLIC_DIR, PRIVATE_DIR]) {
    const p = join(dir, storageKey);
    if (existsSync(p)) unlinkSync(p);
  }
}
