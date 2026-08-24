import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthSession } from "./AuthContext";
import { homeRouteForRole } from "@/lib/auth/types";

// ============================================================
// Route-level role guards. Reusable, declarative wrappers around a subtree.
//
// SECURITY NOTE: these are UX gates only. The frontend must NEVER be the sole
// authorization boundary — the backend re-checks role + identity on every
// request (JWT + role). A determined user can bypass client routing; the server
// cannot be bypassed.
// ============================================================

/** Renders children only for guests (not logged in). Others go to their home. */
export function GuestGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, authReady, role } = useAuthSession();
  if (!authReady) return null; // wait for session restore before deciding
  if (isAuthenticated) return <Navigate to={homeRouteForRole(role)} replace />;
  return <>{children}</>;
}

/**
 * Renders children only for authenticated users of a required role.
 * - While the session is being restored → render nothing (avoids a flash /
 *   premature redirect for a returning user).
 * - Guests → open the login modal (in an effect, never during render) and
 *   bounce to the storefront home.
 * - Wrong role → redirect to that role's own dashboard.
 */
function RequireRole({ role: required, children }: { role: "buyer" | "admin"; children: ReactNode }) {
  const { isAuthenticated, authReady, role, openAuthModal } = useAuthSession();

  // Opening the auth modal mutates AuthProvider state; doing it during render
  // triggers "Cannot update a component while rendering a different component".
  // Run it as a side effect once we know the visitor is an unauthenticated guest.
  const needsLogin = authReady && !isAuthenticated;
  useEffect(() => {
    if (needsLogin) openAuthModal({ tab: "login" });
  }, [needsLogin, openAuthModal]);

  if (!authReady) return null;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (role !== required) return <Navigate to={homeRouteForRole(role)} replace />;
  return <>{children}</>;
}

/** Renders children only for authenticated BUYERS. */
export function BuyerGuard({ children }: { children: ReactNode }) {
  return <RequireRole role="buyer">{children}</RequireRole>;
}

/** Renders children only for authenticated ADMINS. */
export function AdminGuard({ children }: { children: ReactNode }) {
  return <RequireRole role="admin">{children}</RequireRole>;
}
