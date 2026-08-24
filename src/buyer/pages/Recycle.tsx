import { useState } from "react";
import { Download, Eye, Leaf, Recycle as RecycleIcon, Ticket } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { Badge, Button, Dialog, KeyValue, PageHeader } from "@/admin/components/ui";
import { formatDate, inr } from "@/admin/format";
import { useBuyerRecycle, type RecycleEntry } from "../data";

const STATUS: Record<RecycleEntry["status"], { label: string; tone: "info" | "success" | "warning" }> = {
  pickup: { label: "Pickup Scheduled", tone: "info" },
  coupon: { label: "Coupon Issued", tone: "success" },
  processing: { label: "Processing", tone: "warning" },
};

export default function Recycle() {
  const toast = useToast();
  const rows = useBuyerRecycle();
  const [view, setView] = useState<RecycleEntry | null>(null);

  const totalWeight = rows.reduce((s, r) => s + r.weightKg, 0);
  const coupons = rows.filter((r) => r.status === "coupon").length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Recycle" }]}
        title="Recycle"
        subtitle="Return your packaging for pickup and earn coupons."
      />

      {/* Eco summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total Recycled", value: `${totalWeight} kg`, icon: Leaf, tone: "text-emerald-600 dark:text-emerald-400" },
          { label: "Pickups", value: String(rows.length), icon: RecycleIcon, tone: "erp-text" },
          { label: "Coupons Earned", value: String(coupons), icon: Ticket, tone: "text-primary-600 dark:text-primary-400" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border erp-border erp-surface card-shadow p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide erp-text-muted">{c.label}</span>
              <c.icon className="h-4 w-4 erp-text-faint" aria-hidden />
            </div>
            <p className={`mt-2 font-display text-xl font-extrabold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <Panel bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={RecycleIcon}
            title="No recycle pickups yet"
            message="Once your orders are delivered, you can schedule a packaging pickup and earn coupons."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recycle pickups</caption>
              <thead>
                <tr className="border-b erp-border text-left">
                  {["Recycle ID", "Order", "Date", "Weight", "Order Amount", "Status", "Invoice", "Actions"].map((h, i) => (
                    <th key={h} scope="col" className={`whitespace-nowrap px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint ${i === 7 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = STATUS[r.status];
                  return (
                    <tr key={r.id} className="border-b erp-border-soft last:border-0 erp-hover">
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold erp-text">{r.id}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-primary-600 dark:text-primary-400">{r.orderId}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 erp-text-muted">{formatDate(r.date)}</td>
                      <td className="px-3 py-2.5 tabular-nums erp-text">{r.weightKg} kg</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums erp-text">{inr(r.orderAmount)}</td>
                      <td className="px-3 py-2.5"><Badge tone={m.tone} dot>{m.label}</Badge></td>
                      <td className="px-3 py-2.5"><span className="font-mono text-xs erp-text-muted">REC-INV-{r.id.slice(-4)}</span></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={() => setView(r)} aria-label={`View ${r.id}`} className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
                            <Eye className="h-4 w-4" aria-hidden />
                          </button>
                          <button onClick={() => toast.success("Receipt", `Receipt for ${r.id} downloading…`)} aria-label="Download receipt" className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
                            <Download className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog
        open={view !== null}
        onClose={() => setView(null)}
        title="Recycle pickup"
        description={view ? `${view.id} · Order ${view.orderId}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setView(null)}>Close</Button>
            <Button variant="secondary" icon={Download} onClick={() => { toast.success("Receipt", "Receipt downloading…"); setView(null); }}>
              Download Receipt
            </Button>
          </>
        }
      >
        {view && (
          <KeyValue
            items={[
              { label: "Recycle ID", value: view.id },
              { label: "Order", value: view.orderId },
              { label: "Date", value: formatDate(view.date) },
              { label: "Weight", value: `${view.weightKg} kg` },
              { label: "Order Amount", value: inr(view.orderAmount) },
              { label: "Status", value: <Badge tone={STATUS[view.status].tone}>{STATUS[view.status].label}</Badge> },
            ]}
          />
        )}
      </Dialog>
    </div>
  );
}
