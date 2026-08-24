// Buyer delivery tracking — GET /me/shipments, scoped server-side.
//
// Every event shown is a real ShipmentEvent row written by the admin when the
// shipment moved. Nothing here is interpolated or predicted: if a courier has
// not scanned a parcel, the timeline simply stops at the last real event.
import { Link } from "react-router-dom";
import { MapPin, Package, Truck } from "lucide-react";
import { Badge, PageHeader } from "@/admin/components/ui";
import { Panel, EmptyState } from "@/admin/components/Panel";
import { MetricCard, MetricCardSkeleton } from "@/admin/components/MetricCard";
import { formatDate } from "@/admin/format";
import { prettyStatus } from "@/lib/order-status";
import { buyerApi, type BuyerShipment } from "@/lib/api/commerce";
import { useBuyerQuery } from "@/buyer/use-buyer-query";

const DELIVERED = "DELIVERED";

function ShipmentCard({ s }: { s: BuyerShipment }) {
  return (
    <div className="rounded-xl border erp-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {s.orderId ? (
              <Link to={`/account/orders/${s.orderId}`} className="font-mono font-semibold text-primary-600 hover:underline">
                {s.orderNumber}
              </Link>
            ) : (
              <span className="font-mono font-semibold erp-text">{s.shipmentNumber}</span>
            )}
            <Badge tone={s.status === DELIVERED ? "success" : "info"}>{prettyStatus(s.status)}</Badge>
          </div>
          <p className="mt-1 text-xs erp-text-muted">
            {s.courier ?? "Courier not assigned"}
            {s.trackingNumber ? ` · ${s.trackingNumber}` : ""}
            {s.shippedAt ? ` · shipped ${formatDate(s.shippedAt)}` : ""}
          </p>
        </div>
        {s.expectedAt && s.status !== DELIVERED && (
          <span className="text-xs erp-text-muted">Expected {formatDate(s.expectedAt)}</span>
        )}
      </div>

      {s.events.length === 0 ? (
        <p className="mt-4 text-sm erp-text-muted">No tracking scans yet.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {s.events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3">
              <span className="mt-1.5 flex flex-col items-center" aria-hidden>
                <span className={`h-2 w-2 shrink-0 rounded-full ${i === 0 ? "bg-primary-500" : "erp-surface-2"}`} />
                {i < s.events.length - 1 && <span className="mt-1 h-full w-px flex-1 erp-border border-l" />}
              </span>
              <span className="min-w-0 pb-1">
                <span className="block text-sm font-semibold erp-text">{prettyStatus(e.status)}</span>
                <span className="block text-xs erp-text-muted">
                  {e.location ? `${e.location} · ` : ""}
                  {formatDate(e.at)}
                </span>
                {e.note && <span className="block text-xs erp-text-faint">{e.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Tracking() {
  const q = useBuyerQuery(() => buyerApi.shipments(50), []);

  return (
    <div>
      <PageHeader title="Tracking" subtitle="Where your deliveries are right now." />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {q.status === "loading" ? (
          Array.from({ length: 3 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : q.status === "success" ? (
          <>
            <MetricCard label="In transit" value={q.data.inTransit} icon={Truck} detail="on the way" to="#" />
            <MetricCard
              label="Delivered"
              value={q.data.shipments.filter((s) => s.status === DELIVERED).length}
              icon={Package}
              detail="completed"
              to="#"
            />
            <MetricCard label="Total shipments" value={q.data.total} icon={MapPin} detail="all time" to="#" />
          </>
        ) : null}
      </div>

      {q.status === "loading" ? (
        <Panel>
          <div className="p-8 text-center text-sm erp-text-muted">Loading deliveries…</div>
        </Panel>
      ) : q.status === "error" ? (
        <Panel>
          <EmptyState
            icon={Truck}
            title="Unable to load tracking"
            message={q.error}
            action={
              <button
                type="button"
                onClick={q.retry}
                className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
              >
                Try again
              </button>
            }
          />
        </Panel>
      ) : q.data.shipments.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Truck}
            title="Nothing to track yet"
            message="Once an order ships, its live tracking appears here."
            action={
              <Link to="/account/orders" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600">
                View orders
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {q.data.shipments.map((s) => (
            <ShipmentCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
