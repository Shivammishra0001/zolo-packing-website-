// Admin Orders dashboard — real API (GET /admin/orders + /stats).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, IndianRupee, Package, Truck, XCircle } from "lucide-react";
import { Badge, PageHeader, Pagination, SearchInput, Select, Toolbar } from "@/admin/components/ui";
import { MetricCard } from "@/admin/components/MetricCard";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { inrMinor, formatDate } from "@/admin/format";
import { adminOrdersApi, type OrderStats } from "@/lib/api/admin-orders";
import type { Order } from "@/lib/api/commerce";
import { statusTone, paymentTone, prettyStatus } from "@/lib/order-status";

const STATUS_OPTIONS = ["", "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
const PAY_OPTIONS = ["", "PENDING", "PAID", "FAILED", "REFUNDED"];
const PAGE_SIZE = 20;

export default function OrdersReal() {
  const nav = useNavigate();
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [data, setData] = useState<{ orders: Order[]; total: number } | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { adminOrdersApi.stats().then(setStats).catch(() => {}); }, []);
  useEffect(() => {
    setData(null);
    adminOrdersApi.list({ status, paymentStatus, search, page, pageSize: PAGE_SIZE })
      .then((r) => setData({ orders: r.orders, total: r.total }))
      .catch(() => setError(true));
  }, [status, paymentStatus, search, page]);

  return (
    <div>
      <PageHeader title="Orders" subtitle="All customer orders, payments and fulfilment." />

      {/* Metrics */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard to="/admin/orders" label="Total orders" value={stats ? String(stats.totalOrders) : "…"} icon={Package} />
        <MetricCard to="/admin/orders" label="Revenue" value={stats ? inrMinor(stats.revenueMinor) : "…"} icon={IndianRupee} />
        <MetricCard to="/admin/orders" label="Pending payment" value={stats ? String(stats.pendingPayment) : "…"} icon={Truck} tone="warn" />
        <MetricCard to="/admin/orders" label="Cancelled" value={stats ? String(stats.cancelled) : "…"} icon={XCircle} tone="danger" />
      </div>

      <Panel>
        <Toolbar>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search order # / name / email…" />
          <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} aria-label="Filter by status">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? prettyStatus(s) : "All statuses"}</option>)}
          </Select>
          <Select value={paymentStatus} onChange={(v) => { setPaymentStatus(v); setPage(1); }} aria-label="Filter by payment">
            {PAY_OPTIONS.map((s) => <option key={s} value={s}>{s ? prettyStatus(s) : "All payments"}</option>)}
          </Select>
        </Toolbar>

        {error ? (
          <EmptyState title="Couldn't load orders" message="Please try again in a moment." />
        ) : data === null ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading orders…</div>
        ) : data.orders.length === 0 ? (
          <EmptyState title="No orders found" message="No orders match the current filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Order</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Items</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Status</th><th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60" onClick={() => nav(`/admin/orders/${o.id}`)}>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">{o.orderNumber}</td>
                      <td className="px-4 py-3"><div className="text-slate-900">{o.customer?.name ?? "—"}</div><div className="text-xs text-slate-400">{o.customer?.email}</div></td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(o.placedAt)}</td>
                      <td className="px-4 py-3 text-slate-500">{o.items.reduce((s, it) => s + it.quantity, 0)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{inrMinor(o.grandTotalMinor)}</td>
                      <td className="px-4 py-3"><Badge tone={paymentTone(o.paymentStatus)}>{prettyStatus(o.paymentStatus)}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={statusTone(o.status)}>{prettyStatus(o.status)}</Badge></td>
                      <td className="px-4 py-3 text-right"><Eye className="inline h-4 w-4 text-slate-400" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={Math.max(1, Math.ceil(data.total / PAGE_SIZE))} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
