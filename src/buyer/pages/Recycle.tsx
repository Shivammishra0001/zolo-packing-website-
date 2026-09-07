import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Coins, Download, Leaf, Paperclip, RotateCcw, XCircle } from "lucide-react";
import { Badge, Button, PageHeader, Tabs } from "@/admin/components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "@/admin/components/Panel";
import { formatDateTime, inrMinor } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { describeApiError, saveBlob } from "@/lib/api/client";
import {
  returnsApi,
  prettyReturnStatus,
  RETURN_REASON_LABELS,
  RETURN_CONDITION_LABELS,
  type ReturnRequest,
  type ReturnStatus,
} from "@/lib/api/returns";

// ============================================================
// My Returns & Recycling — every request the customer has raised, with a
// live status timeline, plus the reward-points balance from the immutable
// ledger. Requests are created from Order Details → item → Return / Recycle.
// ============================================================

const TONE: Partial<Record<ReturnStatus, "success" | "warning" | "danger" | "info" | "neutral">> = {
  SUBMITTED: "warning",
  UNDER_REVIEW: "info",
  APPROVED: "info",
  REJECTED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "success",
  REPLACEMENT_DELIVERED: "success",
  POINTS_CREDITED: "success",
  CLOSED: "success",
};

// The expected milestones per branch — used to render the ○/✓ timeline.
function expectedFlow(r: ReturnRequest): ReturnStatus[] {
  const head: ReturnStatus[] = ["SUBMITTED", "UNDER_REVIEW", "APPROVED"];
  if (r.status === "REJECTED") return ["SUBMITTED", "UNDER_REVIEW", "REJECTED"];
  if (r.status === "CANCELLED") return ["SUBMITTED", "CANCELLED"];
  if (r.resolution === "REFUND") return [...head, "REFUND_PROCESSING", "REFUNDED"];
  if (r.resolution === "REPLACEMENT") return [...head, "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "REPLACEMENT_DELIVERED"];
  if (r.resolution === "RECYCLE" || r.type === "RECYCLE")
    return [...head, "PICKUP_SCHEDULED", "RECEIVED", "INSPECTED", "RECYCLE_PROCESSING", "RECYCLED", "POINTS_CREDITED"];
  return head;
}

function Timeline({ r }: { r: ReturnRequest }) {
  const reached = new Map(r.timeline.map((t) => [t.status, t.at]));
  return (
    <ol className="mt-3 space-y-1.5">
      {expectedFlow(r).map((s) => {
        const at = reached.get(s);
        const failed = s === "REJECTED" || s === "CANCELLED";
        return (
          <li key={s} className="flex items-center gap-2 text-sm">
            {at ? (
              failed ? <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 shrink-0 erp-text-faint" aria-hidden />
            )}
            <span className={at ? "font-semibold erp-text" : "erp-text-faint"}>{prettyReturnStatus(s)}</span>
            <span className="ml-auto text-xs erp-text-faint">{at ? formatDateTime(at) : "Pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RequestCard({ r, onCancelled }: { r: ReturnRequest; onCancelled: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const cancellable = r.status === "SUBMITTED" || r.status === "UNDER_REVIEW";

  const cancel = async () => {
    if (!window.confirm(`Cancel ${r.requestNumber}?`)) return;
    setBusy(true);
    try {
      await returnsApi.cancel(r.id);
      toast.success("Request cancelled");
      onCancelled();
    } catch (e) {
      toast.error("Couldn't cancel", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border erp-border erp-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {r.type === "RECYCLE" ? <Leaf className="h-4 w-4 text-emerald-500" aria-hidden /> : <RotateCcw className="h-4 w-4 text-primary-500" aria-hidden />}
          <span className="font-mono text-sm font-bold erp-text">{r.requestNumber}</span>
          <Badge tone={TONE[r.status] ?? "info"}>{prettyReturnStatus(r.status)}</Badge>
        </div>
        <span className="text-xs erp-text-faint">{formatDateTime(r.createdAt)}</span>
      </div>

      <p className="mt-2 text-sm erp-text">
        <span className="font-semibold">{r.item?.productName}</span>
        <span className="erp-text-muted"> · {r.quantity.toLocaleString("en-IN")} unit(s) · order </span>
        <Link to={`/account/orders/${r.order?.id}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">
          {r.order?.orderNumber}
        </Link>
      </p>
      <p className="mt-0.5 text-xs erp-text-muted">
        {RETURN_REASON_LABELS[r.reason] ?? r.reason} · {RETURN_CONDITION_LABELS[r.condition] ?? r.condition}
      </p>

      {r.status === "REJECTED" && r.rejectionReason && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
          Rejected: {r.rejectionReason}
        </p>
      )}
      {r.refund && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          Refund {r.refund.refundNumber}: {inrMinor(r.refund.amountMinor)}{r.refund.processedAt ? ` · ${formatDateTime(r.refund.processedAt)}` : ""}
        </p>
      )}
      {r.pointsAwarded != null && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Coins className="h-3.5 w-3.5" aria-hidden /> {r.pointsAwarded.toLocaleString("en-IN")} ZP points credited
          {r.recycle?.acceptedQuantity != null && ` on ${r.recycle.acceptedQuantity.toLocaleString("en-IN")} accepted unit(s)`}
        </p>
      )}

      {open && <Timeline r={r} />}
      {open && r.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() =>
                returnsApi.downloadFile(r.id, f.id).then((b) => saveBlob(b, f.fileName)).catch((e) => toast.error("Download failed", describeApiError(e).message))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border erp-border px-2.5 py-1.5 text-xs font-semibold erp-text-muted hover:erp-surface-2"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden /> {f.fileName}
              <Download className="h-3 w-3" aria-hidden />
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
          {open ? "Hide timeline" : "View timeline"}
        </Button>
        {cancellable && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>
            Cancel request
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Recycle() {
  const [tab, setTab] = useState<"all" | "RETURN" | "RECYCLE">("all");
  const [requests, setRequests] = useState<ReturnRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<{ balance: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [res, pts] = await Promise.all([returnsApi.list(), returnsApi.points()]);
      setRequests(res.requests);
      setPoints(pts);
    } catch (e) {
      setRequests(null);
      setError(describeApiError(e).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = (requests ?? []).filter((r) => tab === "all" || r.type === tab);

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Returns & Recycling" }]}
        title="My Returns & Recycling"
        subtitle="Track your return and recycling requests. New requests start from Orders → order → Return / Recycle."
        actions={
          points && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Coins className="h-4 w-4" aria-hidden /> {points.balance.toLocaleString("en-IN")} ZP points
            </span>
          )
        }
      />

      <Tabs
        tabs={[
          { key: "all", label: "All" },
          { key: "RETURN", label: "Returns" },
          { key: "RECYCLE", label: "Recycling" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />

      {requests === null && !error && <Panel><ListSkeleton rows={3} /></Panel>}
      {error && <Panel><ErrorState message={error} onRetry={() => void load()} /></Panel>}
      {requests !== null && visible.length === 0 && (
        <Panel>
          <EmptyState
            icon={Leaf}
            title={tab === "RECYCLE" ? "No recycling requests yet" : tab === "RETURN" ? "No return requests yet" : "No requests yet"}
            message="Open a delivered order and choose Return / Recycle on an item to raise a request."
            action={<Link to="/account/orders" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-bold text-white hover:bg-primary-600">Go to my orders</Link>}
          />
        </Panel>
      )}
      {visible.map((r) => (
        <RequestCard key={r.id} r={r} onCancelled={() => void load()} />
      ))}
    </div>
  );
}
