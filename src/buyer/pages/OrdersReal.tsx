// Buyer "My Orders" — backed by the REAL commerce API (GET /api/v1/orders).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, ShoppingBag } from "lucide-react";
import { Badge, PageHeader, SearchInput, Toolbar } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { inrMinor, formatDate } from "@/admin/format";
import { orderApi, type Order } from "@/lib/api/commerce";

import { statusTone, prettyStatus } from "@/lib/order-status";
const pretty = prettyStatus;

export default function OrdersReal() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    orderApi.list().then(setOrders).catch(() => setError(true));
  }, []);

  const filtered = (orders ?? []).filter((o) =>
    !search.trim() || o.orderNumber.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div>
      <PageHeader title="My Orders" subtitle="Track and manage everything you've ordered." />

      <Panel>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by order number…" />
        </Toolbar>

        {orders === null && !error ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading your orders…</div>
        ) : error ? (
          <EmptyState title="Couldn't load orders" message="Please try again in a moment." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="No orders yet"
            message="When you place an order it will appear here."
            action={<Link to="/products" className="rounded-full bg-primary-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-600">Start shopping</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{o.orderNumber}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(o.placedAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{o.items.reduce((s, it) => s + it.quantity, 0)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{inrMinor(o.grandTotalMinor)}</td>
                    <td className="px-4 py-3"><Badge tone={o.paymentStatus === "PAID" ? "success" : "warning"}>{pretty(o.paymentStatus)}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={statusTone(o.status)}>{pretty(o.status)}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/account/orders/${o.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:underline">
                        <Eye className="h-3.5 w-3.5" /> View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
