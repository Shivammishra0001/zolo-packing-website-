import {
  FileText,
  LayoutDashboard,
  Megaphone,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "@/utils/cn";
import logoImg from "../../../images/logo.jpg";
import { pendingRfqs } from "../mock-data";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

// Admin navigation — the current, in-scope modules only. Removed modules
// (Templates, Artwork, Production, Inventory, Procurement, CMS) still have
// routes for deep links, but are intentionally not shown in the sidebar.
const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Menu",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/admin/customers", label: "Customers", icon: Users },
      { to: "/admin/sellers", label: "Sellers", icon: Store },
      { to: "/admin/quotes", label: "Quotations (RFQ)", icon: FileText, badge: pendingRfqs.length },
      { to: "/admin/orders", label: "Orders", icon: ShoppingCart },
      { to: "/admin/catalog", label: "Product Catalog", icon: Package },
      { to: "/admin/shipping", label: "Shipping", icon: Truck },
      { to: "/admin/finance", label: "Finance", icon: Wallet },
      { to: "/admin/reports", label: "Reports", icon: ReceiptText },
      { to: "/admin/marketing", label: "Marketing", icon: Megaphone },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/admin/audit", label: "Audit Logs", icon: ScrollText },
      { to: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  return (
    <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-3 py-3 no-scrollbar">
      {NAV_GROUPS.map((group) => (
        <div key={group.heading} className="mb-4 last:mb-0">
          <div
            className={cn(
              "px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest erp-text-faint",
              collapsed && "lg:hidden",
            )}
          >
            {group.heading}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                      collapsed && "lg:justify-center lg:px-0",
                      isActive
                        ? "bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                        : "erp-text-muted hover:erp-surface-2 hover:erp-text",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary-500"
                          aria-hidden
                        />
                      )}
                      <item.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          isActive ? "text-primary-600 dark:text-primary-400" : "erp-text-faint",
                        )}
                        aria-hidden
                      />
                      <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span
                          className={cn(
                            "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-500 px-1.5 text-[11px] font-bold text-white",
                            collapsed && "lg:absolute lg:right-1 lg:top-1 lg:h-4 lg:min-w-4 lg:text-[9px]",
                          )}
                          aria-label={`${item.badge} pending`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarHeader({ collapsed, onClose }: { collapsed: boolean; onClose: () => void }) {
  return (
    <div className="flex h-16 items-center gap-2.5 border-b erp-border-soft px-4">
      <Link to="/admin" className="flex min-w-0 items-center gap-2.5" onClick={onClose}>
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-black/5">
          <img src={logoImg} alt="" className="h-full w-full object-cover" />
        </div>
        <div className={cn("min-w-0 leading-tight", collapsed && "lg:hidden")}>
          <div className="font-display text-sm font-extrabold erp-text">Zolo Packaging</div>
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest erp-text-faint">
            <Store className="h-2.5 w-2.5" aria-hidden /> ERP Admin
          </div>
        </div>
      </Link>
      <button
        onClick={onClose}
        className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2 lg:hidden"
        aria-label="Close menu"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
}: {
  /** Icon-only rail on desktop */
  collapsed: boolean;
  /** Drawer visibility below lg */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r erp-border erp-surface lg:flex",
          collapsed ? "w-[68px]" : "w-60",
        )}
      >
        <SidebarHeader collapsed={collapsed} onClose={onCloseMobile} />
        <SidebarNav collapsed={collapsed} onNavigate={onCloseMobile} />
      </aside>

      {/* Mobile / tablet drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <div className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm" onClick={onCloseMobile} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col erp-surface shadow-xl">
            <SidebarHeader collapsed={false} onClose={onCloseMobile} />
            <SidebarNav collapsed={false} onNavigate={onCloseMobile} />
          </div>
        </div>
      )}
    </>
  );
}
