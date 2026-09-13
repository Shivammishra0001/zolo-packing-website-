import { useEffect, useRef, useState } from "react";
import { Outlet, Link, NavLink, useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronDown,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Recycle,
  ReceiptText,
  Settings,
  ShoppingCart,
  Sun,
  User,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/utils/cn";
import logoImg from "../../images/logo.jpg";
import { AdminThemeProvider, useTheme, type ThemePref } from "@/admin/theme";
import { ToastProvider } from "@/components/ui/Toast";
import { useAuthSession } from "@/components/auth/AuthContext";
import { useBuyerProfile } from "./data";
import { markAllNotificationsRead, markNotificationRead, useAdminNotifications, type AppNotificationRow } from "@/admin/dashboard-api";
import { relativeTime } from "@/admin/format";

/** Where a buyer notification should take the customer when clicked. */
function buyerNotificationHref(n: AppNotificationRow): string {
  if (n.entityType === "PaymentRequest") return "/account/payment-requests";
  if (n.entityType === "Order") return n.entityId ? `/account/orders/${n.entityId}` : "/account/orders";
  if (n.entityType === "Quotation" || n.entityType === "Rfq") return "/account/quotations";
  if (n.entityType === "ReturnRequest") return "/account/recycle";
  return "/account/dashboard";
}

// ---------- Buyer sidebar: ONLY buyer modules, never admin ----------
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/account/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/account/quotations", label: "Quotations", icon: FileText },
  { to: "/account/orders", label: "Orders", icon: ShoppingCart },
  { to: "/account/tracking", label: "Tracking", icon: MapPin },
  { to: "/account/payments", label: "Payment History", icon: Wallet },
  { to: "/account/payment-requests", label: "Payment Requests", icon: Link2 },
  { to: "/account/recycle", label: "Returns & Recycling", icon: Recycle },
  { to: "/account/reports", label: "Reports", icon: ReceiptText },
  { to: "/account/settings", label: "Settings", icon: Settings },
];

const THEME_OPTIONS: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
];

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOutside]);
  return ref;
}

function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b erp-border-soft px-4">
        <Link to="/account/dashboard" className="flex min-w-0 items-center gap-2.5" onClick={onNavigate}>
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-black/5">
            <img src={logoImg} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-display text-sm font-extrabold erp-text">Zolo Packaging</div>
            <div className="text-[10px] font-semibold uppercase tracking-widest erp-text-faint">My Account</div>
          </div>
        </Link>
      </div>
      <nav aria-label="Account sections" className="flex-1 overflow-y-auto px-3 py-3 no-scrollbar">
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                    isActive
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                      : "erp-text-muted hover:erp-surface-2 hover:erp-text",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-500" aria-hidden />}
                    <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-primary-600 dark:text-primary-400" : "erp-text-faint")} aria-hidden />
                    <span className="flex-1 truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const nav = useNavigate();
  const { logout } = useAuthSession();
  const profile = useBuyerProfile();
  const { pref, resolved, setPref } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const themeRef = useClickOutside(() => setThemeOpen(false));
  const userRef = useClickOutside(() => setUserOpen(false));
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useClickOutside(() => setBellOpen(false));
  // Live in-app notifications (GET /notifications, scoped to this customer).
  const notifQuery = useAdminNotifications();
  const notifications = notifQuery.data?.items ?? [];
  const unread = notifQuery.data?.unread ?? 0;
  const ThemeIcon = pref === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const initials = `${profile.firstName[0] ?? "U"}${profile.lastName[0] ?? ""}`.toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b erp-border erp-surface px-3 sm:gap-3 sm:px-5">
      <button onClick={onOpenMobileNav} className="flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold erp-text">Welcome back, {profile.firstName}</p>
        <p className="truncate text-xs erp-text-muted">{profile.company || profile.email}</p>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {/* Theme */}
        <div ref={themeRef} className="relative">
          <button onClick={() => setThemeOpen((o) => !o)} className="flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2" aria-label="Change theme" aria-expanded={themeOpen}>
            <ThemeIcon className="h-5 w-5" aria-hidden />
          </button>
          {themeOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1.5 w-40 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
              {THEME_OPTIONS.map((opt) => (
                <button key={opt.key} role="menuitemradio" aria-checked={pref === opt.key} onClick={() => { setPref(opt.key); setThemeOpen(false); }}
                  className={cn("flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:erp-surface-2", pref === opt.key ? "font-bold text-primary-600 dark:text-primary-400" : "erp-text")}>
                  <opt.icon className="h-4 w-4" aria-hidden /> {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notifications — real rows from the database */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen((o) => !o)}
            className="relative flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
            aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
            aria-expanded={bellOpen}
          >
            <Bell className="h-5 w-5" aria-hidden />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-80 max-w-[90vw] overflow-hidden rounded-lg border erp-border erp-surface shadow-lg">
              <div className="flex items-center justify-between border-b erp-border-soft px-4 py-2.5">
                <span className="text-sm font-bold erp-text">Notifications</span>
                {unread > 0 && (
                  <button onClick={() => { void markAllNotificationsRead().then(() => notifQuery.refetch()).catch(() => {}); }} className="text-[11px] font-bold text-primary-600 hover:underline dark:text-primary-400">
                    Mark all read
                  </button>
                )}
              </div>
              <ul className="max-h-96 overflow-y-auto">
                {notifications.length === 0 && (
                  <li className="px-4 py-6 text-center text-xs erp-text-muted">{notifQuery.status === "loading" ? "Loading…" : "No notifications yet."}</li>
                )}
                {notifications.map((n) => (
                  <li key={n.id} className="border-b erp-border-soft last:border-0">
                    <Link
                      to={buyerNotificationHref(n)}
                      onClick={() => { setBellOpen(false); if (n.status === "UNREAD") void markNotificationRead(n.id).then(() => notifQuery.refetch()).catch(() => {}); }}
                      className="flex gap-3 px-4 py-3 hover:erp-surface-2"
                    >
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.status === "READ" ? "bg-dark-300 dark:bg-dark-600" : "bg-primary-500")} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold erp-text">{n.title}</span>
                        {n.body && <span className="mt-0.5 block text-xs leading-relaxed erp-text-muted">{n.body}</span>}
                        <span className="mt-1 block text-[11px] font-medium erp-text-faint">{relativeTime(n.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={userRef} className="relative">
          <button onClick={() => setUserOpen((o) => !o)} className="flex h-11 items-center gap-2 rounded-lg px-1.5 hover:erp-surface-2 sm:px-2" aria-label="Account menu" aria-expanded={userOpen}>
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-amber-400 text-xs font-bold text-white">{initials}</span>
            )}
            <ChevronDown className="hidden h-3.5 w-3.5 erp-text-faint sm:block" aria-hidden />
          </button>
          {userOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
              <div className="border-b erp-border-soft px-4 py-3">
                <div className="text-sm font-bold erp-text">{profile.name}</div>
                <div className="truncate text-xs erp-text-muted">{profile.email}</div>
              </div>
              <Link to="/account/settings" onClick={() => setUserOpen(false)} className="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm erp-text hover:erp-surface-2">
                <User className="h-4 w-4 erp-text-faint" aria-hidden /> Profile & settings
              </Link>
              <Link to="/" onClick={() => setUserOpen(false)} className="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm erp-text hover:erp-surface-2">
                <ExternalLink className="h-4 w-4 erp-text-faint" aria-hidden /> Back to store
              </Link>
              <button onClick={() => { setUserOpen(false); logout(); nav("/"); }} className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function BuyerChrome() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen erp-bg erp-text">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r erp-border erp-surface lg:flex">
        <SidebarContent onNavigate={() => {}} />
      </aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Account navigation">
          <div className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col erp-surface shadow-xl">
            <div className="flex items-center justify-end px-3 pt-3">
              <button onClick={() => setMobileOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2" aria-label="Close menu">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:pl-60">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function BuyerLayout() {
  return (
    <AdminThemeProvider>
      <ToastProvider>
        <BuyerChrome />
      </ToastProvider>
    </AdminThemeProvider>
  );
}
