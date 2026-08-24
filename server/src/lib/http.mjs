// HTTP helpers shared by every route. Preserves the existing envelope shape
// ({ success, data } / { success:false, error }) used by the product API and
// the frontend client, so existing callers keep working.
import { ZodError } from "zod";

export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// Async route wrapper: forward every error to the JSON error handler.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// A domain error the routes can throw with an explicit HTTP status.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = "Authentication required") => new HttpError(401, msg, "UNAUTHENTICATED");
export const forbidden = (msg = "Not permitted") => new HttpError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new HttpError(404, msg, "NOT_FOUND");
export const conflict = (msg, code) => new HttpError(409, msg, code);

// Central error handler. Nothing is swallowed; secrets never leak to the client.
export function errorHandler(err, _req, res, _next) {
  // CORS rejections must answer as JSON, not Express's default HTML error page
  // — the frontend parses every response as JSON.
  if (typeof err?.message === "string" && err.message.includes("not allowed by CORS")) {
    return res.status(403).json({ success: false, error: err.message, code: "CORS_ORIGIN_DENIED" });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return res.status(400).json({ success: false, error: "Validation failed", code: "VALIDATION", issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code });
  }
  // Prisma known errors
  if (err.code === "P2025") return res.status(404).json({ success: false, error: "Not found", code: "P2025" });
  if (err.code === "P2002") {
    const field = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "value";
    return res.status(409).json({ success: false, error: `Duplicate ${field}`, code: "P2002" });
  }
  console.error("[api:error]", err);
  res.status(500).json({ success: false, error: "Internal server error" });
}
