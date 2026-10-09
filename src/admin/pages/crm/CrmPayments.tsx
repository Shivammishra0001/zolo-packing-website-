import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, IndianRupee, Loader2, Wallet } from "lucide-react";
import { MetricCard, MetricCardSkeleton } from "../../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, Panel } from "../../components/Panel";
import { Badge, Button, Dialog, PageHeader, Pagination, SearchInput, Select, Tabs, Toolbar } from "../../components/ui";
import { useToast } from "@/components/ui/Toast";
import { RecordPaymentDialog } from "../../crm/RecordPaymentDialog";
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
    // Column priority on a phone: who paid, and how much. The date and the
    // payment id are reference detail — they were pushing Amount, the whole
    // point of the table, off the right edge at 390px.
    {
      key: "date",
      header: "Date",
      hideBelow: "sm",
      render: (p) => <span className="whitespace-nowrap text-xs erp-text">{formatDate(p.paidAt ?? p.createdAt)}</span>,
    },
    {
      key: "payment",
      header: "Payment",
      hideBelow: "md",
      render: (p) => <span className="font-mono text-xs erp-text">{p.paymentNumber}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate erp-text">{p.customerName ?? "—"}</div>
          <div className="truncate font-mono text-[11px] erp-text-muted">{p.orderNumber ?? "—"}</div>
          {/* The date column is hidden below sm, so carry it here instead. */}
          <div className="text-[11px] erp-text-muted sm:hidden">{formatDate(p.paidAt ?? p.createdAt)}</div>
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
      hideBelow: "sm",
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
  const toast = useToast();
  const [rows, setRows] = useState<CrmOutstandingRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState("");
  const [delivery, setDelivery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recordFor, setRecordFor] = useState<CrmOutstandingRow | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<CrmOutstandingRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminCrmApi.outstanding({
        collection: (collection || undefined) as never,
        delivery: (delivery || undefined) as never,
        q: search.trim() || undefined,
        // "paid" has to widen the query past unpaid-only, or it returns
        // nothing by construction.
        settled: collection === "paid" ? "1" : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(res.orders);
      setMeta({ total: res.total, pages: res.pages });
    } catch (err) {
      setError(friendlyError(err, "Unable to load outstanding orders."));
    } finally {
      setLoading(false);
    }
  }, [collection, delivery, search, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [collection, delivery, search]);

  /**
   * Settle the whole balance. The amount is NOT sent: the server recomputes
   * it under a row lock, so a stale figure on screen cannot overpay.
   */
  async function markFull(o: CrmOutstandingRow) {
    setBusyId(o.id);
    try {
      const res = await adminCrmApi.markFullPayment(o.id, { method: "cash" });
      toast.success("Payment recorded", `${inrMinor(res.settledMinor)} settled for ${o.orderNumber}.`);
      await load();
    } catch (err) {
      toast.error("Could not record the payment", friendlyError(err, "Please try again."));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<CrmOutstandingRow>[] = [
    {
      key: "customer",
      header: "Customer",
      render: (o) => (
        <div className="min-w-0">
          <Link to={`/admin/customers/${o.customerId}`} className="block truncate font-semibold erp-text hover:text-primary-600">
            {o.customerName}
          </Link>
          <Link to={`/admin/orders/${o.id}`} className="block truncate font-mono text-xs erp-text-muted hover:text-primary-600">
            {o.orderNumber}
          </Link>
        </div>
      ),
    },
    { key: "total", header: "Total", className: "text-right tabular-nums", render: (o) => inrMinor(o.grandTotalMinor) },
    { key: "paid", header: "Paid", className: "text-right tabular-nums", hideBelow: "sm", render: (o) => inrMinor(o.paidMinor) },
    {
      key: "pending",
      header: "Pending",
      className: "text-right tabular-nums",
      render: (o) => (
        <span className={o.pendingMinor > 0 ? "font-bold text-amber-600" : "erp-text-muted"}>
          {inrMinor(o.pendingMinor)}
        </span>
      ),
    },
    {
      key: "delivered",
      header: "Delivered",
      hideBelow: "md",
      // Delivery is its own axis: an undelivered order can be fully paid and a
      // delivered one unpaid, so this never mirrors the payment column.
      render: (o) =>
        o.delivered ? (
          <div>
            <Badge tone="success">Delivered</Badge>
            {o.deliveredAt && <div className="mt-0.5 text-[11px] erp-text-muted">{formatDate(o.deliveredAt)}</div>}
          </div>
        ) : (
          <div>
            <Badge tone="neutral">{o.orderStatus.toLowerCase().replace(/_/g, " ")}</Badge>
            {o.expectedDeliveryDate && (
              <div className="mt-0.5 text-[11px] erp-text-muted">due {formatDate(o.expectedDeliveryDate)}</div>
            )}
          </div>
        ),
    },
    {
      key: "collection",
      header: "Collection",
      render: (o) => (
        <div>
          <Badge tone={paymentTone(o.paymentStatus)}>{paymentLabel(o.paymentStatus)}</Badge>
          {o.daysOverdue > 0 && <div className="mt-0.5 text-[11px] font-semibold text-red-600">{o.daysOverdue}d overdue</div>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (o) =>
        o.pendingMinor <= 0 ? (
          <span className="text-xs erp-text-faint">Settled</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setRecordFor(o)} disabled={busyId === o.id}>
              Record
            </Button>
            <Button size="sm" onClick={() => void markFull(o)} disabled={busyId === o.id}>
              {busyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Mark full
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWriteOffFor(o)} disabled={busyId === o.id}>
              Write off
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <Toolbar>
        <Select value={collection} onChange={setCollection} aria-label="Collection status">
          <option value="">All unpaid</option>
          <option value="pending">Not paid</option>
          <option value="partial">Partially paid</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Fully paid</option>
        </Select>
        <Select value={delivery} onChange={setDelivery} aria-label="Delivery">
          <option value="">Any delivery state</option>
          <option value="delivered">Delivered</option>
          <option value="undelivered">Not delivered</option>
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Customer, order or phone" />
      </Toolbar>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Unable to load collections"
          message={error}
          action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nothing to collect"
          message="No order matches these filters."
          action={
            <Button size="sm" variant="secondary" onClick={() => { setCollection(""); setDelivery(""); setSearch(""); }}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} />
          <div className="mt-3">
            <Pagination page={page} pageCount={meta.pages} total={meta.total} pageSize={PAGE_SIZE} onPage={setPage} />
          </div>
        </>
      )}

      {recordFor && (
        <RecordPaymentDialog
          open
          onClose={() => setRecordFor(null)}
          order={{
            id: recordFor.id,
            orderNumber: recordFor.orderNumber,
            grandTotalMinor: recordFor.grandTotalMinor,
            paidMinor: recordFor.paidMinor,
          }}
          onRecorded={() => { setRecordFor(null); void load(); }}
        />
      )}

      {writeOffFor && (
        <WriteOffDialog
          order={writeOffFor}
          onClose={() => setWriteOffFor(null)}
          onDone={() => { setWriteOffFor(null); void load(); }}
        />
      )}
    </>
  );
}

/**
 * Writing off a balance is NOT "mark as paid". It records an ADJUSTMENT
 * payment with a mandatory reason, so the order reads settled and the ledger
 * still explains why no money arrived.
 */
function WriteOffDialog({
  order,
  onClose,
  onDone,
}: {
  order: CrmOutstandingRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const res = await adminCrmApi.writeOffBalance(order.id, { reason: reason.trim() });
      toast.success("Balance written off", `${inrMinor(res.writtenOffMinor)} recorded as an adjustment.`);
      onDone();
    } catch (err) {
      toast.error("Could not write off", friendlyError(err, "Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Write off balance" description={order.orderNumber}>
      <div className="space-y-4">
        <div className="rounded-lg erp-surface-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm erp-text-muted">Outstanding</span>
            <span className="font-display text-xl font-extrabold erp-text">{inrMinor(order.pendingMinor)}</span>
          </div>
          <p className="mt-2 text-xs erp-text-muted">
            This records an adjustment for the full outstanding amount, so the order reads as settled. No money is
            received. The reason stays on the payment ledger.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold erp-text" htmlFor="wo-reason">
            Reason<span className="text-red-500">*</span>
          </label>
          <textarea
            id="wo-reason"
            className="input w-full"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer ceased trading; balance uncollectable"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || reason.trim().length < 3}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Write off {inrMinor(order.pendingMinor)}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
