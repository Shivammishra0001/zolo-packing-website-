// Domain events + audit trail + notifications — a single cohesive service so
// every state change leaves a consistent, queryable record.
//
// SECURITY: metadata must never contain secrets/PII (bank numbers, passwords,
// document storage keys). Callers pass only safe descriptive fields.
import { prisma } from "../lib/prisma.mjs";

const SENSITIVE_KEYS = ["password", "passwordHash", "accountNumber", "accountNumberEnc", "storageKey", "token", "tokenHash"];

function scrub(metadata = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s.toLowerCase()))) continue;
    clean[k] = v;
  }
  return clean;
}

/**
 * Record a domain event to the audit log. Accepts an optional Prisma tx client
 * so it participates in the caller's transaction.
 */
export async function recordEvent(
  { eventType, actorId = null, organizationId = null, entityType = null, entityId = null, metadata = {} },
  tx = prisma,
) {
  return tx.auditLog.create({
    data: { eventType, actorId, organizationId, entityType, entityId, metadata: scrub(metadata) },
  });
}

/** Create a notification for a single user. */
export async function notify({ userId, type, title, body = null, entityType = null, entityId = null }, tx = prisma) {
  return tx.notification.create({ data: { userId, type, title, body, entityType, entityId } });
}

/** Notify every user holding one of the given roles (e.g. admins on submission). */
export async function notifyRoles(roles, payload, tx = prisma) {
  const users = await tx.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
  if (users.length === 0) return [];
  return Promise.all(users.map((u) => notify({ ...payload, userId: u.id }, tx)));
}
