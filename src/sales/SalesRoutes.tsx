import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import { Home, Users, Plus, Package, LogOut } from "lucide-react";
import { useAuthSession } from "@/components/auth/AuthContext";
import SalesHome from "./pages/SalesHome";
import SalesOrders from "./pages/SalesOrders";
import CaptureOrder from "./pages/CaptureOrder";
import SalesCustomers from "./pages/SalesCustomers";

// Field-sales portal. Mobile-first by design: an Android phone held one-handed
// in a warehouse is the primary target, so navigation lives at the bottom
// within thumb reach rather than in a top bar.

function BottomNav() {
  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition";
  const cls = ({ isActive }: { isActive: boolean }) =>
    `${tab} ${isActive ? "text-green-700" : "text-dark-400"}`;
  return (
    <nav aria-label="Sales navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-dark-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <NavLink to="/sales" end className={cls}><Home className="h-5 w-5" aria-hidden /> Home</NavLink>
      <NavLink to="/sales/customers" className={cls}><Users className="h-5 w-5" aria-hidden /> Customers</NavLink>
      {/* The capture button is deliberately dominant — it is the one thing a
          rep opens this app to do. */}
      <NavLink to="/sales/new" className={`${tab} text-white`} aria-label="Create order">
        <span className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary-500 shadow-[var(--shadow-cta)]">
          <Plus className="h-7 w-7" aria-hidden />
        </span>
        <span className="text-dark-400">Order</span>
      </NavLink>
      <NavLink to="/sales/orders" className={cls}><Package className="h-5 w-5" aria-hidden /> Orders</NavLink>
      <SignOutTab className={tab} />
    </nav>
  );
}

function SignOutTab({ className }: { className: string }) {
  const { logout } = useAuthSession();
  return (
    <button type="button" onClick={() => void logout()} className={`${className} text-dark-400`}>
      <LogOut className="h-5 w-5" aria-hidden /> Sign out
    </button>
  );
}

/**
 * Guard. A rep signs in through the normal login, so this only decides where
 * they land — the API enforces the real permissions on every request.
 */
function RequireSalesperson({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, role, authReady, openAuthModal } = useAuthSession();
  const loc = useLocation();

  // The session is verified against the server asynchronously. Deciding before
  // that resolves would bounce a signed-in rep to /login on every cold load,
  // because isAuthenticated is still false on the first render.
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-dark-200 border-t-green-500" aria-label="Loading" />
      </div>
    );
  }

  if (!isAuthenticated) {
    openAuthModal({ tab: "login", pendingAction: { label: "open the sales portal", run: () => {} } });
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  // Admins are allowed in so a supervisor can use the same screens.
  if (role !== "salesperson" && role !== "admin") {
    return (
      <div className="px-6 py-20 text-center">
        <p className="text-lg font-bold text-dark-900">Sales portal</p>
        <p className="mt-2 text-sm text-dark-600">
          This area is for field sales staff. Ask an administrator to create your account.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function SalesRoutes() {
  return (
    <RequireSalesperson>
      <div className="min-h-screen bg-dark-50">
        {/* Absolute paths, matching AdminRoutes: this <Routes> is rendered from
            a pathname branch in App's Shell, not from a parent <Route>, so
            relative paths would never match. */}
        <Routes>
          <Route path="/sales" element={<SalesHome />} />
          <Route path="/sales/customers" element={<SalesCustomers />} />
          <Route path="/sales/new" element={<CaptureOrder />} />
          <Route path="/sales/orders" element={<SalesOrders />} />
          <Route path="*" element={<Navigate to="/sales" replace />} />
        </Routes>
        <BottomNav />
      </div>
    </RequireSalesperson>
  );
}
