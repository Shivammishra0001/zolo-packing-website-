import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Leaf, RotateCcw, Wallet } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, ErrorState, Panel } from "../components/Panel";
import { Badge, PageHeader, SearchInput, Select, Tabs, Toolbar } from "../components/ui";
import { relativeTime } from "../format";
import { useNow } from "../hooks";
import { describeApiError } from "@/lib/api/client";
import { adminReturnsApi, prettyReturnStatus, type AdminReturnRow, type ReturnStatus } from "@/lib/api/returns";

// ============================================================
// Admin Returns & Recycling — VIEW and PROCESS customer-created requests.
// There is deliberately no "create" action here: a request exists only
// because a customer submitted it from their order.
// ============================================================

const STATUS_TONE: Partial<Record<ReturnStatus, "warning" | "info" | "success" | "danger" | "neutral">> = {
  SUBMITTED: "warning",
  UNDER_REVIEW: "info",
  APPROVED: "info",
  REJECTED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "success",
  REPLACEMENT_DELIVERED: "success",
  POINTS_CREDITED: "success",
  CLOSED: "success",
};

const PROCESSING = ["PICKUP_SCHEDULED", "RECEIVED", "INSPECTED", "REFUND_PROCESSING", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "RECYCLE_PROCESSING", "RECYCLED"];

export default function Returns() {
  const now = useNow();
  const [tab, setTab] = useState<"all" | "RETURN" | "RECYCLE">("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ requests: AdminReturnRow[]; total: number; counts: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await adminReturnsApi.list({
        type: tab === "all" ? undefined : tab,
        status: statusFilter || undefined,
        q: search.trim() || undefined,
      }));
    } catch (e) {
      setData(null);
      setError(describeApiError(e).message);
    }
  }, [tab, statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250); // debounce the search box
    return () => clearTimeout(t);
  }, [load]);

  const counts = data?.counts ?? {};
  const sum = (keys: string[]) => keys.reduce((s, k) => s + (counts[k] ?? 0), 0);

  const columns: Column<AdminReturnRow>[] = [
    { key: "id", header: "Request", render: (r) => <span className="font-mono font-bold erp-text">{r.requestNumber}</span> },
    { key: "type", header: "Type", render: (r) => (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold erp-text-muted">
        {r.type === "RECYCLE" ? <Leaf className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5 text-primary-500" aria-hidden />}
        {r.type === "RECYCLE" ? "Recycle" : "Return"}
      </span>
    ) },
    { key: "customer", header: "Customer", render: (r) => <span className="block max-w-40 truncate erp-text-muted">{r.customer}</span>, hideBelow: "md" },
    { key: "product", header: "Product", render: (r) => <span className="block max-w-52 truncate erp-text-muted">{r.productName} × {r.quantity.toLocaleString("en-IN")}</span>, hideBelow: "lg" },
    { key: "order", header: "Order", render: (r) => <span className="font-mono text-xs erp-text-muted">{r.orderNumber}</span>, hideBelow: "sm" },
    { key: "resolution", header: "Resolution", render: (r) => r.resolution ? <Badge tone="info">{r.resolution}</Badge> : <span className="erp-text-faint">—</span>, hideBelow: "md" },
    { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status] ?? "info"}>{prettyReturnStatus(r.status)}</Badge> },
    { key: "created", header: "Created", render: (r) => <span className="erp-text-muted">{relativeTime(r.createdAt, now)}</span>, hideBelow: "sm" },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Returns & Recycling" }]}
        title="Returns & Recycling"
        subtitle="Customer-created return and recycling requests. Review, choose a resolution, and process."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="Pending review" value={sum(["SUBMITTED", "UNDER_REVIEW"])} icon={Clock} tone={sum(["SUBMITTED", "UNDER_REVIEW"]) > 0 ? "warn" : "default"} to="/admin/returns" />
        <MetricCard label="In processing" value={sum(PROCESSING) + (counts.APPROVED ?? 0)} icon={Wallet} to="/admin/returns" />
        <MetricCard label="Completed" value={sum(["REFUNDED", "REPLACEMENT_DELIVERED", "POINTS_CREDITED", "CLOSED"])} icon={CheckCircle2} to="/admin/returns" />
        <MetricCard label="Rejected / cancelled" value={sum(["REJECTED", "CANCELLED"])} icon={RotateCcw} to="/admin/returns" />
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "all", label: "All" },
            { key: "RETURN", label: "Returns" },
            { key: "RECYCLE", label: "Recycling" },
          ]}
          active={tab}
          onChange={(k) => setTab(k as typeof tab)}
        />
      </div>

      <div className="space-y-4">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search request, order, customer…" className="w-full sm:w-72" />
          <Select value={statusFilter} onChange={setStatusFilter} aria-label="Status filter" className="sm:ml-auto">
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONE).concat(PROCESSING).filter((v, i, a) => a.indexOf(v) === i).map((s) => (
              <option key={s} value={s}>{prettyReturnStatus(s as ReturnStatus)}</option>
            ))}
          </Select>
        </Toolbar>

        {data === null && !error && <Panel><TableSkeleton rows={6} cols={7} /></Panel>}
        {error && <Panel><ErrorState message={error} onRetry={() => void load()} /></Panel>}
        {data !== null && (
          <Panel bodyClassName="p-0">
            {data.requests.length === 0 ? (
              <EmptyState title="No requests" message="Customer return and recycling requests will appear here as they are submitted." />
            ) : (
              <div className="px-4 py-4 sm:px-5">
                <DataTable
                  caption="Return and recycling requests"
                  columns={columns}
                  rows={data.requests}
                  rowKey={(r) => r.id}
                  rowHref={(r) => `/admin/returns/${encodeURIComponent(r.requestNumber)}`}
                />
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
