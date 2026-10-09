import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileBarChart, IndianRupee, Loader2, Package, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, Panel } from "../components/Panel";
import { Badge, Button, PageHeader, Pagination, SearchInput, Select, Toolbar } from "../components/ui";
import { useToast } from "@/components/ui/Toast";
import { inrMinor, formatDate } from "../format";
import { RANGE_OPTIONS, resolveRange, type RangeKey } from "../date-range";
import { buildFinancialWorkbook, financialReportFilename } from "../reports/financial-xlsx";
import {
  adminReportsApi,
  type FinancialReportRow,
  type FinancialReportTotals,
} from "@/lib/api/admin-crm";
import { adminSalesApi, type SalespersonRow } from "@/lib/api/sales";

// ============================================================
// Admin → Reports → Sales & Financial Details.
//
// One row per order LINE. Qty/Rate/Sale/Cost/Profit are per line; Amount
// Received and Balance belong to the ORDER and are shown only on its first
// row, so summing a column never counts the same receipt twice. The same rule
// is applied server-side, and the export carries the note with it.
//
// Export sends `all=1` so the spreadsheet contains every matching row, not the
// page on screen — built from the same endpoint and the same filters, so the
// two can never disagree.
// ============================================================

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED",
  "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED",
];

const COLLECTION_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  Collected: "success",
  "Part collected": "warning",
  Overdue: "danger",
  Pending: "neutral",
};

/** A blank cell, so "unknown" never reads as zero. */
const dash = <span className="erp-text-faint">—</span>;
const moneyOrDash = (m: number | null) => (m == null ? dash : inrMinor(m));

export default function Reports() {
  const toast = useToast();
  const [rows, setRows] = useState<FinancialReportRow[]>([]);
  const [totals, setTotals] = useState<FinancialReportTotals | null>(null);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reps, setReps] = useState<SalespersonRow[]>([]);

  const [range, setRange] = useState<RangeKey>("30d");
  const [salespersonId, setSalespersonId] = useState("");
  const [status, setStatus] = useState("");
  const [collection, setCollection] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // One object, so the table and the export cannot drift apart.
  const filters = useMemo(() => {
    const { from, to } = resolveRange(range);
    return {
      from, to,
      salespersonId: salespersonId || undefined,
      status: status || undefined,
      collection: collection || undefined,
      q: search.trim() || undefined,
      sort, dir,
    };
  }, [range, salespersonId, status, collection, search, sort, dir]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminReportsApi.salesFinancial({ ...filters, page, limit: PAGE_SIZE });
      setRows(res.rows);
      setTotals(res.totals);
      setMeta({ total: res.total, pages: res.pages });
    } catch (e) {
      // Never fall back to zeros: a failed load must not look like an empty
      // period.
      setError(e instanceof Error ? e.message : "Could not load the report");
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [filters]);

  useEffect(() => {
    adminSalesApi.list().then((r) => setReps(r.salespeople)).catch(() => setReps([]));
  }, []);

  async function exportXlsx() {
    setExporting(true);
    try {
      // `all: true` — the brief is explicit that the export must contain every
      // matching record, not the page being viewed.
      const res = await adminReportsApi.salesFinancial({ ...filters, all: true });
      if (res.rows.length === 0) {
        toast.error("Nothing to export", "No rows match the current filters.");
        return;
      }
      const wb = buildFinancialWorkbook(res.rows);
      XLSX.writeFile(wb, financialReportFilename());
      toast.success(
        "Export ready",
        `${res.rows.length.toLocaleString("en-IN")} rows downloaded.${res.truncated ? " Capped at the export limit." : ""}`,
      );
    } catch (e) {
      toast.error("Export failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<FinancialReportRow>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (r) => (
        <div className="min-w-0">
          {r.customerId ? (
            <Link to={`/admin/customers/${r.customerId}`} className="block truncate font-semibold erp-text hover:text-primary-600">
              {r.customerName}
            </Link>
          ) : (
            <span className="truncate font-semibold erp-text">{r.customerName}</span>
          )}
          <div className="truncate text-xs erp-text-muted">{r.customerId ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "order",
      header: "Order",
      render: (r) => (
        <div className="min-w-0">
          <Link to={`/admin/orders/${r.orderId}`} className="block truncate font-semibold erp-text hover:text-primary-600">
            {r.orderNumber}
          </Link>
          <div className="text-xs erp-text-muted">{formatDate(r.orderDate)}</div>
        </div>
      ),
    },
    { key: "product", header: "Product", render: (r) => <span className="erp-text">{r.productName}</span> },
    { key: "qty", header: "Qty", className: "text-right tabular-nums", render: (r) => r.quantity.toLocaleString("en-IN") },
    { key: "rate", header: "Rate", className: "text-right tabular-nums", hideBelow: "lg", render: (r) => inrMinor(r.rateMinor) },
    { key: "sale", header: "Sale", className: "text-right tabular-nums", render: (r) => <span className="font-semibold erp-text">{inrMinor(r.saleMinor)}</span> },
    { key: "cost", header: "Cost", className: "text-right tabular-nums", hideBelow: "lg", render: (r) => moneyOrDash(r.costMinor) },
    {
      key: "received",
      header: "Received",
      className: "text-right tabular-nums",
      hideBelow: "md",
      // Blank on continuation lines: the receipt belongs to the order, and
      // repeating it per line would make the column sum to a multiple.
      render: (r) =>
        r.isFirstLineOfOrder ? (
          moneyOrDash(r.receivedMinor)
        ) : (
          <span className="erp-text-faint" title="Shown on the first line of this order">↑</span>
        ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right tabular-nums",
      render: (r) =>
        r.isFirstLineOfOrder ? (
          <span className={r.balanceMinor && r.balanceMinor > 0 ? "font-semibold text-amber-600" : "erp-text-muted"}>
            {moneyOrDash(r.balanceMinor)}
          </span>
        ) : (
          <span className="erp-text-faint" title="Shown on the first line of this order">↑</span>
        ),
    },
    { key: "profit", header: "Profit", className: "text-right tabular-nums", hideBelow: "lg", render: (r) => moneyOrDash(r.profitMinor) },
    {
      key: "delivery",
      header: "Delivery",
      hideBelow: "lg",
      render: (r) =>
        r.deliveryDate ? (
          <div>
            <div className="text-xs erp-text">{formatDate(r.deliveryDate)}</div>
            <div className="text-[11px] erp-text-muted">{r.deliveredActual ? "delivered" : "expected"}</div>
          </div>
        ) : (
          dash
        ),
    },
    { key: "rep", header: "Sales person", hideBelow: "lg", render: (r) => (r.salesperson ? <span className="text-xs erp-text">{r.salesperson}</span> : dash) },
    { key: "status", header: "Status", hideBelow: "sm", render: (r) => <Badge tone="neutral">{r.orderStatus.toLowerCase().replace(/_/g, " ")}</Badge> },
    {
      key: "collection",
      header: "Collection",
      hideBelow: "md",
      render: (r) => <Badge tone={COLLECTION_TONE[r.collectionStatus] ?? "neutral"}>{r.collectionStatus}</Badge>,
    },
  ];

  return (
    <div className="shell-admin">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Reports" }]}
        title="Sales & Financial Details"
        subtitle="One row per order line, from live order, payment and delivery records."
        actions={
          <Button onClick={() => void exportXlsx()} disabled={exporting || loading}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Export Excel
          </Button>
        }
      />

      <Toolbar>
        <Select value={range} onChange={(v) => setRange(v as RangeKey)} aria-label="Date range">
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select value={salespersonId} onChange={setSalespersonId} aria-label="Sales person">
          <option value="">All sales people</option>
          {reps.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
        </Select>
        <Select value={status} onChange={setStatus} aria-label="Order status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}
        </Select>
        <Select value={collection} onChange={setCollection} aria-label="Collection">
          <option value="">All collections</option>
          <option value="pending">Pending</option>
          <option value="partial">Part collected</option>
          <option value="paid">Collected</option>
          <option value="overdue">Overdue</option>
        </Select>
        <Select value={`${sort}:${dir}`} onChange={(v) => { const [s, d] = v.split(":"); setSort(s); setDir(d as "asc" | "desc"); }} aria-label="Sort">
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="sale:desc">Largest sale</option>
          <option value="sale:asc">Smallest sale</option>
          <option value="customer:asc">Customer A–Z</option>
          <option value="product:asc">Product A–Z</option>
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Customer, order or product" />
      </Toolbar>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !totals ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : totals ? (
          <>
            <MetricCard label="Sale" value={inrMinor(totals.saleMinor)} icon={IndianRupee} detail={`${totals.lines} lines · ${totals.orders} orders`} />
            <MetricCard label="Received" value={inrMinor(totals.receivedMinor)} icon={Wallet} detail="counted once per order" />
            <MetricCard
              label="Balance"
              value={inrMinor(totals.balanceMinor)}
              icon={Wallet}
              tone={totals.balanceMinor > 0 ? "warn" : "default"}
              detail="still to collect"
            />
            <MetricCard
              label="Profit"
              value={totals.costedLines === 0 ? "—" : inrMinor(totals.profitMinor)}
              icon={Package}
              detail={
                totals.costedLines === 0
                  ? "no cost recorded in this period"
                  : `covers ${(totals.costCoverageBps / 100).toFixed(0)}% of sales`
              }
            />
          </>
        ) : null}
      </div>

      <Panel
        title={`${meta.total.toLocaleString("en-IN")} line${meta.total === 1 ? "" : "s"}`}
        action={
          <span className="text-xs erp-text-muted">
            Received and Balance appear on each order&rsquo;s first line only
          </span>
        }
      >
        {loading ? (
          <TableSkeleton rows={8} cols={8} />
        ) : error ? (
          <EmptyState
            icon={FileBarChart}
            title="Unable to load the report"
            message={error}
            action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title="No matching records"
            message="No order lines match these filters. Widen the date range or clear a filter."
            action={
              <Button size="sm" variant="secondary" onClick={() => { setRange("all"); setSalespersonId(""); setStatus(""); setCollection(""); setSearch(""); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.orderId}:${r.productName}:${r.saleMinor}:${r.quantity}`} />
            <Pagination page={page} pageCount={meta.pages} total={meta.total} pageSize={PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
