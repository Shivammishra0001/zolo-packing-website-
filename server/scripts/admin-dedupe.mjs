// EXPLICIT admin consolidation — enforce a single admin identity.
//
//   npm run admin:dedupe
//
// Keeps the canonical admin (ADMIN_EMAIL, or the built-in default) and DEMOTES
// every other role="admin" account to "buyer". It never deletes a user and
// never touches non-admin accounts, so no data is lost — extra admins are
// almost always leftover test artifacts. Run deliberately.
import { prisma } from "../src/lib/prisma.mjs";
import { adminEmail, ensureAdmin } from "../src/lib/ensure-admin.mjs";

// Make sure the canonical admin exists before demoting others.
await ensureAdmin();
const keep = adminEmail();

const extras = await prisma.user.findMany({
  where: { role: "admin", email: { not: keep } },
  select: { id: true, email: true },
});

if (extras.length === 0) {
  console.log(`Already a single admin (${keep}). Nothing to do.`);
} else {
  const res = await prisma.user.updateMany({
    where: { id: { in: extras.map((u) => u.id) } },
    data: { role: "buyer" },
  });
  console.log(`Kept admin: ${keep}`);
  console.log(`Demoted ${res.count} extra admin account(s) to buyer:`);
  for (const u of extras) console.log(`  - ${u.email}`);
}
await prisma.$disconnect();
