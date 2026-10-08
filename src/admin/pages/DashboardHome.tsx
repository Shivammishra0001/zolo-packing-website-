import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  Building2,
  FileText,
  FilePlus,
  IndianRupee,
  Package,
  PackagePlus,
  PhoneCall,
  Sparkles,
  CalendarClock,
  Clock,
  TriangleAlert,
  Truck,
  Users,
  AlertTriangle,
  UserPlus,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { EmptyState, ListSkeleton, Panel, QueryState, Skeleton } from "../components/Panel";
import { Badge, Button } from "../components/ui";
import { inr, inrMinor } from "../format";
import {
  asQueryState,
  useAdminActionQueue,
  useAdminAnalytics,
  useAdminCollections,
  useAdminDashboard,
  useAdminShipping,
} from "../dashboard-api";

// ---------- 1. KPI row ----------

function KpiRow() {
  // Real figures from PostgreSQL (GET /admin/dashboard), polled so a new order
  // appears without a manual refresh.
  const q = useAdminDashboard();

  if (q.status === "loading") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <MetricCardSkeleton key={i} />)}
      </div>
    );
  }
  if (q.status === "error") {
    // Never fall back to zeros — a failed load must look different from "no data".
    return (
      <Panel>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold erp-text">Unable to load dashboard</p>
            <p className="text-xs erp-text-muted">{q.error}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={q.refetch}>Retry</Button>
        </div>
      </Panel>
    );
  }

  const d = q.data;
  const rupees = (minor: number) => inr(minor / 100);
  const openOrders = d.orders.pending + d.orders.confirmed + d.orders.processing + d.orders.packed;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Today's Revenue" value={rupees(d.revenue.todayMinor)} icon={IndianRupee} detail="from placed orders" to="/admin/finance" />
      <MetricCard label="Today's Orders" value={d.orders.today} icon={Package} detail={`${d.orders.total} all time`} to="/admin/orders" />
      <MetricCard label="Open Orders" value={openOrders} icon={FileText} tone={openOrders > 0 ? "warn" : "default"} detail="awaiting fulfilment" to="/admin/orders" />
      <MetricCard label="Shipped" value={d.orders.shipped} icon={Truck} detail={`${d.orders.delivered} delivered`} to="/admin/orders" />
      <MetricCard label="Customers" value={d.customers.total} icon={Users} detail={`${d.customers.newToday} new today`} to="/admin/customers" />
      <MetricCard label="Products" value={d.products.total} icon={Boxes} detail={`${d.products.outOfStock} out of stock`} to="/admin/catalog" />
      <MetricCard label="Low Stock" value={d.products.lowStock} icon={AlertTriangle} tone={d.products.lowStock > 0 ? "danger" : "default"} detail="at or below threshold" to="/admin/inventory" />
      <MetricCard label="Payments Pending" value={d.payments.pending} icon={Wallet} tone={d.payments.pending > 0 ? "warn" : "default"} detail={`${d.payments.paid} paid`} to="/admin/finance" />
    </div>
  );
}

// ---------- 1b. Recent orders + activity (database-driven) ----------

function RecentOrdersAndActivity() {
  const q = useAdminDashboard();

  if (q.status === "loading") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent Orders"><div className="p-4 text-sm erp-text-muted">Loading…</div></Panel>
        <Panel title="Recent Activity"><div className="p-4 text-sm erp-text-muted">Loading…</div></Panel>
      </div>
    );
  }
  if (q.status === "error") {
    return (
      <Panel title="Recent Orders">
        <div className="flex items-center gap-3 p-4">
          <p className="flex-1 text-sm erp-text-muted">{q.error}</p>
          <Button size="sm" variant="secondary" onClick={q.refetch}>Retry</Button>
        </div>
      </Panel>
    );
  }

  const { recentOrders, recentActivity } = q.data;
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Recent Orders" action={<Link to="/admin/orders" className="text-xs font-semibold text-primary-600 hover:underline">View all</Link>}>
        {recentOrders.length === 0 ? (
          <div className="p-6 text-center text-sm erp-text-muted">No orders yet.</div>
        ) : (
          <ul className="divide-y erp-border-soft">
            {recentOrders.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/orders/${o.id}`} className="font-mono text-xs font-semibold erp-text hover:text-primary-600">{o.orderNumber}</Link>
                  <p className="truncate text-[11px] erp-text-faint">{o.customer?.name ?? "Guest"} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {when(o.createdAt)}</p>
                </div>
                <Badge tone={o.status === "CANCELLED" ? "danger" : o.status === "DELIVERED" ? "success" : "warning"}>{o.status}</Badge>
                <span className="tabular-nums text-sm font-bold erp-text">{inr(o.grandTotalMinor / 100)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent Activity" action={<Link to="/admin/audit" className="text-xs font-semibold text-primary-600 hover:underline">View all</Link>}>
        {recentActivity.length === 0 ? (
          <div className="p-6 text-center text-sm erp-text-muted">No activity yet.</div>
        ) : (
          <ul className="divide-y erp-border-soft">
            {recentActivity.map((a) => (
              <li key={a.id} className="px-4 py-2.5">
                <p className="text-xs font-semibold erp-text">{a.title}</p>
                <p className="truncate text-[11px] erp-text-muted">{a.body}</p>
                <p className="text-[10px] erp-text-faint">{a.actor} · {when(a.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ---------- 2. Sales chart (inline SVG, single brand hue) ----------

const DAY_MS = 86_400_000;

/**
 * The analytics endpoint only returns days that actually had orders. A bar
 * chart needs every day present, so pad the gaps with zeros and label them
 * relative to today — otherwise a quiet week silently compresses the axis.
 */
function fillDays(series: { day: string; revenueMinor: number }[], days: number) {
  const byDay = new Map(series.map((d) => [String(d.day).slice(0, 10), d.revenueMinor]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today.getTime() - (days - 1 - i) * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    const offset = days - 1 - i;
    return {
      day: offset === 0 ? "Today" : `D-${offset}`,
      revenue: byDay.get(key) ?? 0,
    };
  });
}

/**
 * Short money label for a chart axis, from PAISE.
 *
 * The series carries integer minor units, so dividing by 1000 would read a
 * ₹52,000 day as "5200k". Convert to rupees first, then use Indian scale
 * words: a B2B day is lakhs, not thousands of thousands.
 */
function axisLabel(minor: number): string {
  const rupees = minor / 100;
  if (rupees >= 10_000_000) return `${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `${Math.round(rupees / 1_000)}k`;
  return String(Math.round(rupees));
}

function SalesChart() {
  const q = asQueryState(useAdminAnalytics(14));
  const [hover, setHover] = useState<number | null>(null);
  const total = q.data ? q.data.series.reduce((s, d) => s + d.revenueMinor, 0) : 0;
  return (
    <Panel
      title="Revenue — Last 14 Days"
      action={
        q.data ? (
          <span className="text-xs font-semibold erp-text-muted">
            Total <span className="erp-text">{inrMinor(total)}</span>
          </span>
        ) : null
      }
    >
      <QueryState query={q} skeleton={<Skeleton className="h-56 w-full" />}>
        {(payload) => {
          const data = fillDays(payload.series, 14);
          if (data.every((d) => d.revenue === 0)) {
            return <p className="py-16 text-center text-sm erp-text-muted">No revenue data yet.</p>;
          }
          const max = Math.max(...data.map((d) => d.revenue)) || 1;
          // Gridline steps (recessive) at 0/25/50/75/100%
          const steps = [0, 0.25, 0.5, 0.75, 1];
          return (
            <div className="relative">
              <div className="flex h-56 items-stretch gap-2">
                {/* Y grid + labels */}
                <div className="relative flex w-12 shrink-0 flex-col justify-between py-1 text-right">
                  {[...steps].reverse().map((s) => (
                    <span key={s} className="text-[10px] tabular-nums erp-text-faint">
                      {s === 0 ? "0" : axisLabel(max * s)}
                    </span>
                  ))}
                </div>
                {/* Plot */}
                <div className="relative flex-1">
                  {/* gridlines */}
                  <div className="absolute inset-0 flex flex-col justify-between">
                    {steps.map((s) => (
                      <span key={s} className="h-px w-full erp-border border-t" aria-hidden />
                    ))}
                  </div>
                  {/* bars */}
                  <div className="absolute inset-0 flex items-end justify-between gap-[3px] sm:gap-1.5">
                    {data.map((d, i) => {
                      const h = (d.revenue / max) * 100;
                      const active = hover === i;
                      const isToday = d.day === "Today";
                      return (
                        <div
                          key={d.day}
                          className="group relative flex h-full flex-1 items-end"
                          onMouseEnter={() => setHover(i)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(i)}
                          onBlur={() => setHover(null)}
                          tabIndex={0}
                          role="img"
                          aria-label={`${d.day}: ${inrMinor(d.revenue)}`}
                        >
                          <div
                            className={cn(
                              "w-full rounded-t transition-colors",
                              isToday
                                ? "bg-primary-500"
                                : active
                                  ? "bg-primary-500"
                                  : "bg-primary-500/35 group-hover:bg-primary-500/60",
                            )}
                            style={{ height: `${Math.max(h, 2)}%` }}
                          />
                          {active && (
                            <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border erp-border erp-surface px-2.5 py-1.5 text-center card-shadow">
                              <div className="text-xs font-bold erp-text">{inrMinor(d.revenue)}</div>
                              <div className="text-[10px] erp-text-muted">{d.day}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              {/* X labels */}
              <div className="mt-2 flex gap-[3px] pl-14 sm:gap-1.5">
                {data.map((d) => (
                  <span
                    key={d.day}
                    className={cn(
                      "flex-1 text-center text-[9px] tabular-nums sm:text-[10px]",
                      d.day === "Today" ? "font-bold erp-text" : "erp-text-faint",
                    )}
                  >
                    {d.day === "Today" ? "Today" : d.day.replace("D-", "")}
                  </span>
                ))}
              </div>
            </div>
          );
        }}
      </QueryState>
    </Panel>
  );
}

// ---------- 3. Order pipeline (funnel across statuses) ----------

// The pipeline mirrors the database's OrderStatus enum — not the ERP-flavoured
// mock statuses — so the counts here always reconcile with the Orders module.
const PIPELINE: { status: string; label: string; dot: string }[] = [
  { status: "PENDING", label: "Pending", dot: "bg-slate-400" },
  { status: "CONFIRMED", label: "Confirmed", dot: "bg-blue-500" },
  { status: "PROCESSING", label: "Processing", dot: "bg-indigo-500" },
  { status: "PACKED", label: "Packed", dot: "bg-violet-500" },
  { status: "SHIPPED", label: "Shipped", dot: "bg-amber-500" },
  { status: "DELIVERED", label: "Delivered", dot: "bg-emerald-500" },
  { status: "CANCELLED", label: "Cancelled", dot: "bg-rose-500" },
];

function OrderPipeline() {
  const q = asQueryState(useAdminDashboard());
  return (
    <Panel title="Order Pipeline">
      <QueryState
        query={q}
        skeleton={
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px]" />
            ))}
          </div>
        }
      >
        {(data) => {
          const countFor = (status: string) =>
            (data.orders as unknown as Record<string, number>)[status.toLowerCase()] ?? 0;
          const maxCount = Math.max(1, ...PIPELINE.map((p) => countFor(p.status)));
          return (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {PIPELINE.map(({ status, label, dot }) => {
                const count = countFor(status);
                return (
                  <li key={status}>
                    <Link
                      to={`/admin/orders?status=${status}`}
                      className="flex min-h-11 flex-col gap-2 rounded-lg border erp-border p-3 transition-colors hover:border-dark-300 hover:erp-surface-2 dark:hover:border-dark-600"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold erp-text-muted">
                        <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
                        <span className="truncate">{label}</span>
                      </span>
                      <span className="font-display text-xl font-extrabold tracking-tight erp-text">
                        {count}
                      </span>
                      <span className="h-1.5 w-full overflow-hidden rounded-full erp-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-primary-500"
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </QueryState>
    </Panel>
  );
}

// ---------- 5. Top products ----------

function TopProducts() {
  // Best sellers aggregated from order_items server-side (GET /admin/analytics).
  const q = asQueryState(useAdminAnalytics(30));
  return (
    <Panel title="Top Products" bodyClassName="p-0">
      <QueryState query={q} skeleton={<div className="p-4"><ListSkeleton rows={5} /></div>}>
        {(payload) => {
          const data = payload.topProducts.map((p) => ({
            id: p.productId, name: p.name, sku: p.sku, units: p.units, revenue: p.revenueMinor,
          }));
          if (data.length === 0) {
            return <div className="p-6 text-center text-sm erp-text-muted">No product sales yet.</div>;
          }
          const max = Math.max(...data.map((p) => p.revenue)) || 1;
          return (
            <ul>
              {data.map((p, i) => (
                <li
                  key={p.name}
                  className="flex items-center gap-3 border-b erp-border-soft px-4 py-3 last:border-0 sm:px-5"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg erp-surface-2 text-xs font-bold erp-text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold erp-text">{p.name}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full erp-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-full bg-primary-500/70"
                          style={{ width: `${(p.revenue / max) * 100}%` }}
                        />
                      </span>
                      <span className="text-[11px] erp-text-muted">
                        {p.units.toLocaleString("en-IN")} units
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-bold erp-text tabular-nums">
                    {inr(p.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </Panel>
  );
}

// ---------- 7. Quick actions ----------

const QUICK_ACTIONS = [
  { label: "New Order", icon: Package, to: "/admin/orders?new=1" },
  { label: "New Quotation", icon: FileText, to: "/admin/quotes?new=1" },
  { label: "New Customer", icon: UserPlus, to: "/admin/customers?new=1" },
  { label: "Add Product", icon: PackagePlus, to: "/admin/catalog?new=1" },
  { label: "Create PO", icon: FilePlus, to: "/admin/procurement?new=1" },
  { label: "New Invoice", icon: Wallet, to: "/admin/finance?new=1" },
];

function QuickActions() {
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary-500" aria-hidden /> Quick Actions</span>}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.label}
            to={a.to}
            className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border erp-border p-3 text-center transition-colors hover:border-primary-300 hover:erp-surface-2 dark:hover:border-primary-500/40"
          >
            <a.icon className="h-5 w-5 text-primary-500" aria-hidden />
            <span className="text-xs font-semibold erp-text">{a.label}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

// ---------- 8. Inventory alerts ----------

function InventoryAlerts() {
  // Low-stock products come from the same polled dashboard query as the KPIs,
  // so the "Low stock" tile and this list can never disagree.
  const q = asQueryState(useAdminDashboard());
  return (
    <Panel
      title="Inventory Alerts"
      action={
        <Link
          to="/admin/inventory"
          className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700"
        >
          Inventory <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      <QueryState
        query={q}
        skeleton={<div className="p-4"><ListSkeleton rows={3} /></div>}
        isEmpty={(d) => d.lowStockProducts.length === 0}
        empty={<EmptyState icon={Boxes} message="All products are above their reorder level." />}
      >
        {(data) => (
          <ul>
            {data.lowStockProducts.map((p) => {
              const critical = p.available === 0;
              return (
                <li key={p.id} className="border-b erp-border-soft last:border-0">
                  <Link
                    to="/admin/inventory"
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors erp-hover sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold erp-text">{p.name}</span>
                      <span className="block text-xs erp-text-muted">
                        {p.sku} · {p.available.toLocaleString("en-IN")} available
                      </span>
                    </span>
                    <Badge tone={critical ? "danger" : "warning"}>
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                      {critical ? "Out of stock" : `Below ${p.threshold ?? 0}`}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

// ---------- 9. Dispatch pending ----------

function DispatchPanel() {
  // Real shipments (GET /admin/shipping); anything not yet delivered is pending.
  const q = asQueryState(useAdminShipping());
  return (
    <Panel
      title="Dispatch Pending"
      action={
        <Link
          to="/admin/shipping"
          className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700"
        >
          Shipping <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      }
      bodyClassName="p-0"
    >
      <QueryState
        query={q}
        skeleton={<div className="p-4"><ListSkeleton rows={4} /></div>}
        isEmpty={(d) => d.shipments.filter((s) => s.status !== "DELIVERED" && s.status !== "CANCELLED").length === 0}
        empty={<EmptyState icon={Truck} message="Nothing pending dispatch." />}
      >
        {(data) => (
          <ul>
            {data.shipments
              .filter((s) => s.status !== "DELIVERED" && s.status !== "CANCELLED")
              .slice(0, 8)
              .map((s) => (
                <li key={s.id} className="border-b erp-border-soft last:border-0">
                  <Link
                    to="/admin/shipping"
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors erp-hover sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold erp-text">
                        {s.orderNumber ?? s.shipmentNumber}
                      </span>
                      <span className="block text-xs erp-text-muted">
                        {s.shipmentNumber}
                        {s.trackingNumber ? ` · ${s.trackingNumber}` : ""} · {s.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold erp-text-muted">{s.carrier ?? "—"}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

/** Live today-revenue chip in the page header (same polled query as the KPIs). */
function TodayRevenueChip() {
  const q = useAdminDashboard();
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs erp-text-faint">Revenue today</span>
      <span className="rounded-lg border erp-border erp-surface-2 px-2.5 py-1 text-xs font-bold erp-text tabular-nums">
        {q.status === "success" ? inrMinor(q.data.revenue.todayMinor) : "—"}
      </span>
    </div>
  );
}


// ---------- Needs attention: collections + the action queue ----------

/**
 * The money that is late, and who to call about it.
 *
 * Ageing buckets rather than one "outstanding" figure: 4.5 lakh owed is a
 * different problem depending on whether it is a week old or three months old,
 * and a single total hides that completely.
 */
function CollectionsPanel() {
  const q = asQueryState(useAdminCollections());
  return (
    <Panel
      title="Collections"
      action={
        <Link to="/admin/payments" className="text-xs font-semibold text-primary-600 hover:underline">
          Payments
        </Link>
      }
    >
      <QueryState query={q} skeleton={<ListSkeleton rows={4} />}>
        {(d) => {
          const buckets = [
            { key: "current", label: "Under 15 days", tone: "erp-text-muted", data: d.ageing.current },
            { key: "d15", label: "15–30 days", tone: "text-amber-600", data: d.ageing.d15 },
            { key: "d30", label: "30–60 days", tone: "text-orange-600", data: d.ageing.d30 },
            { key: "d60", label: "Over 60 days", tone: "text-red-600", data: d.ageing.d60 },
          ];
          return (
            <div className="space-y-4">
              <div>
                <div className="font-display text-2xl font-extrabold tracking-tight erp-text">
                  {inrMinor(d.totalOutstandingMinor)}
                </div>
                <p className="text-xs erp-text-muted">
                  outstanding across {d.openOrders} order{d.openOrders === 1 ? "" : "s"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {buckets.map((b) => (
                  <div key={b.key} className="rounded-lg erp-surface-2 p-2.5">
                    <div className={cn("text-sm font-bold tabular-nums", b.tone)}>
                      {inrMinor(b.data.amountMinor)}
                    </div>
                    <div className="text-[11px] erp-text-muted">{b.label}</div>
                    <div className="text-[11px] erp-text-faint">{b.data.orders} orders</div>
                  </div>
                ))}
              </div>
              {d.followUps.length === 0 ? (
                <EmptyState
                  icon={PhoneCall}
                  title="Nothing overdue"
                  message="No order has been unpaid for more than two weeks."
                />
              ) : (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide erp-text-muted">
                    Follow up today
                  </p>
                  <ul className="divide-y erp-divide">
                    {d.followUps.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/admin/orders/${f.id}`}
                            className="block truncate text-sm font-semibold erp-text hover:text-primary-600"
                          >
                            {f.customer}
                          </Link>
                          <div className="truncate text-xs erp-text-muted">
                            {f.orderNumber}
                            {f.salesperson ? ` · ${f.salesperson}` : ""}
                            {f.phone ? ` · ${f.phone}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold tabular-nums erp-text">
                            {inrMinor(f.outstandingMinor)}
                          </div>
                          <div
                            className={cn(
                              "text-[11px] font-semibold",
                              f.daysOverdue >= 60 ? "text-red-600" : f.daysOverdue >= 30 ? "text-orange-600" : "text-amber-600",
                            )}
                            // The basis matters: "90 days since the order" is a
                            // weaker claim than "90 days past agreed terms".
                            title={f.basis === "due" ? "past the agreed due date" : "since the order was placed"}
                          >
                            {f.daysOverdue}d {f.basis === "due" ? "overdue" : "old"}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </Panel>
  );
}

/** Work promised, work unconfirmed, and leads going cold. */
function ActionQueuePanel() {
  const q = asQueryState(useAdminActionQueue());
  return (
    <Panel title="Needs action">
      <QueryState query={q} skeleton={<ListSkeleton rows={4} />}>
        {(d) => {
          const chips = [
            { label: "Awaiting confirmation", value: d.unconfirmedOrders, to: "/admin/orders?status=PENDING", tone: d.unconfirmedOrders > 0 },
            { label: "Deliveries overdue", value: d.deliveries.lateCount, to: "/admin/orders", tone: d.deliveries.lateCount > 0 },
            { label: "Enquiries to quote", value: d.leads.openRfqs, to: "/admin/quotes", tone: d.leads.openRfqs > 0 },
            { label: "Low stock", value: d.lowStock, to: "/admin/inventory", tone: d.lowStock > 0 },
          ];
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {chips.map((c) => (
                  <Link
                    key={c.label}
                    to={c.to}
                    className={cn(
                      "rounded-lg border p-2.5 transition-colors",
                      c.tone
                        ? "border-amber-200 bg-amber-50/60 hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-500/5"
                        : "erp-border erp-surface-2 hover:border-dark-300 dark:hover:border-dark-600",
                    )}
                  >
                    <div className="text-lg font-extrabold tabular-nums erp-text">{c.value}</div>
                    <div className="text-[11px] erp-text-muted">{c.label}</div>
                  </Link>
                ))}
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide erp-text-muted">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Delivering this week
                </p>
                {d.deliveries.dueSoon.length === 0 ? (
                  <p className="py-2 text-sm erp-text-muted">No deliveries promised in the next 7 days.</p>
                ) : (
                  <ul className="divide-y erp-divide">
                    {d.deliveries.dueSoon.map((o) => (
                      <li key={o.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <Link to={`/admin/orders/${o.id}`} className="block truncate text-sm font-semibold erp-text hover:text-primary-600">
                            {o.customer}
                          </Link>
                          <div className="truncate text-xs erp-text-muted">{o.orderNumber} · {o.status.toLowerCase()}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold tabular-nums erp-text">{inrMinor(o.valueMinor)}</div>
                          <div className="text-[11px] erp-text-muted">
                            {o.daysAway <= 0 ? "today" : o.daysAway === 1 ? "tomorrow" : `in ${o.daysAway}d`}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {d.leads.staleQuotes.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide erp-text-muted">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> Quotes with no reply
                  </p>
                  <ul className="divide-y erp-divide">
                    {d.leads.staleQuotes.map((qt) => (
                      <li key={qt.id} className="flex items-center gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <Link to={`/admin/quotes/${qt.id}`} className="block truncate text-sm font-semibold erp-text hover:text-primary-600">
                            {qt.customer}
                          </Link>
                          <div className="truncate text-xs erp-text-muted">{qt.number}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-bold tabular-nums erp-text">{inrMinor(qt.valueMinor)}</div>
                          <div className="text-[11px] text-amber-600">{qt.daysWaiting}d waiting</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </Panel>
  );
}

// ---------- Page ----------

export default function DashboardHome() {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <div className="shell-admin space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-xl font-extrabold tracking-tight erp-text sm:text-2xl">
              Command Center
            </h1>
            <p className="mt-0.5 text-sm erp-text-muted">{today}</p>
          </div>
        </div>
        <TodayRevenueChip />
      </div>

      <KpiRow />

      {/* Attention before analysis: what must someone do today, above how the
          business is trending. */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <CollectionsPanel />
        <ActionQueuePanel />
      </div>

      {/* Database-driven: new orders and business events appear here without a
          manual refresh (the dashboard query polls). */}
      <RecentOrdersAndActivity />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 xl:col-span-2">
          <SalesChart />
          <OrderPipeline />
        </div>
        <div className="space-y-4 sm:space-y-5">
          <QuickActions />
          <TopProducts />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <InventoryAlerts />
        <DispatchPanel />
      </div>
    </div>
  );
}
