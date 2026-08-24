// Zolo API entrypoint. The Express app is composed in src/app.mjs (modular:
// routes → services → Prisma). See docs/seller-onboarding-implementation.md.
import { createApp } from "./src/app.mjs";
import { env } from "./src/lib/env.mjs";
import { prisma } from "./src/lib/prisma.mjs";

const app = createApp();

// Verify PostgreSQL is actually reachable before accepting traffic. Starting
// "successfully" against a dead database is how a broken API ends up looking
// healthy to the frontend.
try {
  await prisma.$queryRaw`SELECT 1`;
} catch (e) {
  console.error("\n✖ Cannot connect to PostgreSQL.");
  console.error(`  ${e.message.split("\n")[0]}`);
  // Never print DATABASE_URL — it carries credentials.
  console.error("  Check that PostgreSQL is running and DATABASE_URL is correct in server/.env\n");
  process.exit(1);
}

const server = app.listen(env.port);

server.on("listening", () => {
  console.log("\n  Zolo Packing API");
  console.log(`  Environment: ${env.isProd ? "production" : "development"}`);
  console.log(`  API: http://localhost:${env.port}/api/v1`);
  console.log(`  Health: http://localhost:${env.port}/api/v1/public/health`);
  console.log("  Database: postgresql/zolo_packing (connected)\n");
});

// A port clash must fail loudly. Silently drifting to another port is what
// leaves the frontend pointed at a dead address.
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n✖ Port ${env.port} is already in use.`);
    console.error("  Another Zolo API is probably still running. Stop it with:");
    console.error(`    lsof -ti tcp:${env.port} | xargs kill\n`);
    process.exit(1);
  }
  console.error("\n✖ Server failed to start:", e.message, "\n");
  process.exit(1);
});

// Graceful shutdown: stop accepting connections, then release the DB pool.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down…`);
    server.close(async () => {
      await prisma.$disconnect().catch(() => {});
      console.log("HTTP server closed, database disconnected.");
      process.exit(0);
    });
    // Don't hang forever on a stuck keep-alive connection.
    setTimeout(() => { console.error("Forced shutdown after 10s."); process.exit(1); }, 10_000).unref();
  });
}
