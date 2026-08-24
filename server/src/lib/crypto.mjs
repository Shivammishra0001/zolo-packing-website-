// Cryptographic primitives: password hashing, JWT, refresh-token hashing, and
// AES-256-GCM field encryption for sensitive values (bank account numbers).
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, createCipheriv, createDecipheriv, createHash as sha } from "node:crypto";
import { env } from "./env.mjs";

const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Short-lived access token. Payload carries only identity + role (no secrets).
export const signAccessToken = (payload) =>
  jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtAccessTtl });

export const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);

// Opaque refresh token; only its sha256 hash is stored (Session.tokenHash).
export const newRefreshToken = () => randomBytes(32).toString("hex");
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// --- AES-256-GCM field encryption -------------------------------------------
// Derive a fixed 32-byte key from the configured secret so any length works.
const encKey = sha("sha256").update(env.bankEncKey).digest();

export function encryptField(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptField(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
