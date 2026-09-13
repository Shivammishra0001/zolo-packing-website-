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
    // The first address of a kind becomes that kind's default automatically,
    // so a customer never ends up with addresses but no default for checkout.
    const existingOfKind = await tx.address.count({ where: { userId, kind: data.kind } });
    if (existingOfKind === 0) data.isDefault = true;
    // A newly-defaulted address demotes the previous default of the same kind.
    if (data.isDefault) {
      await tx.address.updateMany({ where: { userId, kind: data.kind }, data: { isDefault: false } });
    }
    return tx.address.create({ data });
  });
}

/** Make one owned address the default for its kind (billing or shipping). */
export async function setDefaultAddress(userId, id) {
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Address not found");
  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({
      where: { userId, kind: existing.kind, id: { not: id } },
      data: { isDefault: false },
    });
    return tx.address.update({ where: { id }, data: { isDefault: true } });
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
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Address not found");
  return prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });
    // Deleting the default must not leave the kind with no default: promote
    // the most recently added remaining address of that kind.
    if (existing.isDefault) {
      const next = await tx.address.findFirst({
        where: { userId, kind: existing.kind },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { deleted: true };
  });
}

// Fetch an address the caller owns, or throw. Used by checkout for snapshots.
export async function requireOwnedAddress(userId, id) {
  const address = await prisma.address.findFirst({ where: { id, userId } });
  if (!address) throw notFound("Address not found");
  return address;
}
