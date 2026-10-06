import { useEffect, useState } from "react";
import { Loader2, Package } from "lucide-react";
import { salesApi, type SalesOrderRow } from "@/lib/api/sales";
import { describeApiError } from "@/lib/api/client";
import { Empty, Card } from "../ui";
import { OrderRow } from "./SalesHome";

const FILTERS = [
  { key: "", label: "All" },
  { key: "PENDING", label: "Payment due" },
  { key: "PAID", label: "Paid" },
] as const;

export default function SalesOrders() {
  const [filter, setFilter] = useState("");
  const [orders, setOrders] = useState<SalesOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOrders(null);
    salesApi
      .listOrders(filter ? { paymentStatus: filter } : {})
      .then((r) => { if (!cancelled) setOrders(r.orders); })
      .catch((e) => { if (!cancelled) setError(describeApiError(e).message); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div className="space-y-4 px-4 py-4 pb-24">
      <h1 className="text-xl font-bold text-dark-900">My orders</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition ${
              filter === f.key ? "bg-green-500 text-white" : "border border-dark-200 bg-white text-dark-700"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <Card className="text-sm text-red-600">{error}</Card>}

      {orders === null ? (
        <Card className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-dark-300" /></Card>
      ) : orders.length === 0 ? (
        <Empty icon={<Package className="h-10 w-10" />} title="Nothing here" body="No orders match this filter." />
      ) : (
        <div className="space-y-2">{orders.map((o) => <OrderRow key={o.id} o={o} />)}</div>
      )}
    </div>
  );
}
