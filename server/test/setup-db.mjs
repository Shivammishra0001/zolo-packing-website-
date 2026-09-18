// Preloaded by `npm test` (node --import). Points the test process at a
// SEPARATE database so the suite never writes into the development data.
//
//   TEST_DATABASE_URL   explicit test database (optional)
//   otherwise           DATABASE_URL with the database name suffixed `_test`
//                       e.g. …/zolo_packing  →  …/zolo_packing_test
//
// `npm test` runs test/prepare-db.mjs first (pretest) to create/migrate it.
// Runs before any module that instantiates the Prisma client, which reads
// DATABASE_URL at construction time.
export function testDatabaseUrl(env = process.env) {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — tests need a database");
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, "");
  if (!name) throw new Error("DATABASE_URL has no database name");
  if (name.endsWith("_test")) return url;
  u.pathname = `/${name}_test`;
  return u.toString();
}

if (!process.env.__ZOLO_TEST_DB_SET) {
  process.env.DATABASE_URL = testDatabaseUrl();
  // Uploaded files go to a separate tree too, so a cleanup of the
  // development uploads can never delete files the test database references.
  process.env.UPLOADS_DIR ??= new URL("../uploads-test", import.meta.url).pathname;
  process.env.__ZOLO_TEST_DB_SET = "1";
}
