// Provision the admin user (CLI). The actual logic lives in
// src/lib/ensure-admin.mjs and also runs automatically on every server boot,
// so this script is only needed to seed a DB without starting the app.
import { prisma } from "../src/lib/prisma.mjs";
import { ensureAdmin } from "../src/lib/ensure-admin.mjs";

const status = await ensureAdmin();
console.log(`Admin ready: ${status}`);
await prisma.$disconnect();
