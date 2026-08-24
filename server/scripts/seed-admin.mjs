// Provision a single admin user. Credentials come from env (never hardcoded).
// Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-admin.mjs
import { prisma } from "../src/lib/prisma.mjs";
import { hashPassword } from "../src/lib/crypto.mjs";

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
const role = process.env.ADMIN_ROLE || "admin";

if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment.");
  process.exit(1);
}

// Idempotent: upsert keyed on the unique email. Re-running promotes/reactivates
// and resets the password to the supplied value — never creates a duplicate.
const passwordHash = await hashPassword(password);
const user = await prisma.user.upsert({
  where: { email },
  update: { role, isActive: true, passwordHash },
  create: { email, passwordHash, firstName: "Zolo", lastName: "Admin", role },
});
console.log(`Admin ready: ${user.email} (role=${user.role})`);
await prisma.$disconnect();
