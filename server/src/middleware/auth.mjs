// Authentication + RBAC middleware.
//
// Identity is resolved ONLY from the verified access token — never from any
// userId/organizationId sent in the request body or query. Route handlers read
// req.user (the DB-backed user) and req.membership (their supplier org, if any).
import { prisma } from "../lib/prisma.mjs";
import { verifyAccessToken } from "../lib/crypto.mjs";
import { unauthorized, forbidden, wrap } from "../lib/http.mjs";

const ADMIN_ROLES = ["admin", "verification_admin", "finance_admin", "operations_admin"];
const SELLER_ROLES = ["seller_owner", "seller_admin", "seller_staff"];

export const isAdminRole = (role) => ADMIN_ROLES.includes(role);
export const isSellerRole = (role) => SELLER_ROLES.includes(role);

// Populates req.user from the Bearer token. Throws 401 when absent/invalid.
export const authenticate = wrap(async (req, _res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.isActive) throw unauthorized("Account not found or inactive");

  // Verifying the signature is not enough: a token signed before logout stays
  // cryptographically valid until it expires. Access tokens carry the id of the
  // session that minted them, so a revoked (logged-out) or expired session
  // invalidates its access token immediately.
  //
  // Tokens issued before this claim existed have no `sid`. Those are rejected
  // rather than grandfathered — the alternative is a bypass that lasts as long
  // as the longest outstanding token.
  if (!claims.sid) throw unauthorized("Session expired — please sign in again");

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.userId !== user.id) throw unauthorized("Session not found");
  if (session.revokedAt) throw unauthorized("Session has been signed out");
  if (session.expiresAt <= new Date()) throw unauthorized("Session expired");

  req.user = user;
  req.sessionId = session.id;
  next();
});

// Resolves the caller's supplier organization from their membership (server-side,
// never trusting a client-supplied orgId). Attaches req.supplierOrg + req.supplierProfile.
export const loadSupplierOrg = wrap(async (req, _res, next) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: req.user.id, organization: { kind: "supplier" } },
    include: { organization: { include: { supplierProfile: true } } },
  });
  req.membership = membership || null;
  req.supplierOrg = membership?.organization || null;
  req.supplierProfile = membership?.organization?.supplierProfile || null;
  next();
});

// Role guard factory.
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden("Insufficient role"));
    next();
  };
}

export const requireAdmin = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!isAdminRole(req.user.role)) return next(forbidden("Admin access required"));
  next();
};

export const requireSeller = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!isSellerRole(req.user.role)) return next(forbidden("Seller access required"));
  next();
};

// Any authenticated non-suspended user may shop as a buyer (buyers plus, e.g.,
// an admin testing checkout). Only the role gates below restrict admin APIs.
export const requireBuyer = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};
