import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import * as authService from "@/lib/auth/service";
import { hydrateCart, resetCart } from "@/lib/cart-store";
import {
  homeRouteForRole,
  type AuthTab,
  type AuthUser,
  type LoginCredentials,
  type PendingAction,
  type RegisterData,
  type UserRole,
} from "@/lib/auth/types";
import { AuthModal } from "./AuthModal";

// ---------- Placeholder auth context ----------
// Holds ONLY non-sensitive session state (the user object the backend
// returns). Passwords live exclusively in form component state and are
// passed straight through to the service layer — never stored here, never
// persisted anywhere client-side.

interface AuthContextValue {
  /** null = guest. */
  user: AuthUser | null;
  isAuthenticated: boolean;
  /**
   * False until the initial session-restore has finished. Guards must wait for
   * this before deciding to redirect, so a returning user isn't bounced to the
   * home page during the async token refresh on first paint.
   */
  authReady: boolean;
  /** Convenience: the user's role, or undefined for guests. */
  role: UserRole | undefined;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-validate the stored session against the backend (refresh if needed). */
  refreshSession: () => Promise<void>;
  /** Open the auth modal, optionally remembering the action to resume */
  openAuthModal: (opts?: { tab?: AuthTab; pendingAction?: PendingAction }) => void;
  closeAuthModal: () => void;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuthSession must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<AuthTab>("login");
  // Ref, not state: the pending action is transient and never re-renders UI
  const pendingAction = useRef<PendingAction | null>(null);

  const openAuthModal = useCallback(
    (opts?: { tab?: AuthTab; pendingAction?: PendingAction }) => {
      pendingAction.current = opts?.pendingAction ?? null;
      setInitialTab(opts?.tab ?? "login");
      setModalOpen(true);
    },
    [],
  );

  const closeAuthModal = useCallback(() => {
    setModalOpen(false);
    pendingAction.current = null;
  }, []);

  /**
   * After auth is confirmed: close the modal, then either resume the action
   * the guest was attempting, or route the user to their role's home.
   */
  const handleAuthenticated = useCallback(
    (nextUser: AuthUser) => {
      setUser(nextUser);
      setModalOpen(false);
      void hydrateCart(); // load the freshly-authenticated buyer's server cart
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action) {
        action.run();
      } else {
        navigate(homeRouteForRole(nextUser.role));
      }
    },
    [navigate],
  );

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      const nextUser = await authService.login(credentials);
      handleAuthenticated(nextUser);
    },
    [handleAuthenticated],
  );

  const register = useCallback(
    async (data: RegisterData) => {
      const nextUser = await authService.register(data);
      handleAuthenticated(nextUser);
    },
    [handleAuthenticated],
  );

  const logout = useCallback(async () => {
    // Clear local state FIRST so the UI can never show authenticated content
    // while the network call is in flight; the service revokes the refresh
    // token server-side, purges storage and notifies other tabs.
    setUser(null);
    resetCart();
    try {
      await authService.logout();
    } finally {
      navigate("/");
    }
  }, [navigate]);

  const refreshSession = useCallback(async () => {
    const restored = await authService.getCurrentUser();
    setUser(restored);
  }, []);

  // Cross-tab sign-out: when any other tab logs out, drop this tab's session
  // too so a logged-out user is never left with a live-looking UI.
  useEffect(() => {
    return authService.onAuthLogout(() => {
      setUser(null);
      resetCart();
    });
  }, []);

  // Restore an existing session on first load: validate/refresh the stored
  // token against the backend and rehydrate the user, or stay a guest.
  useEffect(() => {
    let cancelled = false;
    // Drop obsolete auth keys from earlier versions before deciding anything —
    // they were the source of the synchronous auto-login.
    authService.purgeLegacyAuthKeys();
    authService
      .getCurrentUser()
      .then((restored) => {
        if (cancelled || !restored) return;
        setUser(restored);
        // Restore the server cart too, so the header badge and cart page are
        // correct immediately after a refresh — not only after a fresh login.
        void hydrateCart();
      })
      .catch(() => {
        /* stay a guest */
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      authReady,
      role: user?.role,
      login,
      register,
      logout,
      refreshSession,
      openAuthModal,
      closeAuthModal,
    }),
    [user, authReady, login, register, logout, refreshSession, openAuthModal, closeAuthModal],
  );

  return (
    <AuthCtx.Provider value={value}>
      {children}
      <AuthModal open={modalOpen} initialTab={initialTab} onClose={closeAuthModal} />
    </AuthCtx.Provider>
  );
}
