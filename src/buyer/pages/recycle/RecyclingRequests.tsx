import { useState } from "react";
import { CheckCircle2, Circle, Coins, Recycle, XCircle } from "lucide-react";
import { Badge, Button } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { formatDate, formatDateTime } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { describeApiError } from "@/lib/api/client";
import { fmtQty, RECYCLING_STATUS_LABEL, recyclingApi, type RecyclingRequest, type RecyclingStatus } from "@/lib/api/recycling";

// My recycling requests — status timeline and, once approved, the exact working
// the credits came from (verified quantity × the rate at approval).

const TONE: Record<RecyclingStatus, "warning" | "info" | "success" | "danger" | "neutral" | "primary"> = {
  PENDING: "warning", PICKUP_SCHEDULED: "info", RECEIVED: "primary", UNDER_VERIFICATION: "info", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral",
};
const FLOW: RecyclingStatus[] = ["PENDING", "PICKUP_SCHEDULED", "RECEIVED", "UNDER_VERIFICATION", "APPROVED"];

function Card({ r, onChanged }: { r: RecyclingRequest; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(r.status !== "APPROVED" && r.status !== "CANCELLED");
  const [busy, setBusy] = useState(false);
  const reached = new Map(r.timeline.map((t) => [t.status, t.at]));
  const flow: RecyclingStatus[] = r.status === "REJECTED" || r.status === "CANCELLED" ? [...FLOW.filter((s) => reached.has(s)), r.status] : FLOW;

  const cancel = async () => {
    if (!window.confirm(`Cancel ${r.requestNumber}?`)) return;
    setBusy(true);
    try { await recyclingApi.cancel(r.id); toast.success("Request cancelled"); onChanged(); }
    catch (e) { toast.error("Couldn't cancel", describeApiError(e).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border erp-border erp-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Recycle className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          <span className="font-mono text-sm font-bold erp-text">{r.requestNumber}</span>
          <Badge tone={TONE[r.status]} dot>{RECYCLING_STATUS_LABEL[r.status]}</Badge>
        </div>
        <span className="text-xs erp-text-faint">{formatDateTime(r.createdAt)}</span>
      </div>
      <p className="mt-2 text-sm erp-text">
        <span className="font-semibold">{r.material}</span>
        <span className="erp-text-muted"> · estimated {fmtQty(r.estimatedQuantity)} {r.unit}</span>
        {r.verifiedQuantity != null && <span className="erp-text-muted"> · verified <span className="font-semibold erp-text">{fmtQty(r.verifiedQuantity)} {r.unit}</span></span>}
      </p>
      {r.pickup.scheduledFor && !["APPROVED", "REJECTED", "CANCELLED"].includes(r.status) && <p className="mt-0.5 text-xs erp-text-muted">Pickup: {formatDate(r.pickup.scheduledFor)} · {r.pickup.city}</p>}

      {r.status === "APPROVED" && r.calculation && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 dark:text-emerald-300"><Coins className="h-4 w-4" aria-hidden /> +{(r.creditsAwarded ?? 0).toLocaleString("en-IN")} Eco Credits</div>
          <div className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-300/80">{r.calculation.formula} <span className="opacity-75">({r.calculation.rounding?.toLowerCase()})</span></div>
        </div>
      )}
      {r.status === "REJECTED" && r.rejectionReason && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">Rejected: {r.rejectionReason}</p>}

      {open && (
        <ol className="mt-3 space-y-1.5">
          {flow.map((s) => {
            const at = reached.get(s);
            const bad = s === "REJECTED" || s === "CANCELLED";
            return (
              <li key={s} className="flex items-center gap-2 text-sm">
                {at ? (bad ? <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />) : <Circle className="h-4 w-4 shrink-0 erp-text-faint" aria-hidden />}
                <span className={at ? "font-semibold erp-text" : "erp-text-faint"}>{RECYCLING_STATUS_LABEL[s]}</span>
                <span className="ml-auto text-xs erp-text-faint">{at ? formatDateTime(at) : "Pending"}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(!open)}>{open ? "Hide timeline" : "View timeline"}</Button>
        {(r.status === "PENDING" || r.status === "PICKUP_SCHEDULED") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel request</Button>}
      </div>
    </div>
  );
}

export default function RecyclingRequests({ requests, onChanged, onStart, canStart }: { requests: RecyclingRequest[]; onChanged: () => void; onStart: () => void; canStart: boolean }) {
  if (requests.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Recycle} title="No recycling requests yet" message="Submit your used packaging to start earning Eco Credits."
          action={canStart ? <Button variant="primary" icon={Recycle} onClick={onStart}>Submit recyclable packaging</Button> : undefined} />
      </Panel>
    );
  }
  return <div className="space-y-3">{requests.map((r) => <Card key={r.id} r={r} onChanged={onChanged} />)}</div>;
}
