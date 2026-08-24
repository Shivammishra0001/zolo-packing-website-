// Notification read/ack for the authenticated user.
import { prisma } from "../lib/prisma.mjs";
import { notFound, forbidden } from "../lib/http.mjs";

export async function list(userId, { unreadOnly } = {}) {
  const where = { userId };
  if (unreadOnly) where.status = "UNREAD";
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notification.count({ where: { userId, status: "UNREAD" } }),
  ]);
  return { items, unread };
}

export async function markRead(userId, id) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) throw notFound("Notification not found");
  if (n.userId !== userId) throw forbidden();
  return prisma.notification.update({ where: { id }, data: { status: "READ" } });
}

export async function markAllRead(userId) {
  await prisma.notification.updateMany({ where: { userId, status: "UNREAD" }, data: { status: "READ" } });
  return { ok: true };
}
