import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  FileText,
  Landmark,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Package,
  PanelLeft,
  Plus,
  Search,
  ShoppingCart,
  Sun,
  User,
  Wrench,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { relativeTime } from "../format";
import { useTheme, type ThemePref } from "../theme";
import { useAuthSession } from "@/components/auth/AuthContext";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  useAdminNotifications,
} from "../dashboard-api";

// Quick-create actions surfaced from the top bar
const QUICK_ACTIONS = [
  { label: "New Order", icon: ShoppingCart, to: "/admin/orders?new=1" },
  { label: "New Quotation", icon: FileText, to: "/admin/quotes?new=1" },
  { label: "New Customer", icon: User, to: "/admin/customers?new=1" },
  { label: "New Product", icon: Package, to: "/admin/catalog?new=1" },
];

const THEME_OPTIONS: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
];

// ---------- date range options shown in the top bar selector ----------
export type DateRange = "today" | "7d" | "30d" | "quarter";
export const DATE_RANGE_LABEL: Record<DateRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  quarter: "This quarter",
};

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOutside]);
  return ref;
}

interface SearchHit {
  id: string;
  label: string;
  sub: string;
  href: string;
  icon: typeof Package;
}

// Search DESTINATIONS, not mock rows. The old version looped over mock arrays
// that were permanently empty, so every query answered "No matches" while real
// orders and RFQs existed in the database. Until a cross-entity search endpoint
// exists, searching is honest navigation: an id-shaped query jumps straight to
// the module's own (real, server-backed) search.
const SEARCH_TARGETS: { label: string; sub: string; href: string; icon: typeof Package; keys: string[] }[] = [
  { label: "Orders", sub: "Order list & status", href: "/admin/orders", icon: Package, keys: ["order", "ord"] },
  { label: "Quotations (RFQ)", sub: "Customer quote requests", href: "/admin/quotes", icon: FileText, keys: ["rfq", "quote", "quotation"] },
  { label: "Customers", sub: "Buyer accounts", href: "/admin/customers", icon: Landmark, keys: ["customer", "buyer"] },
  { label: "Production", sub: "Job cards", href: "/admin/production", icon: Wrench, keys: ["production", "job"] },
];

function searchEverything(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: SearchHit[] = [];
  // Id-shaped queries route to the module whose real search can resolve them.
  if (/^ord/i.test(needle)) hits.push({ id: "order-jump", label: `Search orders for “${q.trim()}”`, sub: "Orders", href: `/admin/orders?search=${encodeURIComponent(q.trim())}`, icon: Package });
  if (/^(rfq|qt)/i.test(needle)) hits.push({ id: "rfq-jump", label: `Open ${q.trim().toUpperCase()}`, sub: "Quotations", href: `/admin/quotes/${encodeURIComponent(q.trim().toUpperCase())}`, icon: FileText });
  for (const t of SEARCH_TARGETS) {
    if (t.label.toLowerCase().includes(needle) || t.keys.some((k) => k.includes(needle) || needle.includes(k))) {
      hits.push({ id: t.href, label: t.label, sub: t.sub, href: t.href, icon: t.icon });
    }
  }
  return hits.slice(0, 8);
}

export function Topbar({
  onOpenMobileNav,
  onToggleCollapse,
  range,
  onRangeChange,
}: {
  onOpenMobileNav: () => void;
  onToggleCollapse: () => void;
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
}) {
  const nav = useNavigate();
  // Real session identity + a sign-out that actually revokes the session. The
  // previous button only navigated home, leaving tokens in localStorage — the
  // "signed out" admin was restored on the next visit to /admin.
  const { user: sessionUser, logout } = useAuthSession();
  const displayName = sessionUser ? [sessionUser.firstName, sessionUser.lastName].filter(Boolean).join(" ") || sessionUser.email : "Admin";
  const initials = ((sessionUser?.firstName?.[0] ?? sessionUser?.email?.[0] ?? "A") + (sessionUser?.lastName?.[0] ?? "")).toUpperCase();
  const { pref, resolved, setPref } = useTheme();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  const searchRef = useClickOutside(() => setSearchOpen(false));
  const bellRef = useClickOutside(() => setBellOpen(false));
  const rangeRef = useClickOutside(() => setRangeOpen(false));
  const userRef = useClickOutside(() => setUserOpen(false));
  const quickRef = useClickOutside(() => setQuickOpen(false));
  const themeRef = useClickOutside(() => setThemeOpen(false));

  const hits = useMemo(() => searchEverything(query), [query]);
  // Live in-app notifications — DB rows written when RFQs arrive, quotations
  // are answered, orders land. Replaces the permanently-empty mock array.
  const notifQuery = useAdminNotifications();
  const notifications = notifQuery.data?.items ?? [];
  const unread = notifQuery.data?.unread ?? 0;

  const go = (href: string) => {
    setSearchOpen(false);
    setQuery("");
    nav(href);
  };

  const ThemeIcon = pref === "system" ? Monitor : resolved === "dark" ? Moon : Sun;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b erp-border erp-surface px-3 sm:gap-3 sm:px-5">
      <button
        onClick={onOpenMobileNav}
        className="flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2 lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <button
        onClick={onToggleCollapse}
        className="hidden h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2 lg:flex"
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-5 w-5" aria-hidden />
      </button>

      {/* Global search */}
      <div ref={searchRef} className="relative min-w-0 flex-1 max-w-xl">
        <label className="relative block">
          <span className="sr-only">Search orders, customers and jobs</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 erp-text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) go(hits[0].href);
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Search orders, customers, jobs…"
            className="h-11 w-full rounded-lg border erp-border erp-surface-2 pl-10 pr-4 text-sm erp-text outline-none transition-colors placeholder:erp-text-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
          />
        </label>
        {searchOpen && query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 overflow-hidden rounded-lg border erp-border erp-surface shadow-lg">
            {hits.length === 0 ? (
              <p className="px-4 py-3 text-sm erp-text-muted">No matches for “{query.trim()}”.</p>
            ) : (
              <ul>
                {hits.map((h) => (
                  <li key={`${h.href}-${h.id}`}>
                    <button
                      onClick={() => go(h.href)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:erp-surface-2"
                    >
                      <h.icon className="h-4 w-4 shrink-0 erp-text-faint" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold erp-text">{h.label}</span>
                        <span className="block truncate text-xs erp-text-muted">{h.sub}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {/* Quick actions */}
        <div ref={quickRef} className="relative hidden sm:block">
          <button
            onClick={() => setQuickOpen(!quickOpen)}
            className="flex h-11 items-center gap-1.5 rounded-lg bg-primary-500 px-3.5 text-sm font-bold text-white shadow-sm shadow-primary-500/20 hover:bg-primary-600"
            aria-haspopup="menu"
            aria-expanded={quickOpen}
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden md:inline">Create</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
          </button>
          {quickOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1.5 w-52 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
              {QUICK_ACTIONS.map((a) => (
                <Link
                  key={a.label}
                  to={a.to}
                  role="menuitem"
                  onClick={() => setQuickOpen(false)}
                  className="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm font-medium erp-text hover:erp-surface-2"
                >
                  <a.icon className="h-4 w-4 erp-text-faint" aria-hidden /> {a.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Date range */}
        <div ref={rangeRef} className="relative hidden md:block">
          <button
            onClick={() => setRangeOpen(!rangeOpen)}
            className="flex h-11 items-center gap-2 rounded-lg border erp-border px-3.5 text-sm font-semibold erp-text hover:erp-surface-2"
            aria-haspopup="listbox"
            aria-expanded={rangeOpen}
          >
            <CalendarDays className="h-4 w-4 erp-text-faint" aria-hidden />
            {DATE_RANGE_LABEL[range]}
            <ChevronDown className="h-3.5 w-3.5 erp-text-faint" aria-hidden />
          </button>
          {rangeOpen && (
            <ul
              role="listbox"
              aria-label="Date range"
              className="absolute right-0 top-full mt-1.5 w-44 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg"
            >
              {(Object.keys(DATE_RANGE_LABEL) as DateRange[]).map((r) => (
                <li key={r} role="option" aria-selected={r === range}>
                  <button
                    onClick={() => {
                      onRangeChange(r);
                      setRangeOpen(false);
                    }}
                    className={cn(
                      "w-full px-4 py-2.5 text-left text-sm hover:erp-surface-2",
                      r === range ? "font-bold text-primary-600 dark:text-primary-400" : "erp-text",
                    )}
                  >
                    {DATE_RANGE_LABEL[r]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Theme toggle */}
        <div ref={themeRef} className="relative">
          <button
            onClick={() => setThemeOpen(!themeOpen)}
            className="flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
            aria-label="Change theme"
            aria-expanded={themeOpen}
          >
            <ThemeIcon className="h-5 w-5" aria-hidden />
          </button>
          {themeOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1.5 w-40 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  role="menuitemradio"
                  aria-checked={pref === opt.key}
                  onClick={() => {
                    setPref(opt.key);
                    setThemeOpen(false);
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:erp-surface-2",
                    pref === opt.key ? "font-bold text-primary-600 dark:text-primary-400" : "erp-text",
                  )}
                >
                  <opt.icon className="h-4 w-4" aria-hidden /> {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => setBellOpen(!bellOpen)}
            className="relative flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
            aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
            aria-expanded={bellOpen}
          >
            <Bell className="h-5 w-5" aria-hidden />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-80 max-w-[90vw] overflow-hidden rounded-lg border erp-border erp-surface shadow-lg">
              <div className="flex items-center justify-between border-b erp-border-soft px-4 py-2.5">
                <span className="text-sm font-bold erp-text">Notifications</span>
                {unread > 0 && (
                  <button
                    onClick={() => {
                      void markAllNotificationsRead().then(() => notifQuery.refetch()).catch(() => {});
                    }}
                    className="text-[11px] font-bold text-primary-600 hover:underline dark:text-primary-400"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <ul className="max-h-96 overflow-y-auto">
                {notifications.length === 0 && (
                  <li className="px-4 py-6 text-center text-xs erp-text-muted">
                    {notifQuery.status === "loading" ? "Loading…" : "No notifications yet."}
                  </li>
                )}
                {notifications.map((n) => (
                  <li key={n.id} className="border-b erp-border-soft last:border-0">
                    <Link
                      to={notificationHref(n)}
                      onClick={() => {
                        setBellOpen(false);
                        if (n.status === "UNREAD") void markNotificationRead(n.id).then(() => notifQuery.refetch()).catch(() => {});
                      }}
                      className="flex gap-3 px-4 py-3 hover:erp-surface-2"
                    >
                      <span
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.status === "READ" ? "bg-dark-300 dark:bg-dark-600" : "bg-primary-500")}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold erp-text">{n.title}</span>
                        {n.body && <span className="mt-0.5 block text-xs leading-relaxed erp-text-muted">{n.body}</span>}
                        <span className="mt-1 block text-[11px] font-medium erp-text-faint">{relativeTime(n.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                to="/admin/audit"
                onClick={() => setBellOpen(false)}
                className="block border-t erp-border-soft px-4 py-2.5 text-center text-xs font-bold text-primary-600 hover:erp-surface-2 dark:text-primary-400"
              >
                View all activity
              </Link>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={userRef} className="relative">
          <button
            onClick={() => setUserOpen(!userOpen)}
            className="flex h-11 items-center gap-2 rounded-lg px-1.5 hover:erp-surface-2 sm:px-2"
            aria-label="Account menu"
            aria-expanded={userOpen}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-amber-400 text-xs font-bold text-white">
              {initials}
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 erp-text-faint sm:block" aria-hidden />
          </button>
          {userOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
              <div className="border-b erp-border-soft px-4 py-3">
                <div className="text-sm font-bold erp-text">{displayName}</div>
                <div className="truncate text-xs erp-text-muted">{sessionUser?.email}</div>
              </div>
              <Link
                to="/admin/settings"
                onClick={() => setUserOpen(false)}
                className="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm erp-text hover:erp-surface-2"
              >
                <User className="h-4 w-4 erp-text-faint" aria-hidden /> Profile & settings
              </Link>
              <Link
                to="/"
                onClick={() => setUserOpen(false)}
                className="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm erp-text hover:erp-surface-2"
              >
                <ExternalLink className="h-4 w-4 erp-text-faint" aria-hidden /> View storefront
              </Link>
              <button
                onClick={() => {
                  setUserOpen(false);
                  // logout() revokes the refresh token server-side, clears every
                  // portal's storage, notifies other tabs, and navigates home.
                  void logout();
                }}
                className="flex min-h-11 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
