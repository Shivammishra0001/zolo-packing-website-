// EXPLICIT admin password reset — run ONLY when you intend to change it.
//
//   npm run admin:reset                 # reset to ADMIN_PASSWORD from the env
//   npm run admin:reset -- "NewPass@1"  # reset to a password given on the CLI
//
// This is the ONLY code path that changes the admin password. The boot seed
// never does (create-if-missing only), so normal development can never reset it.
import { prisma } from "../src/lib/prisma.mjs";
import { hashPassword } from "../src/lib/crypto.mjs";
import { adminEmail } from "../src/lib/ensure-admin.mjs";

const email = adminEmail();
const cliPassword = process.argv[2];
const password = cliPassword || process.env.ADMIN_PASSWORD || "";

if (!password) {
  console.error("Refusing to reset: no password given. Pass one on the CLI or set ADMIN_PASSWORD.");
  await prisma.$disconnect();
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const user = await prisma.user.upsert({
  where: { email },
  update: { passwordHash, role: "admin", isActive: true },
  create: { email, passwordHash, firstName: "Zolo", lastName: "Admin", role: "admin" },
});
// Never print the password.
console.log(`Admin password reset for ${user.email} (role=${user.role}).`);
await prisma.$disconnect();
