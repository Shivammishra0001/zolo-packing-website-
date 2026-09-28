import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, IndianRupee, Wallet } from "lucide-react";
import { MetricCard, MetricCardSkeleton } from "../../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, Panel } from "../../components/Panel";
import { Badge, Button, PageHeader, Pagination, SearchInput, Select, Tabs, Toolbar } from "../../components/ui";
import { formatDate, inrMinor } from "../../format";
import { friendlyError, kindLabel, methodLabel, paymentLabel, paymentTone } from "../../crm/money";
import {
  adminCrmApi,
  PAYMENT_METHODS,
  type CrmOutstandingRow,
  type CrmPaymentRow,
  type CrmPaymentSummary,
} from "@/lib/api/admin-crm";

// ============================================================
// Admin → Payments (§21, §25, §50).
//
// Two views on the same money:
//   Transactions — every payment received, newest first.
//   Outstanding  — orders with a balance, bucketed by when they are due.
//
// All figures come from server-side aggregates; this page never sums a column
// in the browser. The due buckets are computed against the server's clock, so
// "overdue" cannot disagree between two admins in different timezones.
// ============================================================

const PAGE_SIZE = 25;

const BUCKETS = [
  { id: "all", label: "All due" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "week", label: "Next 7 days" },
  { id: "month", label: "Next 30 days" },
] as const;

type Bucket = (typeof BUCKETS)[number]["id"];

export default function CrmPayments() {
  const [tab, setTab] = useState<"transactions" | "outstanding">("transactions");
  const [summary, setSummary] = useState<CrmPaymentSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    adminCrmApi
      .paymentSummary()
      .then(setSummary)
      .catch((err) => setSummaryError(friendlyError(err, "Unable to load payment totals.")));
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" subtitle="What has been received and what is still owed" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryError ? (
          <div className="sm:col-span-2 xl:col-span-4">
            <EmptyState title="Unable to load totals" message={summaryError} />
          </div>
        ) : !summary ? (
          Array.from({ length: 4 }, (_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard
              label="Total receivable"
              value={inrMinor(summary.totalValueMinor)}
              icon={IndianRupee}
              detail={`${summary.orderCount} orders`}
              to="/admin/orders"
            />
            <MetricCard
              label="Received this month"
              value={inrMinor(summary.collectedThisMonthMinor)}
              icon={Wallet}
              detail={`${inrMinor(summary.collectedTodayMinor)} today`}
              to="/admin/payments"
            />
            <MetricCard
              label="Pending"
              value={inrMinor(summary.pendingMinor)}
              icon={CalendarClock}
              detail={`${summary.partiallyPaidOrders} partly paid · ${summary.paidOrders} settled`}
              to="/admin/payments"
            />
            <MetricCard
              label="Overdue"
              value={inrMinor(summary.overdueMinor)}
              icon={AlertTriangle}
              tone={summary.overdueMinor > 0 ? "danger" : "default"}
              to="/admin/payments"
            />
          </>
        )}
      </div>

      <Tabs
        tabs={[
          { key: "transactions", label: "Transactions" },
          { key: "outstanding", label: "Outstanding" },
        ]}
        active={tab}
        onChange={(id) => setTab(id as "transactions" | "outstanding")}
      />

      {tab === "transactions" ? <TransactionsTab /> : <OutstandingTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TransactionsTab() {
  const [rows, setRows] = useState<CrmPaymentRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminCrmApi.listPayments({
        q: search.trim() || undefined,
        method: method === "all" ? undefined : method,
        page,
        limit: PAGE_SIZE,
      });
      setRows(res.payments);
      setMeta({ total: res.total, pages: res.pages });
    } catch (err) {
      setError(friendlyError(err, "Unable to load payments."));
    } finally {
      setLoading(false);
    }
  }, [search, method, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, method]);

  const columns: Column<CrmPaymentRow>[] = [
    {
      key: "date",
      header: "Date",
      render: (p) => <span className="whitespace-nowrap text-xs erp-text">{formatDate(p.paidAt ?? p.createdAt)}</span>,
    },
    {
      key: "payment",
      header: "Payment",
      render: (p) => <span className="font-mono text-xs erp-text">{p.paymentNumber}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate erp-text">{p.customerName ?? "—"}</div>
          <div className="truncate font-mono text-[11px] erp-text-muted">{p.orderNumber ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideBelow: "md",
      render: (p) => (
        <div className="text-xs">
          <div className="erp-text">{methodLabel(p.method)}</div>
          <div className="erp-text-muted">{kindLabel(p.kind)}</div>
        </div>
      ),
    },
    {
      key: "reference",
      header: "Reference",
      hideBelow: "lg",
      render: (p) => <span className="font-mono text-xs erp-text-muted">{p.reference || "—"}</span>,
    },
    {
      key: "received",
      header: "Received by",
      hideBelow: "lg",
      render: (p) => <span className="text-xs erp-text-muted">{p.receivedBy || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge tone={paymentTone(p.status)}>{paymentLabel(p.status)}</Badge>,
    },
    {
      key: "amount",
      header: <span className="block text-right">Amount</span>,
      render: (p) => (
        <div className="text-right">
          <div className="font-semibold tabular-nums erp-text">{inrMinor(p.amountMinor)}</div>
          {p.refundedMinor > 0 && (
            <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              − {inrMinor(p.refundedMinor)} refunded
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="Transactions"
      action={
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Payment id, order, reference, customer…" />
          <Select value={method} onChange={setMethod} aria-label="Filter by payment method">
            <option value="all">All methods</option>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Toolbar>
      }
    >
      {loading ? (
        <TableSkeleton rows={8} />
      ) : error ? (
        <EmptyState title="Unable to load payments" message={error} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={search || method !== "all" ? "No payments match" : "No payments recorded"}
          message={search || method !== "all" ? "Try a different search or filter." : "Payments recorded against an order appear here."}
          action={search || method !== "all" ? <Button variant="secondary" onClick={() => { setSearch(""); setMethod("all"); }}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            rowHref={(p) => (p.orderId ? `/admin/orders/${p.orderId}` : "")}
            caption="Payment transactions"
          />
          {meta.pages > 1 && (
            <div className="mt-4">
              <Pagination page={page} pageCount={meta.pages} total={meta.total} pageSize={PAGE_SIZE} onPage={setPage} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function OutstandingTab() {
  const [rows, setRows] = useState<CrmOutstandingRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminCrmApi.outstanding({ bucket, page, limit: PAGE_SIZE });
      setRows(res.orders);
      setMeta({ total: res.total, pages: res.pages });
    } catch (err) {
      setError(friendlyError(err, "Unable to load outstanding orders."));
    } finally {
      setLoading(false);
    }
  }, [bucket, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [bucket]);

  const columns: Column<CrmOutstandingRow>[] = [
    {
      key: "order",
      header: "Order",
      render: (o) => (
        <div className="min-w-0">
          <div className="font-mono text-xs erp-text">{o.orderNumber}</div>
          <div className="truncate text-xs erp-text-muted">{formatDate(o.placedAt)}</div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (o) => (
        <div className="min-w-0">
          <div className="truncate erp-text">{o.customerName}</div>
          <div className="truncate text-xs erp-text-muted">{o.customerPhone ?? o.customerEmail}</div>
        </div>
      ),
    },
    {
      key: "total",
      header: <span className="block text-right">Total</span>,
      hideBelow: "sm",
      render: (o) => <div className="text-right tabular-nums erp-text">{inrMinor(o.grandTotalMinor)}</div>,
    },
    {
      key: "paid",
      header: <span className="block text-right">Paid</span>,
      hideBelow: "md",
      render: (o) => <div className="text-right tabular-nums erp-text-muted">{inrMinor(o.paidMinor)}</div>,
    },
    {
      key: "pending",
      header: <span className="block text-right">Pending</span>,
      render: (o) => <div className="text-right font-bold tabular-nums erp-text">{inrMinor(o.pendingMinor)}</div>,
    },
    {
      key: "due",
      header: "Due",
      render: (o) => (
        <div className="text-xs">
          <div className="erp-text">{o.dueDate ? formatDate(o.dueDate) : "No due date"}</div>
          {o.daysOverdue > 0 && (
            <div className="font-semibold text-red-600 dark:text-red-400">
              {o.daysOverdue} day{o.daysOverdue === 1 ? "" : "s"} late
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (o) => <Badge tone={paymentTone(o.paymentStatus)}>{paymentLabel(o.paymentStatus)}</Badge>,
    },
  ];

  return (
    <Panel
      title="Outstanding orders"
      action={
        <Toolbar>
          <Select value={bucket} onChange={(v) => setBucket(v as Bucket)} aria-label="Filter by due date">
            {BUCKETS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
        </Toolbar>
      }
    >
      {loading ? (
        <TableSkeleton rows={8} />
      ) : error ? (
        <EmptyState title="Unable to load outstanding orders" message={error} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={bucket === "overdue" ? "Nothing overdue" : "No pending payments"}
          message={bucket === "all" ? "Every order is settled." : "Nothing falls in this window."}
          action={bucket !== "all" ? <Button variant="secondary" onClick={() => setBucket("all")}>Show all due</Button> : undefined}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            rowHref={(o) => `/admin/orders/${o.id}`}
            caption="Orders with an outstanding balance"
          />
          {meta.pages > 1 && (
            <div className="mt-4">
              <Pagination page={page} pageCount={meta.pages} total={meta.total} pageSize={PAGE_SIZE} onPage={setPage} />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
