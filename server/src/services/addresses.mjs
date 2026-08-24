// Address book service. Addresses belong to a user; only the owner can read or
// mutate them (enforced by always scoping queries to req.user.id).
import { prisma } from "../lib/prisma.mjs";
import { notFound } from "../lib/http.mjs";

const normalizePhone = (s) => (s ? String(s).replace(/\D/g, "").slice(-10) : s);

export const listAddresses = (userId) =>
  prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });

export async function createAddress(userId, input) {
  const data = { ...input, phone: normalizePhone(input.phone), userId };
  return prisma.$transaction(async (tx) => {
    // A newly-defaulted address demotes the previous default of the same kind.
    if (data.isDefault) {
      await tx.address.updateMany({ where: { userId, kind: data.kind }, data: { isDefault: false } });
    }
    return tx.address.create({ data });
  });
}

export async function updateAddress(userId, id, input) {
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Address not found");
  const data = { ...input };
  if (data.phone) data.phone = normalizePhone(data.phone);
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.address.updateMany({
        where: { userId, kind: data.kind ?? existing.kind, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.address.update({ where: { id }, data });
  });
}

export async function deleteAddress(userId, id) {
  const res = await prisma.address.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw notFound("Address not found");
  return { deleted: true };
}

// Fetch an address the caller owns, or throw. Used by checkout for snapshots.
export async function requireOwnedAddress(userId, id) {
  const address = await prisma.address.findFirst({ where: { id, userId } });
  if (!address) throw notFound("Address not found");
  return address;
}
