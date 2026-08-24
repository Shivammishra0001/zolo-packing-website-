// Seller/admin session context, backed by the real JWT API. Restores the
// session on load, exposes login/register/logout, and guards routes by role.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authApi, tokenStore, type SessionUser } from "./api";
import { clearAllAuthStorage } from "@/lib/auth/session-keys";

const ADMIN_ROLES = ["admin", "verification_admin", "finance_admin", "operations_admin"];
const SELLER_ROLES = ["seller_owner", "seller_admin", "seller_staff"];
export const isAdmin = (role?: string) => !!role && ADMIN_ROLES.includes(role);
export const isSeller = (role?: string) => !!role && SELLER_ROLES.includes(role);

interface SellerAuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  registerSeller: (input: { email: string; password: string; firstName: string; lastName?: string; phone?: string; companyName?: string }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const Ctx = createContext<SellerAuthValue | null>(null);

export function useSellerAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSellerAuth must be used within <SellerAuthProvider>");
  return ctx;
}

export function SellerAuthProvider({ children }: { children: ReactNode }) {
  // SECURITY: start UNAUTHENTICATED. Seeding this from tokenStore.getUser()
  // (localStorage) meant seller pages rendered as an authenticated user — with
  // whatever role the stored blob claimed — before the backend had verified
  // anything. `refreshUser()` below establishes the real session.
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); return; }
    try {
      const me = await authApi.me();
      setUser(me.user);
      tokenStore.set(tokenStore.get()!, tokenStore.getRefresh() ?? undefined, me.user);
    } catch {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    tokenStore.set(res.accessToken, res.refreshToken, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const registerSeller = useCallback(async (input: { email: string; password: string; firstName: string; lastName?: string; phone?: string; companyName?: string }) => {
    const res = await authApi.register({ ...input, accountType: "seller" });
    tokenStore.set(res.accessToken, res.refreshToken, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    // Sign out of EVERY portal this browser holds a session for. Clearing only
    // the seller keys used to leave the storefront's refresh token behind,
    // which silently restored that session on the next load — a logout that
    // did not log the user out.
    const refreshTokens = [
      localStorage.getItem("zolo.seller.refreshToken"),
      localStorage.getItem("zolo.store.refreshToken"),
    ].filter((t): t is string => Boolean(t));

    await Promise.allSettled(refreshTokens.map((t) => authApi.logout(t)));

    clearAllAuthStorage();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, registerSeller, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}

function Splash({ label }: { label: string }) {
  return <div className="min-h-screen grid place-items-center text-slate-500">{label}</div>;
}

export function RequireSeller({ children }: { children: ReactNode }) {
  const { user, loading } = useSellerAuth();
  const loc = useLocation();
  if (loading) return <Splash label="Loading…" />;
  if (!user) return <Navigate to="/seller/login" replace state={{ from: loc.pathname }} />;
  if (!isSeller(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
