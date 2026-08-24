// Zolo API — composed Express app (exported for tests; started by index.mjs).
// Preserves the original product/upload contract and adds auth, seller
// onboarding, admin review, notifications — all on Express + Prisma + Postgres.
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.mjs";
import { env, isAllowedOrigin } from "./lib/env.mjs";
import { ok, wrap, errorHandler } from "./lib/http.mjs";
import { UPLOADS_PATH } from "./lib/storage.mjs";
import { authenticate, requireAdmin, requireSeller, requireBuyer, loadSupplierOrg } from "./middleware/auth.mjs";
import { authRouter } from "./routes/auth.mjs";
import { productsRouter } from "./routes/products.mjs";
import { sellerRouter } from "./routes/seller.mjs";
import { adminRouter } from "./routes/admin.mjs";
import { notificationsRouter } from "./routes/notifications.mjs";
import { cartRouter } from "./routes/cart.mjs";
import { addressRouter } from "./routes/addresses.mjs";
import { orderRouter } from "./routes/orders.mjs";

export function createApp() {
  const app = express();
  // `trust proxy: true` trusts an unlimited chain of X-Forwarded-For hops,
  // which makes req.ip attacker-controlled — and rate limiting keyed on IP
  // then becomes trivially bypassable by spoofing that header.
  //
  // Trust exactly the number of proxies actually in front of this server:
  // TRUST_PROXY_HOPS=1 for a single nginx/ALB, 0 (default) when the app is
  // reached directly. Express then takes the Nth-from-last XFF entry, which a
  // client cannot forge past.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  app.set("trust proxy", Number.isFinite(hops) && hops > 0 ? hops : false);

  // ---- CORS (must run BEFORE any route so preflights are answered) --------
  // The API is token-based (Authorization header), not cookie-based, so
  // credentials stay off and a reflected allow-list is safe. Non-browser
  // callers (curl, server-to-server, health probes) send no Origin at all and
  // are always allowed. An unknown Origin is rejected with a NAMED error so
  // the cause is obvious in the logs instead of surfacing as an opaque
  // browser-side "access control" failure.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // curl / same-origin / probes
        if (isAllowedOrigin(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: false,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: "15mb" })); // base64 image/document payloads
  app.use("/uploads", express.static(UPLOADS_PATH, { maxAge: "7d", immutable: true }));

  const API = "/api/v1";

  // ---- Health (public, never authenticated) ----------------------------
  // Liveness: answers even when the database is down, so a failing DB is
  // distinguishable from a dead process.
  app.get(`${API}/public/health`, (_req, res) => {
    res.json({ ok: true, service: "zolo-packing-api" });
  });

  // Readiness: proves the API can actually reach PostgreSQL. Returns 503 when
  // it cannot, so the app never looks healthy while the database is gone.
  app.get(`${API}/public/ready`, async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: "zolo-packing-api", db: "up" });
    } catch (e) {
      console.error("[health] database unreachable:", e.message);
      res.status(503).json({ ok: false, service: "zolo-packing-api", db: "down", error: "Database unavailable" });
    }
  });

  app.get(`${API}/health`, wrap(async (_req, res) => {
    const products = await prisma.product.count();
    ok(res, { db: "postgresql/zolo_packing", products });
  }));

  // Public auth
  app.use(`${API}/auth`, authRouter);

  // Products/catalog — kept OPEN to preserve the existing admin/storefront behavior.
  app.use(API, productsRouter);

  // Authenticated areas
  app.use(`${API}/notifications`, authenticate, notificationsRouter);
  // Buyer commerce (cart, addresses, checkout, orders) — any authenticated user.
  app.use(`${API}/cart`, authenticate, requireBuyer, cartRouter);
  app.use(`${API}/addresses`, authenticate, requireBuyer, addressRouter);
  app.use(API, authenticate, requireBuyer, orderRouter); // /checkout/*, /orders/*
  app.use(`${API}/sellers`, authenticate, requireSeller, loadSupplierOrg, sellerRouter);
  app.use(`${API}/admin`, authenticate, requireAdmin, adminRouter);

  // 404 for unknown API routes
  app.use(API, (_req, res) => res.status(404).json({ success: false, error: "Route not found", code: "NOT_FOUND" }));

  app.use(errorHandler);
  return app;
}
