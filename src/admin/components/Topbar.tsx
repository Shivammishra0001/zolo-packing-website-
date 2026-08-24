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
import { customers, jobCards, notifications, orders, rfqs } from "../mock-data";
import { useTheme, type ThemePref } from "../theme";

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

function searchEverything(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const o of orders) {
    if (o.id.toLowerCase().includes(needle) || o.customerName.toLowerCase().includes(needle))
      hits.push({ id: o.id, label: o.id, sub: o.customerName, href: `/admin/orders?search=${encodeURIComponent(o.id)}`, icon: Package });
  }
  for (const r of rfqs) {
    if (r.id.toLowerCase().includes(needle) || r.customerName.toLowerCase().includes(needle))
      hits.push({ id: r.id, label: r.id, sub: `${r.customerName} — ${r.boxType}`, href: "/admin/quotes", icon: FileText });
  }
  for (const j of jobCards) {
    if (j.id.toLowerCase().includes(needle) || j.customerName.toLowerCase().includes(needle))
      hits.push({ id: j.id, label: j.id, sub: `${j.customerName} — ${j.product}`, href: "/admin/production", icon: Wrench });
  }
  for (const c of customers) {
    if (c.company.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle))
      hits.push({ id: c.id, label: c.company, sub: c.name, href: "/admin/customers", icon: Landmark });
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
  const unread = notifications.filter((n) => !n.read).length;

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
              <div className="border-b erp-border-soft px-4 py-2.5 text-sm font-bold erp-text">Notifications</div>
              <ul className="max-h-96 overflow-y-auto">
                {notifications.map((n) => (
                  <li key={n.id} className="border-b erp-border-soft last:border-0">
                    <Link
                      to={n.href}
                      onClick={() => setBellOpen(false)}
                      className="flex gap-3 px-4 py-3 hover:erp-surface-2"
                    >
                      <span
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-dark-300 dark:bg-dark-600" : "bg-primary-500")}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold erp-text">{n.title}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed erp-text-muted">{n.body}</span>
                        <span className="mt-1 block text-[11px] font-medium erp-text-faint">{relativeTime(n.at)}</span>
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
              BM
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 erp-text-faint sm:block" aria-hidden />
          </button>
          {userOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg">
              <div className="border-b erp-border-soft px-4 py-3">
                <div className="text-sm font-bold erp-text">Bhupendra Mishra</div>
                <div className="truncate text-xs erp-text-muted">bhupendra.mishra@gmail.com</div>
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
                  nav("/");
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
