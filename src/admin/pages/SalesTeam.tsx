import { useCallback, useEffect, useMemo, useState } from "react";
import { IndianRupee, Package, TrendingUp, Users, Wallet } from "lucide-react";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, Panel } from "../components/Panel";
import { Badge, Button, PageHeader, Select, Toolbar } from "../components/ui";
import { inrMinor } from "../format";
import { RANGE_OPTIONS, resolveRange, type RangeKey } from "../date-range";
import { adminSalesApi, type PerformanceRow } from "@/lib/api/sales";

// ============================================================
// Admin → Sales Team (§3).
//
// The aggregation behind this page already existed and was routed
// (GET /admin/sales/performance), but nothing in the frontend called it, so
// the business could not see which rep brought in which revenue.
//
// Every figure is computed server-side from Order rows carrying salespersonId.
// Nothing here is summed in the browser, so the leaderboard cannot drift from
// the orders it describes.
// ============================================================

/** Collection rate arrives as basis points (8000 = 80.00%). */
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  LEFT: "neutral",
};

export default function SalesTeam() {
  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = resolveRange(range);
      const res = await adminSalesApi.performance({ from, to });
      setRows(res.rows);
    } catch (e) {
      // Never fall back to zeros: an empty team and a failed request must not
      // look the same.
      setError(e instanceof Error ? e.message : "Could not load sales performance");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Team totals. Derived from the same rows the table shows, so the header and
  // the table can never disagree.
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          orders: acc.orders + r.orders,
          salesMinor: acc.salesMinor + r.salesMinor,
          collectedMinor: acc.collectedMinor + r.collectedMinor,
          outstandingMinor: acc.outstandingMinor + r.outstandingMinor,
          newCustomers: acc.newCustomers + r.newCustomers,
        }),
        { orders: 0, salesMinor: 0, collectedMinor: 0, outstandingMinor: 0, newCustomers: 0 },
      ),
    [rows],
  );

  const columns: Column<PerformanceRow>[] = [
    {
      key: "name",
      header: "Sales person",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold erp-text">{r.name}</div>
          <div className="truncate text-xs erp-text-muted">
            {r.employeeId}
            {r.territory ? ` · ${r.territory}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      className: "text-right tabular-nums",
      render: (r) => (
        <div>
          <div className="font-semibold erp-text">{r.orders}</div>
          {r.cancelled > 0 && (
            <div className="text-xs text-amber-600">{r.cancelled} cancelled</div>
          )}
        </div>
      ),
    },
    {
      key: "sales",
      header: "Revenue",
      className: "text-right tabular-nums",
      render: (r) => <span className="font-semibold erp-text">{inrMinor(r.salesMinor)}</span>,
    },
    {
      key: "collected",
      header: "Collected",
      className: "text-right tabular-nums",
      hideBelow: "md",
      render: (r) => (
        <div>
          <div className="erp-text">{inrMinor(r.collectedMinor)}</div>
          <div className="text-xs erp-text-muted">{pct(r.collectionRateBps)} of revenue</div>
        </div>
      ),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right tabular-nums",
      render: (r) => (
        <span className={r.outstandingMinor > 0 ? "font-semibold text-amber-600" : "erp-text-muted"}>
          {inrMinor(r.outstandingMinor)}
        </span>
      ),
    },
    {
      key: "aov",
      header: "Avg order",
      className: "text-right tabular-nums",
      hideBelow: "lg",
      render: (r) => <span className="erp-text">{inrMinor(r.averageOrderMinor)}</span>,
    },
    {
      key: "customers",
      header: "Customers",
      className: "text-right tabular-nums",
      hideBelow: "lg",
      render: (r) => (
        <div>
          <div className="erp-text">{r.newCustomers + r.repeatCustomers}</div>
          <div className="text-xs erp-text-muted">{r.newCustomers} new</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.toLowerCase()}</Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales Team"
        subtitle="Revenue, collection and customer growth per representative"
      />

      <Toolbar>
        <Select value={range} onChange={(v) => setRange(v as RangeKey)} aria-label="Date range">
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </Toolbar>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label="Team revenue" value={inrMinor(totals.salesMinor)} icon={IndianRupee} detail="orders placed in range" />
            <MetricCard label="Collected" value={inrMinor(totals.collectedMinor)} icon={Wallet} detail="received against those orders" />
            <MetricCard
              label="Outstanding"
              value={inrMinor(totals.outstandingMinor)}
              icon={Wallet}
              tone={totals.outstandingMinor > 0 ? "warn" : "default"}
              detail="still to collect"
            />
            <MetricCard label="Orders" value={totals.orders} icon={Package} detail={`${rows.length} reps reporting`} />
            <MetricCard label="New customers" value={totals.newCustomers} icon={Users} detail="first order in range" />
          </>
        )}
      </div>

      <Panel title="Leaderboard">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : error ? (
          <EmptyState
            icon={TrendingUp}
            title="Unable to load sales performance"
            message={error}
            action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No sales activity in this period"
            message="Orders captured by a sales representative will appear here. Add representatives from the Users page."
          />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.salespersonId} />
        )}
      </Panel>
    </div>
  );
}
