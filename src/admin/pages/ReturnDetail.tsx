import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Download, Leaf, Paperclip, Truck, Wallet, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "../components/Panel";
import { Badge, Button, KeyValue, PageHeader, Timeline } from "../components/ui";
import { formatDateTime, inrMinor } from "../format";
import { describeApiError, saveBlob } from "@/lib/api/client";
import {
  adminReturnsApi,
  prettyReturnStatus,
  RETURN_REASON_LABELS,
  RETURN_CONDITION_LABELS,
  type AdminReturnDetail,
  type ReturnResolution,
} from "@/lib/api/returns";

// ============================================================
// Admin return/recycle detail — progressive disclosure:
//   1. Review the customer's request → Approve / Reject.
//   2. After approval, select ONE resolution (Refund / Replacement / Recycle).
//   3. Only that branch's workflow is shown — never all three at once.
// Every action calls the state machine on the backend; nothing here is a
// status short-cut.
// ============================================================

const INPUT = "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500";

type Act = (fn: () => Promise<AdminReturnDetail>, done: string) => Promise<void>;

function useDetail(id: string) {
  const [r, setR] = useState<AdminReturnDetail | null>(null);
  const [error, setError] = useState<ReturnType<typeof describeApiError> | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      setR(await adminReturnsApi.get(id));
    } catch (e) {
      setR(null);
      setError(describeApiError(e));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  return { r, setR, error, load };
}

// ---- Branch panels ---------------------------------------------------------

function RefundPanel({ r, act }: { r: AdminReturnDetail; act: Act }) {
  const maxMinor = r.item ? Math.round((r.item.lineTotalMinor * r.quantity) / r.item.purchasedQuantity) : 0;
  const [amount, setAmount] = useState(String(maxMinor / 100));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  if (r.status === "REFUNDED") {
    return (
      <Panel title="Refund">
        <p className="text-sm erp-text">
          <Check className="mr-1 inline h-4 w-4 text-emerald-500" aria-hidden />
          {r.refund ? `${r.refund.refundNumber} · ${inrMinor(r.refund.amountMinor)} · ref ${r.refund.reference}` : "Refund completed."}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Process refund">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold erp-text-muted">Refund amount (₹) — max {inrMinor(maxMinor)}</span>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={`mt-1 ${INPUT}`} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold erp-text-muted">Payment reference (UTR / transaction id) *</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Required — proof of the actual transfer" className={`mt-1 ${INPUT}`} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold erp-text-muted">Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${INPUT}`} />
        </label>
      </div>
      <p className="mt-2 text-[11px] erp-text-faint">
        The refund is recorded against the order's captured payment and marked completed only with the reference above — never on a click alone.
      </p>
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          icon={Wallet}
          onClick={() => {
            const minor = Math.round(Number(amount) * 100);
            if (!window.confirm(`Confirm refund of ₹${Number(amount).toLocaleString("en-IN")}?`)) return;
            void act(() => adminReturnsApi.refund(r.id, { amountMinor: minor, reference: reference.trim(), notes: notes.trim() || undefined }), "Refund recorded");
          }}
        >
          Approve Refund
        </Button>
      </div>
    </Panel>
  );
}

function ReplacementPanel({ r, act }: { r: AdminReturnDetail; act: Act }) {
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  return (
    <Panel title="Replacement">
      <KeyValue
        items={[
          { label: "Replacement quantity", value: r.replacement?.quantity ?? r.quantity },
          { label: "Courier", value: r.replacement?.courier ?? "—" },
          { label: "Tracking", value: r.replacement?.tracking ?? "—" },
          { label: "Shipped", value: r.replacement?.shippedAt ? formatDateTime(r.replacement.shippedAt) : "Pending" },
          { label: "Delivered", value: r.replacement?.deliveredAt ? formatDateTime(r.replacement.deliveredAt) : "Pending" },
        ]}
      />
      {r.status === "REPLACEMENT_PROCESSING" && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Courier</span>
            <input value={courier} onChange={(e) => setCourier(e.target.value)} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Tracking number</span>
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={`mt-1 ${INPUT}`} />
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <Button variant="primary" icon={Truck} onClick={() => void act(() => adminReturnsApi.shipReplacement(r.id, { courier: courier.trim() || undefined, trackingNumber: tracking.trim() || undefined }), "Replacement marked shipped")}>
              Mark shipped
            </Button>
          </div>
        </div>
      )}
      {r.status === "REPLACEMENT_SHIPPED" && (
        <div className="mt-4 flex justify-end">
          <Button variant="primary" icon={Check} onClick={() => void act(() => adminReturnsApi.deliverReplacement(r.id), "Replacement marked delivered")}>
            Mark delivered
          </Button>
        </div>
      )}
    </Panel>
  );
}

function RecyclePanel({ r, act }: { r: AdminReturnDetail; act: Act }) {
  const [pickupDate, setPickupDate] = useState("");
  const [received, setReceived] = useState(String(r.quantity));
  const [accepted, setAccepted] = useState(String(r.quantity));
  const [notes, setNotes] = useState("");
  const rec = r.recycle;

  return (
    <Panel title="Recycling">
      <KeyValue
        items={[
          { label: "Pickup scheduled", value: rec?.pickupScheduledFor ? formatDateTime(rec.pickupScheduledFor) : "—" },
          { label: "Received", value: rec?.receivedQuantity ?? "—" },
          { label: "Accepted", value: rec?.acceptedQuantity ?? "—" },
          { label: "Rejected", value: rec?.rejectedQuantity ?? "—" },
          { label: "Points credited", value: r.pointsAwarded ?? "—" },
        ]}
      />
      {rec?.inspectionNotes && <p className="mt-2 text-xs erp-text-muted">Inspection: {rec.inspectionNotes}</p>}

      {r.status === "PICKUP_SCHEDULED" && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Reschedule pickup</span>
            <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className={`mt-1 ${INPUT}`} />
          </label>
          <Button variant="secondary" disabled={!pickupDate} onClick={() => void act(() => adminReturnsApi.schedulePickup(r.id, pickupDate), "Pickup rescheduled")}>
            Update pickup
          </Button>
          <Button variant="primary" onClick={() => void act(() => adminReturnsApi.markReceived(r.id), "Marked received")}>
            Mark received
          </Button>
        </div>
      )}

      {r.status === "RECEIVED" && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Received qty</span>
            <input type="number" min={0} value={received} onChange={(e) => setReceived(e.target.value)} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Accepted qty</span>
            <input type="number" min={0} value={accepted} onChange={(e) => setAccepted(e.target.value)} className={`mt-1 ${INPUT}`} />
          </label>
          <label className="col-span-2 block">
            <span className="text-xs font-semibold erp-text-muted">Inspection notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`mt-1 ${INPUT}`} />
          </label>
          <div className="col-span-2 sm:col-span-4 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                const recN = Number(received), accN = Number(accepted);
                void act(() => adminReturnsApi.inspect(r.id, { receivedQuantity: recN, acceptedQuantity: accN, rejectedQuantity: recN - accN, notes: notes.trim() || undefined }), "Inspection recorded");
              }}
            >
              Record inspection
            </Button>
          </div>
        </div>
      )}

      {r.status === "INSPECTED" && (
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => void act(() => adminReturnsApi.startRecycle(r.id), "Recycling started")}>Start recycling</Button>
        </div>
      )}
      {r.status === "RECYCLE_PROCESSING" && (
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => void act(() => adminReturnsApi.completeRecycle(r.id), "Recycling completed")}>Mark recycled</Button>
        </div>
      )}
      {r.status === "RECYCLED" && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs erp-text-muted">
            Points are computed by the backend from the configured rules on the ACCEPTED quantity ({rec?.acceptedQuantity ?? 0} unit(s)) and credited to the ledger exactly once.
          </p>
          <Button variant="primary" icon={Leaf} onClick={() => void act(() => adminReturnsApi.creditPoints(r.id), "Points credited")}>
            Credit points
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ---- Page ------------------------------------------------------------------

export default function ReturnDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { r, setR, error, load } = useDetail(id);
  const [resolution, setResolution] = useState<ReturnResolution | "">("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Opening a submitted request marks it under review (idempotent).
  useEffect(() => {
    if (r?.status === "SUBMITTED") adminReturnsApi.review(r.id).then(setR).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, r?.status]);

  const act: Act = async (fn, done) => {
    setBusy(true);
    try {
      setR(await fn());
      toast.success(done);
    } catch (e) {
      toast.error("That didn't work", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-[900px]">
        <PageHeader breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Returns & Recycling", to: "/admin/returns" }, { label: id }]} title="Request" />
        <Panel>
          {error.kind === "notFound" ? (
            <EmptyState title="Request not found" message={`No request matches “${id}”.`} action={<Link to="/admin/returns" className="rounded-lg border erp-border px-4 py-2 text-sm font-bold erp-text">Back to list</Link>} />
          ) : (
            <ErrorState message={error.message} onRetry={() => void load()} />
          )}
        </Panel>
      </div>
    );
  }
  if (!r) return <div className="mx-auto max-w-[900px]"><Panel><ListSkeleton rows={6} /></Panel></div>;

  const inReview = r.status === "UNDER_REVIEW";
  const needsResolution = r.status === "APPROVED";

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Returns & Recycling", to: "/admin/returns" }, { label: r.requestNumber }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.requestNumber}
            <Badge tone={r.type === "RECYCLE" ? "success" : "primary"}>{r.type === "RECYCLE" ? "Recycle" : "Return"}</Badge>
            <Badge tone="info">{prettyReturnStatus(r.status)}</Badge>
            {r.resolution && <Badge tone="neutral">Resolution: {r.resolution}</Badge>}
          </span>
        }
        subtitle={`Submitted ${formatDateTime(r.createdAt)} · customer requested: ${r.type}`}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Request details">
            <KeyValue
              items={[
                { label: "Customer", value: r.customer?.name ?? "—" },
                { label: "Email / phone", value: [r.customer?.email, r.customer?.phone].filter(Boolean).join(" · ") || "—" },
                { label: "Order", value: <Link to={`/admin/orders/${r.order?.id}`} className="font-mono text-primary-600 hover:underline dark:text-primary-400">{r.order?.orderNumber}</Link> },
                { label: "Order date", value: r.order ? formatDateTime(r.order.placedAt) : "—" },
                { label: "Product", value: `${r.item?.productName ?? "—"}${r.item?.sku ? ` (${r.item.sku})` : ""}` },
                { label: "Purchased / requested", value: `${r.item?.purchasedQuantity ?? "—"} / ${r.quantity}` },
                { label: "Reason", value: RETURN_REASON_LABELS[r.reason] ?? r.reason },
                { label: "Condition", value: RETURN_CONDITION_LABELS[r.condition] ?? r.condition },
                { label: "Previous requests", value: r.previousRequests },
                { label: "Seller", value: r.sellerId ? <Link to={`/admin/sellers/${r.sellerId}`} className="text-primary-600 hover:underline dark:text-primary-400">View seller</Link> : "House product" },
              ]}
            />
            {r.description && <p className="mt-3 rounded-lg bg-dark-50 p-3 text-sm erp-text-muted dark:bg-white/5">“{r.description}”</p>}
            <p className="mt-3 text-xs erp-text-muted">
              Pickup: {r.pickup.name} · {r.pickup.phone} · {[r.pickup.line1, r.pickup.line2, r.pickup.city, r.pickup.state, r.pickup.postalCode].filter(Boolean).join(", ")}
            </p>
            {r.files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.files.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => adminReturnsApi.downloadFile(r.id, f.id).then((b) => saveBlob(b, f.fileName)).catch((e) => toast.error("Download failed", describeApiError(e).message))}
                    className="inline-flex items-center gap-1.5 rounded-lg border erp-border px-2.5 py-1.5 text-xs font-semibold erp-text-muted hover:erp-surface-2"
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden /> {f.fileName} <Download className="h-3 w-3" aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {/* Step 1 — approve / reject */}
          {inReview && (
            <Panel title="Admin decision">
              <div className="flex flex-wrap items-end gap-3">
                <Button variant="primary" icon={Check} disabled={busy} onClick={() => void act(() => adminReturnsApi.approve(r.id), "Request approved")}>
                  Approve Request
                </Button>
                <label className="block min-w-60 flex-1">
                  <span className="text-xs font-semibold erp-text-muted">Rejection reason</span>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Required to reject" className={`mt-1 ${INPUT}`} />
                </label>
                <Button variant="danger" icon={X} disabled={busy || !rejectReason.trim()} onClick={() => void act(() => adminReturnsApi.reject(r.id, rejectReason.trim()), "Request rejected")}>
                  Reject Request
                </Button>
              </div>
            </Panel>
          )}

          {/* Step 2 — ONE resolution */}
          {needsResolution && (
            <Panel title="Select resolution">
              <div className="flex flex-wrap gap-4">
                {(["REFUND", "REPLACEMENT", "RECYCLE"] as const).map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm font-semibold erp-text">
                    <input type="radio" name="resolution" checked={resolution === opt} onChange={() => setResolution(opt)} className="accent-primary-600" />
                    {opt === "REFUND" ? "Refund" : opt === "REPLACEMENT" ? "Damage / Replacement" : "Recycle"}
                  </label>
                ))}
                <Button
                  variant="primary"
                  disabled={busy || !resolution}
                  onClick={() => resolution && void act(() => adminReturnsApi.setResolution(r.id, { resolution }), `Resolution set: ${resolution}`)}
                >
                  Continue
                </Button>
              </div>
              <p className="mt-2 text-xs erp-text-faint">Only the selected resolution's workflow will be shown next.</p>
            </Panel>
          )}

          {/* Step 3 — ONLY the selected branch */}
          {r.resolution === "REFUND" && ["REFUND_PROCESSING", "REFUNDED"].includes(r.status) && <RefundPanel r={r} act={act} />}
          {r.resolution === "REPLACEMENT" && r.status.startsWith("REPLACEMENT") && <ReplacementPanel r={r} act={act} />}
          {r.resolution === "RECYCLE" && ["PICKUP_SCHEDULED", "RECEIVED", "INSPECTED", "RECYCLE_PROCESSING", "RECYCLED", "POINTS_CREDITED"].includes(r.status) && (
            <RecyclePanel r={r} act={act} />
          )}

          {["REFUNDED", "REPLACEMENT_DELIVERED", "POINTS_CREDITED"].includes(r.status) && (
            <div className="flex justify-end">
              <Button variant="secondary" disabled={busy} onClick={() => void act(() => adminReturnsApi.close(r.id), "Request closed")}>
                Close request
              </Button>
            </div>
          )}
          {r.status === "REJECTED" && r.rejectionReason && (
            <Panel title="Rejected"><p className="text-sm text-red-600">{r.rejectionReason}</p></Panel>
          )}
        </div>

        {/* Activity */}
        <div>
          <Panel title="Activity">
            <Timeline
              entries={r.timeline.map((t) => ({
                id: t.id,
                title: prettyReturnStatus(t.status),
                meta: t.note ?? undefined,
                time: formatDateTime(t.at),
                tone: t.status === "REJECTED" || t.status === "CANCELLED" ? "danger" : ["REFUNDED", "POINTS_CREDITED", "REPLACEMENT_DELIVERED", "CLOSED"].includes(t.status) ? "success" : "primary",
              }))}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
