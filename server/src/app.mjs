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
import { rfqRouter, quotationRouter, adminRfqRouter, sellerRfqRouter } from "./routes/rfq.mjs";
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
  // A request whose Origin matches the host it was sent to is same-origin: the
  // browser attaches an Origin header, but nothing is crossing an origin
  // boundary. In a single-service deployment (SPA + API on one host) this is
  // every request the app makes about itself, so it must never be refused —
  // rejecting it returned 403 for the SPA's own JavaScript and CSS.
  //
  // Cross-origin requests fall through to the strict allow-list below.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
      const { host, protocol } = new URL(origin);
      // Host equality is the security-relevant test: the browser sets both the
      // Origin and the Host it dials, so a cross-site page cannot make them
      // agree on OUR hostname.
      //
      // The scheme is deliberately NOT required to match req.protocol. Behind a
      // TLS-terminating proxy (App Platform, nginx) the hop to this process is
      // plain HTTP, so an `https://` Origin would look mismatched and be
      // refused — a 403 on the SPA's own assets whenever X-Forwarded-Proto is
      // absent. Accepting https-over-http grants nothing extra: the request
      // already proved it targets this host.
      const forwardedProto = req.headers["x-forwarded-proto"]?.split(",")[0].trim() || req.protocol;
      const schemeOk = protocol === `${forwardedProto}:` || protocol === "https:";
      if (host === req.headers.host && schemeOk) {
        // Mark it so the cors() gate below admits it without consulting the
        // cross-origin allow-list. (`next("route")` does not skip middleware
        // registered with app.use, so a flag is the reliable mechanism.)
        req.isSameOrigin = true;
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        if (req.method === "OPTIONS") return res.sendStatus(204);
      }
    } catch {
      /* unparseable Origin — let the strict gate decide */
    }
    return next();
  });

  app.use(
    cors((req, done) =>
      done(null, {
      origin(origin, callback) {
        if (!origin) return callback(null, true); // curl / same-origin / probes
        // Same-origin was already established above; do not consult the
        // cross-origin allow-list for a request that crosses nothing.
        if (req.isSameOrigin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      // NOTE: same-origin requests are admitted by the `sameOrigin` middleware
      // that runs BEFORE this one (see below) — a single-service deployment
      // serves the SPA and API from one host, so the browser sends an Origin
      // header that is not "cross-origin" in any meaningful sense.
      credentials: false,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      maxAge: 86400,
      }),
    ),
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
  app.use(`${API}/sellers/rfqs`, authenticate, requireSeller, loadSupplierOrg, sellerRfqRouter);
  app.use(`${API}/sellers`, authenticate, requireSeller, loadSupplierOrg, sellerRouter);
  // RFQ -> Quotation -> Order. These routers authenticate internally (and the
  // admin one also requires the admin role), so they mount without a guard here.
  app.use(`${API}/rfqs`, rfqRouter);
  app.use(`${API}/quotations`, quotationRouter);
  app.use(`${API}/admin/rfqs`, adminRfqRouter);

  app.use(`${API}/admin`, authenticate, requireAdmin, adminRouter);

  // 404 for unknown API routes
  app.use(API, (_req, res) => res.status(404).json({ success: false, error: "Route not found", code: "NOT_FOUND" }));

  app.use(errorHandler);
  return app;
}
