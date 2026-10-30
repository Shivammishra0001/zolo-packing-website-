// Self-contained seller portal — its own chrome, real-auth guarded.
import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { SellerAuthProvider, RequireSeller, useSellerAuth } from "./SellerAuth";
import { RequireApproved } from "./RequireApproved";
import SellerLogin from "./pages/SellerLogin";
import Onboarding from "./pages/Onboarding";
import SellerDashboard from "./pages/SellerDashboard";
import SellerRfqs from "./pages/SellerRfqs";
import SellerProducts from "./pages/SellerProducts";

function SellerShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useSellerAuth();
  const navigate = useNavigate();
  const link = "rounded-lg px-3 py-2 text-sm font-medium transition";
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-bold text-slate-900">Zolo <span className="text-orange-600">Supplier</span></span>
            <nav className="flex gap-1">
              <NavLink to="/seller/dashboard" className={({ isActive }) => `${link} ${isActive ? "bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-slate-100"}`}>Dashboard</NavLink>
              <NavLink to="/seller/products" className={({ isActive }) => `${link} ${isActive ? "bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-slate-100"}`}>Products</NavLink>
              <NavLink to="/seller/rfqs" className={({ isActive }) => `${link} ${isActive ? "bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-slate-100"}`}>RFQ Leads</NavLink>
              <NavLink to="/seller/onboarding" className={({ isActive }) => `${link} ${isActive ? "bg-orange-50 text-orange-700" : "text-slate-600 hover:bg-slate-100"}`}>Onboarding</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            {/* A supplier who signed up by phone has a generated .invalid
                address they never typed and cannot use. Showing it is noise at
                best and alarming at worst, so prefer the name, then the phone,
                and fall back to a real email only when there is one. */}
            <span className="hidden sm:inline">
              {user?.firstName ||
                user?.phone ||
                (user?.email && !user.email.endsWith(".invalid") ? user.email : "Supplier")}
            </span>
            <button onClick={async () => { await logout(); navigate("/seller/login"); }} className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100">Sign out</button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function SellerRoutes() {
  return (
    <SellerAuthProvider>
      <Routes>
        <Route path="/seller/login" element={<SellerLogin />} />
        <Route path="/seller" element={<Navigate to="/seller/dashboard" replace />} />
        <Route path="/seller/dashboard" element={<RequireSeller><SellerShell><RequireApproved><SellerDashboard /></RequireApproved></SellerShell></RequireSeller>} />
        <Route path="/seller/products" element={<RequireSeller><SellerShell><RequireApproved><SellerProducts /></RequireApproved></SellerShell></RequireSeller>} />
        <Route path="/seller/rfqs" element={<RequireSeller><SellerShell><RequireApproved><SellerRfqs /></RequireApproved></SellerShell></RequireSeller>} />
        <Route path="/seller/onboarding" element={<RequireSeller><SellerShell><Onboarding /></SellerShell></RequireSeller>} />
        <Route path="/seller/*" element={<Navigate to="/seller/dashboard" replace />} />
      </Routes>
    </SellerAuthProvider>
  );
}
