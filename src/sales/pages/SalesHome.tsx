import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, TrendingUp, Loader2 } from "lucide-react";
import { salesApi, type SalesKpis, type SalesOrderRow } from "@/lib/api/sales";
import { describeApiError } from "@/lib/api/client";
import { useAuthSession } from "@/components/auth/AuthContext";
import { Card, PrimaryButton, inrMinor, Empty } from "../ui";

/** Midnight today, as an ISO string — the window for "today's performance". */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export default function SalesHome() {
  const { user } = useAuthSession();
  const [kpis, setKpis] = useState<SalesKpis | null>(null);
  const [orders, setOrders] = useState<SalesOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [k, o] = await Promise.all([
          salesApi.kpis({ from: startOfToday() }),
          salesApi.listOrders(),
        ]);
        if (cancelled) return;
        setKpis(k);
        setOrders(o.orders);
      } catch (e) {
        if (!cancelled) setError(describeApiError(e).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-4 px-4 py-4 pb-24">
      <div>
        <p className="text-sm text-dark-500">{greeting},</p>
        <h1 className="text-xl font-bold text-dark-900">{user?.firstName ?? "there"}</h1>
      </div>

      <Link to="/sales/new"><PrimaryButton><Plus className="h-5 w-5" /> Create new order</PrimaryButton></Link>

      {error && <Card className="text-sm text-red-600">{error}</Card>}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-dark-500">
          <TrendingUp className="h-3.5 w-3.5" /> Today
        </p>
        {kpis ? (
          <div className="grid grid-cols-2 gap-3">
            <Card><p className="text-xs text-dark-500">Orders</p><p className="text-xl font-bold text-dark-900">{kpis.orders}</p></Card>
            <Card><p className="text-xs text-dark-500">Sales</p><p className="text-xl font-bold text-dark-900">{inrMinor(kpis.salesMinor)}</p></Card>
            <Card><p className="text-xs text-dark-500">Collected</p><p className="text-xl font-bold text-green-700">{inrMinor(kpis.collectedMinor)}</p></Card>
            <Card><p className="text-xs text-dark-500">Outstanding</p><p className="text-xl font-bold text-red-600">{inrMinor(kpis.outstandingMinor)}</p></Card>
          </div>
        ) : (
          <Card className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-dark-300" /></Card>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-dark-500">Recent orders</p>
        {orders === null ? (
          <Card className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-dark-300" /></Card>
        ) : orders.length === 0 ? (
          <Empty icon={<Plus className="h-10 w-10" />} title="No orders yet" body="Your captured orders appear here." />
        ) : (
          <div className="space-y-2">
            {orders.slice(0, 5).map((o) => <OrderRow key={o.id} o={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function OrderRow({ o }: { o: SalesOrderRow }) {
  return (
    <Link to={`/sales/orders/${o.id}`} className="block rounded-xl border border-dark-200 bg-white p-4 active:bg-dark-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-dark-900">{o.customer}</p>
          <p className="text-xs text-dark-500">{o.orderNumber} · {o.itemCount} item(s)</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-bold text-dark-900">{inrMinor(o.grandTotalMinor)}</p>
          {o.balanceMinor > 0
            ? <p className="text-xs font-semibold text-red-600">{inrMinor(o.balanceMinor)} due</p>
            : <p className="text-xs font-semibold text-green-700">Paid</p>}
        </div>
      </div>
    </Link>
  );
}
