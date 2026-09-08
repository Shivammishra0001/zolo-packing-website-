// Provision the admin user.
//
// Two modes, in priority order:
//   1. ENV OVERRIDE — if ADMIN_EMAIL + ADMIN_PASSWORD are set, upsert that
//      account and reset its password to the env value (env always wins).
//   2. BUILT-IN DEFAULT — otherwise ensure a permanent default admin EXISTS so
//      a fresh deploy always has a working login WITHOUT any env vars. This
//      path is create-if-missing: it never resets the password of an admin that
//      already exists, so a password you change in the app is preserved across
//      redeploys.
//
// SECURITY: the default password is NEVER stored in the repo as plaintext —
// only its bcrypt hash is baked in below. Anyone who can read this file still
// cannot read the password, only verify a guess against the hash. Rotate it
// (change the password in-app, or set ADMIN_PASSWORD once) for a real
// production system, and keep the repo private.
import { prisma } from "../src/lib/prisma.mjs";
import { hashPassword } from "../src/lib/crypto.mjs";

// Baked-in default admin. Password: bcrypt hash only (plaintext lives nowhere
// in the codebase). Set DEFAULT_ADMIN_EMAIL to change the default address.
const DEFAULT_ADMIN = {
  email: (process.env.DEFAULT_ADMIN_EMAIL || "superadmin@zolopackaging.com").trim().toLowerCase(),
  passwordHash: "$2b$10$zsXNaEVjj7lKjEb2XdZ8zutoemx7QGfYvG37FMnWST8oRFa2cCxmW", // bcrypt of the shared default password
  role: "admin",
};

const envEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const envPassword = process.env.ADMIN_PASSWORD || "";
const envRole = process.env.ADMIN_ROLE || "admin";

if (envEmail && envPassword) {
  // Mode 1 — env override: upsert and reset password to the env value.
  const passwordHash = await hashPassword(envPassword);
  const user = await prisma.user.upsert({
    where: { email: envEmail },
    update: { role: envRole, isActive: true, passwordHash },
    create: { email: envEmail, passwordHash, firstName: "Zolo", lastName: "Admin", role: envRole },
  });
  console.log(`Admin ready (env): ${user.email} (role=${user.role})`);
} else {
  // Mode 2 — built-in default: create only if this admin doesn't exist yet.
  // Never touches an existing account's password.
  const existing = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN.email }, select: { id: true, role: true } });
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
    console.log(`Admin ready (default, created): ${user.email} (role=${user.role})`);
  } else {
    // Ensure it can always sign in as an admin, but keep its current password.
    if (existing.role !== "admin") {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "admin", isActive: true } });
    }
    console.log(`Admin ready (default, exists): ${DEFAULT_ADMIN.email}`);
  }
}

await prisma.$disconnect();
