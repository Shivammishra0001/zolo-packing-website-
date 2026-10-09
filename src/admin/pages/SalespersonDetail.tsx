import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { IndianRupee, Package, TrendingUp, Users, Wallet } from "lucide-react";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, Panel } from "../components/Panel";
import { Badge, Button, KeyValue, PageHeader, Select, Tabs, Toolbar } from "../components/ui";
import { inrMinor, formatDate } from "../format";
import { RANGE_OPTIONS, resolveRange, type RangeKey } from "../date-range";
import { salespersonDetailApi, type SalespersonDetail, type SalespersonOrderRow } from "@/lib/api/sales";

// ============================================================
// Admin → Sales Team → one representative.
//
// THREE RELATIONSHIPS, DELIBERATELY NOT MERGED (the brief asks for this):
//
//   Orders      — orders this rep CAPTURED (Order.salespersonId). Every
//                 revenue figure on this page is built on these.
//   Customers   — accounts this rep OWNS (User.capturedById).
//   Collections — payments this person PHYSICALLY RECEIVED
//                 (Payment.receivedById), often an office admin instead.
//
// A customer owned by one rep can have an order captured by another, so
// adding "their customers' orders" to "their orders" would count the same
// sale twice. Each list is labelled for what it is rather than summed into
// one flattering number.
// ============================================================

const dash = <span className="erp-text-faint">—</span>;
const moneyOrDash = (m: number | null) => (m == null ? dash : inrMinor(m));

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  DELIVERED: "success",
  CANCELLED: "danger",
  SHIPPED: "neutral",
  PENDING: "warning",
};

export default function SalespersonDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<SalespersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("all");
  const [tab, setTab] = useState("orders");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = resolveRange(range);
      setData(await salespersonDetailApi.get(id, { from, to }));
    } catch (e) {
      // Never zeros on failure: an empty period and a broken request must not
      // look the same.
      setError(e instanceof Error ? e.message : "Could not load this sales person");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id, range]);

  useEffect(() => { void load(); }, [load]);

  const orderColumns: Column<SalespersonOrderRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (o) => (
        <div className="min-w-0">
          <Link to={`/admin/orders/${o.id}`} className="block truncate font-semibold erp-text hover:text-primary-600">
            {o.orderNumber}
          </Link>
          <div className="text-xs erp-text-muted">{formatDate(o.placedAt)}</div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (o) =>
        o.customerId ? (
          <Link to={`/admin/customers/${o.customerId}`} className="truncate erp-text hover:text-primary-600">
            {o.customer}
          </Link>
        ) : (
          <span className="erp-text">{o.customer}</span>
        ),
    },
    {
      key: "products",
      header: "Products",
      hideBelow: "lg",
      render: (o) => (
        <span className="line-clamp-1 text-xs erp-text-muted" title={o.products}>
          {o.products || dash}
        </span>
      ),
    },
    { key: "sale", header: "Sale", className: "text-right tabular-nums", render: (o) => <span className="font-semibold erp-text">{inrMinor(o.saleMinor)}</span> },
    { key: "received", header: "Received", className: "text-right tabular-nums", hideBelow: "md", render: (o) => inrMinor(o.receivedMinor) },
    {
      key: "balance",
      header: "Balance",
      className: "text-right tabular-nums",
      render: (o) => (
        <span className={o.balanceMinor > 0 ? "font-semibold text-amber-600" : "erp-text-muted"}>
          {inrMinor(o.balanceMinor)}
        </span>
      ),
    },
    { key: "profit", header: "Profit", className: "text-right tabular-nums", hideBelow: "lg", render: (o) => moneyOrDash(o.profitMinor) },
    {
      key: "delivery",
      header: "Delivery",
      hideBelow: "lg",
      render: (o) =>
        o.deliveryDate ? (
          <div>
            <div className="text-xs erp-text">{formatDate(o.deliveryDate)}</div>
            <div className="text-[11px] erp-text-muted">{o.delivered ? "delivered" : "expected"}</div>
          </div>
        ) : (
          dash
        ),
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      render: (o) => <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{o.status.toLowerCase().replace(/_/g, " ")}</Badge>,
    },
  ];

  if (loading && !data) {
    return (
      <div className="shell-admin">
        <PageHeader title="Sales person" breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Sales Team", to: "/admin/sales-team" }, { label: "…" }]} />
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)}
        </div>
        <Panel><TableSkeleton rows={6} /></Panel>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="shell-admin">
        <PageHeader title="Sales person" breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Sales Team", to: "/admin/sales-team" }]} />
        <Panel>
          <EmptyState
            icon={TrendingUp}
            title="Unable to load this sales person"
            message={error ?? "Not found."}
            action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
          />
        </Panel>
      </div>
    );
  }

  const { salesperson: sp, kpis } = data;

  return (
    <div className="shell-admin">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Sales Team", to: "/admin/sales-team" }, { label: sp.name }]}
        title={sp.name}
        subtitle={[sp.employeeId !== "—" ? sp.employeeId : null, sp.territory, sp.email].filter(Boolean).join(" · ")}
        actions={
          <Badge tone={sp.status === "ACTIVE" ? "success" : sp.status === "SUSPENDED" ? "warning" : "neutral"}>
            {sp.status.toLowerCase()}
          </Badge>
        }
      />

      <Toolbar>
        <Select value={range} onChange={(v) => setRange(v as RangeKey)} aria-label="Date range">
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => void load()}>Refresh</Button>
      </Toolbar>

      {!sp.hasProfile && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/5">
          <span className="font-semibold erp-text">No employee record.</span>{" "}
          <span className="erp-text-muted">
            This rep is known only from the orders they captured, so there is no employee ID, territory or joining date.
          </span>
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sales" value={inrMinor(kpis.salesMinor)} icon={IndianRupee} detail={`${kpis.orders} orders captured`} />
        <MetricCard label="Collected" value={inrMinor(kpis.collectedMinor)} icon={Wallet} detail={`${(kpis.collectionRateBps / 100).toFixed(0)}% of sales`} />
        <MetricCard
          label="Outstanding"
          value={inrMinor(kpis.outstandingMinor)}
          icon={Wallet}
          tone={kpis.outstandingMinor > 0 ? "warn" : "default"}
          detail="still to collect"
        />
        <MetricCard
          label="Profit"
          value={kpis.costedLines === 0 ? "—" : inrMinor(kpis.profitMinor)}
          icon={Package}
          detail={
            kpis.costedLines === 0
              ? "no cost recorded"
              : `covers ${(kpis.costCoverageBps / 100).toFixed(0)}% of sales`
          }
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Profile">
          <KeyValue
            items={[
              { label: "Employee ID", value: sp.employeeId },
              { label: "Phone", value: sp.phone ?? dash },
              { label: "Email", value: sp.email },
              { label: "Territory", value: sp.territory ?? dash },
              { label: "Branch", value: sp.branch ?? dash },
              { label: "Joined", value: sp.joinedAt ? formatDate(sp.joinedAt) : dash },
              { label: "Account", value: sp.isActive ? "Active" : "Inactive" },
            ]}
          />
        </Panel>

        <Panel title="Attribution">
          {/* Spelled out, because conflating these is how the same sale gets
              counted twice. */}
          <KeyValue
            items={[
              { label: "Orders captured", value: String(kpis.orders) },
              { label: "Customers owned", value: String(kpis.ownedCustomers) },
              { label: "Collected in person", value: inrMinor(kpis.collectedByThemMinor) },
              { label: "Average order", value: inrMinor(kpis.averageOrderMinor) },
              { label: "New customers", value: String(kpis.newCustomers) },
              { label: "Repeat customers", value: String(kpis.repeatCustomers) },
              { label: "Cancelled", value: String(kpis.cancelled) },
            ]}
          />
        </Panel>

        <Panel title="Orders by status">
          {Object.keys(data.ordersByStatus).length === 0 ? (
            <p className="py-6 text-center text-sm erp-text-muted">No orders in this period.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(data.ordersByStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between gap-3">
                    <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.toLowerCase().replace(/_/g, " ")}</Badge>
                    <span className="font-semibold tabular-nums erp-text">{count}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>

      {data.monthly.length > 0 && (
        <Panel title="Revenue by month" className="mb-5">
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-end gap-3">
              {data.monthly.map((m) => {
                const max = Math.max(...data.monthly.map((x) => x.salesMinor)) || 1;
                return (
                  <div key={m.month} className="flex w-20 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums erp-text-muted">{inrMinor(m.salesMinor)}</span>
                    <div className="flex h-28 w-full items-end">
                      <div
                        className="w-full rounded-t bg-primary-500/70"
                        style={{ height: `${Math.max(4, (m.salesMinor / max) * 100)}%` }}
                        title={`${m.orders} orders · collected ${inrMinor(m.collectedMinor)}`}
                      />
                    </div>
                    <span className="text-[11px] erp-text-muted">{m.month}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
      )}

      <Tabs
        tabs={[
          { key: "orders", label: `Orders (${data.orders.length})` },
          { key: "customers", label: `Customers owned (${data.customers.length})` },
          { key: "collections", label: `Collected in person (${data.collections.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      <Panel>
        {tab === "orders" ? (
          data.orders.length === 0 ? (
            <EmptyState icon={Package} title="No orders captured" message="Orders this representative captures will appear here." />
          ) : (
            <DataTable columns={orderColumns} rows={data.orders} rowKey={(o) => o.id} />
          )
        ) : tab === "customers" ? (
          data.customers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No customers owned"
              message="Accounts are owned when this rep creates the customer, or when an admin assigns them on the customer's page. Orders captured for someone else's customer still count under Orders."
            />
          ) : (
            <DataTable
              columns={[
                {
                  key: "name",
                  header: "Customer",
                  render: (c) => (
                    <Link to={`/admin/customers/${c.id}`} className="font-semibold erp-text hover:text-primary-600">
                      {c.name}
                    </Link>
                  ),
                },
                { key: "phone", header: "Phone", render: (c) => c.phone ?? dash },
                { key: "since", header: "Customer since", hideBelow: "sm", render: (c) => formatDate(c.createdAt) },
                { key: "status", header: "Status", render: (c) => <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? "active" : "inactive"}</Badge> },
              ]}
              rows={data.customers}
              rowKey={(c) => c.id}
            />
          )
        ) : data.collections.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No payments received in person"
            message="Payments recorded with this person as the receiver appear here. Money collected by an office admin against their orders is counted under Collected above, not here."
          />
        ) : (
          <DataTable
            columns={[
              { key: "date", header: "Date", render: (p) => (p.paidAt ? formatDate(p.paidAt) : dash) },
              { key: "number", header: "Payment", render: (p) => <span className="font-mono text-xs erp-text">{p.paymentNumber}</span> },
              {
                key: "order",
                header: "Order",
                render: (p) =>
                  p.orderId ? (
                    <Link to={`/admin/orders/${p.orderId}`} className="erp-text hover:text-primary-600">{p.orderNumber}</Link>
                  ) : (
                    dash
                  ),
              },
              { key: "customer", header: "Customer", hideBelow: "md", render: (p) => p.customer },
              { key: "method", header: "Mode", hideBelow: "sm", render: (p) => <Badge tone="neutral">{p.method}</Badge> },
              { key: "amount", header: "Amount", className: "text-right tabular-nums", render: (p) => <span className="font-semibold erp-text">{inrMinor(p.amountMinor)}</span> },
            ]}
            rows={data.collections}
            rowKey={(p) => p.id}
          />
        )}
      </Panel>
    </div>
  );
}
