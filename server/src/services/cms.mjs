// Homepage merchandising as data, so changing it needs no deploy.
import { prisma } from "../lib/prisma.mjs";
import { badRequest } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";

/** Public: only active blocks, in display order. */
export const listActiveBlocks = () =>
  prisma.cmsBlock.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });

/** Admin: everything, including drafts. */
export const listAllBlocks = () => prisma.cmsBlock.findMany({ orderBy: { sortOrder: "asc" } });

/** Create or update by key — the key is the stable handle the page renders. */
export async function saveBlock(adminId, { key, title, body, payload, isActive, sortOrder }) {
  const k = String(key ?? "").trim();
  if (!k) throw badRequest("A block needs a key", "KEY_REQUIRED");

  const data = {
    title: title ?? null,
    body: body ?? null,
    payload: payload ?? {},
    isActive: isActive !== false,
    sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    updatedById: adminId,
  };
  const block = await prisma.cmsBlock.upsert({ where: { key: k }, update: data, create: { key: k, ...data } });
  await recordEvent({
    eventType: "cms.saved", actorId: adminId, entityType: "CmsBlock", entityId: block.id, metadata: { key: k },
  });
  return block;
}

export async function deleteBlock(adminId, key) {
  const existing = await prisma.cmsBlock.findUnique({ where: { key } });
  if (!existing) return null;
  await prisma.cmsBlock.delete({ where: { key } });
  await recordEvent({
    eventType: "cms.deleted", actorId: adminId, entityType: "CmsBlock", entityId: existing.id, metadata: { key },
  });
  return existing;
}
