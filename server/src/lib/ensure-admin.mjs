// Ensure the single permanent admin exists — idempotent and NON-DESTRUCTIVE.
//
// Runs on every server boot (both entrypoints) and from `npm run seed:admin`.
// Contract (protected core — see the admin-protection rules):
//   - CREATE-IF-MISSING only. If the admin already exists, its password is
//     NEVER touched, so adding features / restarting / re-seeding can never
//     change the admin password. Use `npm run admin:reset` to change it on
//     purpose.
//   - Exactly ONE admin identity, keyed by the canonical email (ADMIN_EMAIL, or
//     the built-in default). No API path can create or escalate to admin — the
//     seed is the only admin-creation path.
//   - The default password lives ONLY as a bcrypt hash in the repo; env
//     ADMIN_PASSWORD (backend-only) is used solely to CREATE a first admin.
//
// Safe to run once, 10 times or 100 times: it never creates a duplicate admin
// and never resets a password.
import { prisma } from "./prisma.mjs";
import { hashPassword } from "./crypto.mjs";

const DEFAULT_ADMIN = {
  email: (process.env.DEFAULT_ADMIN_EMAIL || "superadmin@zolopackaging.com").trim().toLowerCase(),
  passwordHash: "$2b$10$zsXNaEVjj7lKjEb2XdZ8zutoemx7QGfYvG37FMnWST8oRFa2cCxmW", // bcrypt of the shared default password
};

/** The canonical admin email this deployment uses. */
export function adminEmail() {
  const env = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || "";
  return env && pw ? env : DEFAULT_ADMIN.email;
}

/**
 * Provision the permanent admin if (and only if) it does not exist yet.
 * Returns a short status string. Never overwrites an existing password.
 */
export async function ensureAdmin() {
  const envEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD || "";
  const useEnv = Boolean(envEmail && envPassword);
  const email = useEnv ? envEmail : DEFAULT_ADMIN.email;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, isActive: true },
  });

  let status;
  if (existing) {
    // Keep the account and its password. Only guarantee it can still sign in
    // as an active admin (never a password change).
    if (existing.role !== "admin" || !existing.isActive) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: "admin", isActive: true } });
      status = `admin ensured (role/active repaired, password preserved) → ${email}`;
    } else {
      status = `admin present (password preserved) → ${email}`;
    }
  } else {
    const passwordHash = useEnv ? await hashPassword(envPassword) : DEFAULT_ADMIN.passwordHash;
    await prisma.user.create({
      data: { email, passwordHash, firstName: "Zolo", lastName: "Admin", role: "admin" },
    });
    status = `admin created → ${email}`;
  }

  // Visibility guard: warn (never auto-delete) if more than one admin exists,
  // e.g. left over from test runs. Use `npm run admin:dedupe` to consolidate.
  const adminCount = await prisma.user.count({ where: { role: "admin" } });
  if (adminCount > 1) status += ` [warning: ${adminCount} admin accounts exist — run "npm run admin:dedupe" to keep only ${email}]`;

  return status;
}
