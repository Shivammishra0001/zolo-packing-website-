// DigitalOcean Spaces (S3-compatible) backend for storage.mjs.
//
// WHY THIS EXISTS: App Platform containers have an EPHEMERAL filesystem. Files
// written to ./uploads are gone on the next deploy, restart or scale event —
// the database keeps the row, the file does not, and the storefront renders a
// broken image (404 on /uploads/...). Local disk also is not shared between
// instances, so it cannot work at more than one instance regardless.
//
// Enabled only when SPACES_* is fully configured. With it unset, storage.mjs
// keeps using local disk, which is correct for development and for the test
// suite — neither should need cloud credentials.
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const endpoint = process.env.SPACES_ENDPOINT?.trim();
const region = process.env.SPACES_REGION?.trim();
const bucket = process.env.SPACES_BUCKET?.trim();
const accessKeyId = process.env.SPACES_KEY?.trim();
const secretAccessKey = process.env.SPACES_SECRET?.trim();

/** True only when every required value is present — a partial config is a misconfiguration, not a fallback. */
export const isEnabled = Boolean(endpoint && region && bucket && accessKeyId && secretAccessKey);

/**
 * Public CDN base. Spaces serves a bucket at both the origin and a CDN
 * hostname; the CDN one is preferred for product images. Falls back to the
 * origin so a missing SPACES_CDN_ENDPOINT degrades rather than breaks.
 */
const publicBase = (
  process.env.SPACES_CDN_ENDPOINT?.trim() ||
  (endpoint && bucket ? endpoint.replace("://", `://${bucket}.`) : "")
).replace(/\/+$/, "");

let client = null;
function s3() {
  if (!client) {
    client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      // Spaces uses virtual-hosted style like S3; forcePathStyle would 404.
      forcePathStyle: false,
    });
  }
  return client;
}

/**
 * Upload bytes and return the storage key.
 *
 * `visibility` mirrors the local public/private split: public objects are
 * world-readable so <img> works for anonymous visitors, private objects are
 * NOT — they are streamed by an authorized route via readPrivate(), exactly as
 * KYC documents are on disk today.
 */
export async function putObject({ key, mime, buffer, visibility = "public" }) {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
      ACL: visibility === "public" ? "public-read" : "private",
      // Content-addressed names mean a given key never changes contents.
      CacheControl: visibility === "public" ? "public, max-age=31536000, immutable" : "no-store",
    }),
  );
  return key;
}

/** Public URL for a key. Private keys must never be passed here. */
export const objectUrl = (key) => `${publicBase}/${key}`;

export async function getObject(key) {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function deleteObject(key) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** One-line summary for the boot log, so the active backend is never a guess. */
export const describe = () =>
  isEnabled ? `Spaces ${bucket} @ ${region}` : "local disk (EPHEMERAL — files are lost on redeploy)";
