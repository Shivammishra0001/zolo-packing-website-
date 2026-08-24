import { useMemo, useState } from "react";
import { Download, MapPin, Package, PackageCheck, Plus, Truck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, Drawer, KeyValue, PageHeader, SearchInput, Select, Tabs, Timeline, Toolbar, type TimelineEntry } from "../components/ui";
import { MetricCard } from "../components/MetricCard";
import { EmptyState, QueryState } from "../components/Panel";
import { TableSkeleton } from "../components/DataTable";
import { dueLabel, formatDateTime } from "../format";
import { useAdminShipping, asMockQuery } from "../dashboard-api";
import { SHIPMENT_STATUS } from "../statuses-ext";
import type { Shipment, ShipmentStatus } from "../types";

const STATUS_ORDER: ShipmentStatus[] = ["packing", "awb_booked", "picked_up", "in_transit", "out_for_delivery", "delivered"];

function trackingTimeline(s: Shipment): TimelineEntry[] {
  const reached = STATUS_ORDER.indexOf(s.status);
  const LABELS: Record<ShipmentStatus, string> = {
    packing: "Cartons packed at facility",
    awb_booked: `AWB booked with ${s.courier}`,
    picked_up: "Picked up by courier",
    in_transit: "In transit to destination hub",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered to consignee",
  };
  return STATUS_ORDER.map((st, i) => {
    const done = i <= reached;
    return {
      id: st,
      title: LABELS[st],
      meta: i === reached ? "Current status" : done ? "Completed" : "Pending",
      time: i === 0 ? formatDateTime(s.bookedAt) : done ? "" : dueLabel(s.eta),
      tone: done ? (st === "delivered" ? "success" : "primary") : "neutral",
    };
  });
}

function ShipmentDrawer({ s, onClose, onLabel }: { s: Shipment | null; onClose: () => void; onLabel: (s: Shipment) => void }) {
  if (!s) return null;
  const meta = SHIPMENT_STATUS[s.status];
  return (
    <Drawer
      open={!!s}
      onClose={onClose}
      title={`${s.id} · ${s.customerName}`}
      width="max-w-lg"
      footer={<Button size="sm" variant="secondary" icon={Download} onClick={() => onLabel(s)}>Download Shipping Label</Button>}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-sm erp-text-muted">Order {s.orderId}</span>
        </div>
        <KeyValue
          items={[
            { label: "Courier", value: s.courier },
            { label: "AWB", value: s.awb ?? "—" },
            { label: "Cartons", value: s.cartons },
            { label: "Weight", value: `${s.weightKg} kg` },
            { label: "Destination", value: s.destination },
            { label: "ETA", value: dueLabel(s.eta) },
          ]}
        />
        <div>
          <h3 className="mb-3 text-sm font-bold erp-text">Tracking</h3>
          <Timeline entries={trackingTimeline(s)} />
        </div>
      </div>
    </Drawer>
  );
}

const TABS = [{ key: "all", label: "All" }, ...STATUS_ORDER.map((s) => ({ key: s, label: SHIPMENT_STATUS[s].label }))];

export default function Shipping() {
  const live = useAdminShipping();
  const q = asMockQuery(live);
  // Real shipments from PostgreSQL, mapped onto the page's Shipment shape.
  // Carton/weight/destination are not modelled on the Shipment row, so they
  // show as 0/"—" rather than being invented.
  const shipments: Shipment[] = useMemo(
    () =>
      (live.data?.shipments ?? []).map((s) => ({
        id: s.shipmentNumber ?? s.id,
        orderId: s.orderNumber ?? "—",
        customerName: "—",
        courier: s.carrier ?? "—",
        awb: s.trackingNumber ?? undefined,
        cartons: 0,
        weightKg: 0,
        destination: "—",
        status: String(s.status).toLowerCase() as Shipment["status"],
        bookedAt: s.createdAt,
        eta: s.deliveredAt ?? s.shippedAt ?? s.createdAt,
      })),
    [live.data],
  );
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [bookOpen, setBookOpen] = useState(false);

  const metrics = useMemo(() => {
    const now = Date.now();
    return {
      packing: shipments.filter((s) => s.status === "packing").length,
      inTransit: shipments.filter((s) => s.status === "in_transit").length,
      ofd: shipments.filter((s) => s.status === "out_for_delivery").length,
      deliveredToday: shipments.filter((s) => s.status === "delivered" && new Date(s.eta).getTime() > now - 3 * 86400000).length,
    };
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return shipments.filter((sh) => {
      if (tab !== "all" && sh.status !== tab) return false;
      if (!s) return true;
      return [sh.id, sh.orderId, sh.customerName, sh.courier, sh.awb ?? "", sh.destination].some((f) => f.toLowerCase().includes(s));
    });
  }, [tab, search]);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Shipping" }]}
        title="Shipping & Logistics"
        subtitle="Book couriers, track shipments and manage last-mile delivery."
        actions={<Button variant="primary" icon={Plus} onClick={() => setBookOpen(true)}>Book Shipment</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Packing" value={metrics.packing} icon={Package} tone={metrics.packing ? "warn" : "default"} to="/admin/shipping" detail="at facility" />
        <MetricCard label="In Transit" value={metrics.inTransit} icon={Truck} to="/admin/shipping" detail="on the road" />
        <MetricCard label="Out for Delivery" value={metrics.ofd} icon={MapPin} to="/admin/shipping" detail="last mile" />
        <MetricCard label="Delivered" value={metrics.deliveredToday} icon={PackageCheck} to="/admin/shipping" detail="recently" />
      </div>

      <div className="mb-4">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by order, AWB, courier, destination…" className="w-full sm:w-96" />
      </Toolbar>

      <div className="erp-card card-shadow p-4 sm:p-5">
        <QueryState
          query={q}
          skeleton={<TableSkeleton rows={5} cols={7} />}
          isEmpty={() => filtered.length === 0}
          empty={<EmptyState icon={Truck} title="No shipments" message="Nothing matches the current filters." />}
        >
          {() => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Shipments</caption>
                <thead>
                  <tr className="border-b erp-border text-left">
                    {["Shipment", "Order", "Customer", "Courier", "AWB", "Cartons", "Weight", "Destination", "Status", "ETA"].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setSelected(s)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s); } }}
                      className="cursor-pointer border-b erp-border-soft last:border-0 transition-colors erp-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                    >
                      <td className="px-3 py-3 first:pl-0"><span className="font-semibold erp-text">{s.id}</span></td>
                      <td className="hidden px-3 py-3 sm:table-cell"><span className="erp-text-muted">{s.orderId}</span></td>
                      <td className="px-3 py-3"><span className="block max-w-40 truncate erp-text">{s.customerName}</span></td>
                      <td className="hidden px-3 py-3 md:table-cell"><span className="erp-text-muted">{s.courier}</span></td>
                      <td className="hidden px-3 py-3 lg:table-cell"><span className="font-mono text-xs erp-text-muted">{s.awb ?? "—"}</span></td>
                      <td className="hidden px-3 py-3 sm:table-cell"><span className="tabular-nums erp-text-muted">{s.cartons}</span></td>
                      <td className="hidden px-3 py-3 lg:table-cell"><span className="tabular-nums erp-text-muted">{s.weightKg} kg</span></td>
                      <td className="hidden px-3 py-3 md:table-cell"><span className="erp-text-muted">{s.destination}</span></td>
                      <td className="px-3 py-3"><Badge tone={SHIPMENT_STATUS[s.status].tone}>{SHIPMENT_STATUS[s.status].label}</Badge></td>
                      <td className="px-3 py-3 last:pr-0"><span className="font-semibold erp-text">{dueLabel(s.eta)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </div>

      <ShipmentDrawer s={selected} onClose={() => setSelected(null)} onLabel={(s) => toast.info("Generating label", `Shipping label for ${s.id} is downloading.`)} />

      <Dialog
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        title="Book Shipment"
        description="Assign a courier and generate an AWB."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBookOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setBookOpen(false); toast.success("Shipment booked", "AWB requested from courier partner."); }}>Book</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Order ID</span>
            <input placeholder="ORD-0000" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Courier</span>
            <Select value="BlueDart" onChange={() => {}} className="mt-1 w-full">
              {["BlueDart", "Delhivery", "DTDC", "Ekart"].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </label>
        </div>
      </Dialog>
    </div>
  );
}
