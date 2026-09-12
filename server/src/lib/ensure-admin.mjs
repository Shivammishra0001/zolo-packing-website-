// Ensure an admin account always exists.
//
// Called on every server boot (index.mjs) so a fresh deploy ALWAYS has a
// working admin login without any manual seed step, and reused by the
// `seed:admin` CLI. Idempotent and safe to run repeatedly.
//
// Two modes, in priority order:
//   1. ENV OVERRIDE — if ADMIN_EMAIL + ADMIN_PASSWORD are set, upsert that
//      account and reset its password to the env value (env always wins).
//   2. BUILT-IN DEFAULT — otherwise ensure a permanent default admin EXISTS so
//      a fresh deploy has a login WITHOUT any env vars. Create-if-missing: it
//      never resets the password of an admin that already exists, so a password
//      changed in the app is preserved across redeploys.
//
// SECURITY: the default password is NEVER stored in the repo as plaintext —
// only its bcrypt hash is baked in below.
import { prisma } from "./prisma.mjs";
import { hashPassword } from "./crypto.mjs";

const DEFAULT_ADMIN = {
  email: (process.env.DEFAULT_ADMIN_EMAIL || "superadmin@zolopackaging.com").trim().toLowerCase(),
  passwordHash: "$2b$10$zsXNaEVjj7lKjEb2XdZ8zutoemx7QGfYvG37FMnWST8oRFa2cCxmW", // bcrypt of the shared default password
  role: "admin",
};

/**
 * Provision/repair the admin account. Returns a short status string.
 * Never throws in a way that should stop the server — callers on boot should
 * still wrap it, but the DB work here is minimal and idempotent.
 */
export async function ensureAdmin() {
  const envEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD || "";
  const envRole = process.env.ADMIN_ROLE || "admin";

  if (envEmail && envPassword) {
    const passwordHash = await hashPassword(envPassword);
    const user = await prisma.user.upsert({
      where: { email: envEmail },
      update: { role: envRole, isActive: true, passwordHash },
      create: { email: envEmail, passwordHash, firstName: "Zolo", lastName: "Admin", role: envRole },
    });
    return `env override → ${user.email} (role=${user.role})`;
  }

  const existing = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN.email }, select: { id: true, role: true, isActive: true } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email: DEFAULT_ADMIN.email,
        passwordHash: DEFAULT_ADMIN.passwordHash,
        firstName: "Zolo",
        lastName: "Admin",
        role: DEFAULT_ADMIN.role,
      },
    });
    return `default admin created → ${user.email}`;
  }
  if (existing.role !== "admin" || !existing.isActive) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "admin", isActive: true } });
    return `default admin repaired → ${DEFAULT_ADMIN.email}`;
  }
  return `default admin present → ${DEFAULT_ADMIN.email}`;
}
