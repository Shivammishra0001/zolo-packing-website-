// A buyer's reusable requirement profiles, so a repeat order does not mean
// re-entering every spec. Scoped to the owner throughout: a foreign id returns
// null and the route 404s rather than confirming it exists.
import { prisma } from "../lib/prisma.mjs";
import { badRequest } from "../lib/http.mjs";

export const listMine = (userId) =>
  prisma.savedRequirement.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });

export async function save(userId, { name, notes, items }) {
  const label = String(name ?? "").trim();
  if (!label) throw badRequest("Give this requirement a name", "NAME_REQUIRED");
  if (!Array.isArray(items) || items.length === 0) throw badRequest("Save at least one line", "ITEMS_REQUIRED");
  return prisma.savedRequirement.create({
    data: { userId, name: label, notes: notes ?? null, items },
  });
}

export async function remove(userId, id) {
  // Delete scoped by userId so one buyer cannot remove another's profile.
  const res = await prisma.savedRequirement.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
