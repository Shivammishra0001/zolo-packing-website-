// Auth routes: /api/v1/auth/*
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import { registerSchema, loginSchema } from "../lib/validation.mjs";
import * as authService from "../services/auth.mjs";
import { authenticate } from "../middleware/auth.mjs";

import { loginRateLimit, registerRateLimit, refreshRateLimit } from "../middleware/rate-limit.mjs";

export const authRouter = Router();

const meta = (req) => ({ userAgent: req.headers["user-agent"] || null, ip: req.ip || null });

authRouter.post("/register", registerRateLimit, wrap(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input, meta(req));
  ok(res, result, 201);
}));

authRouter.post("/login", loginRateLimit, wrap(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input, meta(req));
  ok(res, result);
}));

// Rotates the refresh token: the response carries a NEW refreshToken and the
// presented one is revoked. Clients must store the new value.
authRouter.post("/refresh", refreshRateLimit, wrap(async (req, res) => {
  ok(res, await authService.refresh({ refreshToken: req.body?.refreshToken }, meta(req)));
}));

authRouter.post("/logout", wrap(async (req, res) => {
  await authService.logout({ refreshToken: req.body?.refreshToken });
  ok(res, { loggedOut: true });
}));

// Sign out of every device. Requires a valid access token — the identity comes
// from the verified JWT, never from a userId in the request body.
authRouter.post("/logout-all", authenticate, wrap(async (req, res) => {
  ok(res, await authService.logoutAll(req.user.id));
}));

authRouter.get("/me", authenticate, wrap(async (req, res) => {
  ok(res, await authService.me(req.user.id));
}));
