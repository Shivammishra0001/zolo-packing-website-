import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Calculator, CalendarClock, CheckCircle2, Circle, ImageOff, PackageCheck, ThumbsUp, XCircle } from "lucide-react";
import {
  adminRecyclingApi, fmtQty, RECYCLING_CONDITIONS, RECYCLING_STATUS_LABEL, type AdminRecyclingRequest, type RecyclingCondition, type RecyclingStatus,
} from "@/lib/api/recycling";
import { describeApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Button, Dialog, KeyValue, PageHeader } from "../../components/ui";
import { ErrorState, ListSkeleton, Panel } from "../../components/Panel";
import { formatDate, formatDateTime } from "../../format";
import { AREA, Field, FIELD, FIELD_ERR } from "../marketing/shared";
import { RecyclingStatusBadge } from "./RecyclingRequestsSection";

// One recycling request: what the customer sent → what actually arrived → which
// rule applies → the credits the SYSTEM calculates → approve or reject.
//
// The admin never types a credit amount. "Calculate Credits" saves the verified
// quantity + rule and the server answers with the working; the approve button
// carries that server figure (the server recalculates again on approval).

const FLOW: RecyclingStatus[] = ["PENDING", "PICKUP_SCHEDULED", "RECEIVED", "UNDER_VERIFICATION", "APPROVED"];
const CONDITION_LABEL: Record<RecyclingCondition, string> = { clean: "Clean", mixed: "Mixed", contaminated: "Contaminated", damaged: "Damaged" };

/** Private photo, fetched with the admin's token (never a public URL). */
function Photo({ requestId, fileId, name }: { requestId: string; fileId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true; let made: string | null = null;
    adminRecyclingApi.downloadFile(requestId, fileId)
      .then((blob) => { if (!alive) return; made = URL.createObjectURL(blob); setUrl(made); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [requestId, fileId]);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" title={name} className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border erp-border erp-surface-2">
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : failed ? <ImageOff className="h-5 w-5 erp-text-faint" aria-hidden /> : <span className="h-full w-full animate-pulse erp-surface-2" />}
    </a>
  );
}

export default function RecyclingRequestDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [r, setR] = useState<AdminRecyclingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickupDate, setPickupDate] = useState("");
  const [qty, setQty] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [condition, setCondition] = useState<RecyclingCondition | "">("");
  const [notes, setNotes] = useState("");
  const [calcError, setCalcError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const adopt = useCallback((next: AdminRecyclingRequest) => {
    setR(next);
    setQty(next.verifiedQuantity != null ? String(next.verifiedQuantity) : "");
    const active = (next.applicableRules ?? []).filter((x) => x.isActive);
    setRuleId(next.ruleId ?? (active.length === 1 ? active[0].id : ""));
    setCondition(next.condition ?? "");
    setNotes(next.adminNotes ?? "");
    setCalcError(null);
  }, []);

  const load = useCallback(async () => {
    try { setError(null); adopt(await adminRecyclingApi.request(id)); }
    catch (e) { setError(describeApiError(e).message); }
  }, [id, adopt]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<AdminRecyclingRequest>, okTitle: string, okBody?: (n: AdminRecyclingRequest) => string) => {
    setBusy(true);
    try { const next = await fn(); adopt(next); toast.success(okTitle, okBody?.(next)); return next; }
    catch (e) { toast.error("Action failed", describeApiError(e).message); return null; }
    finally { setBusy(false); }
  };

  if (error) return <div className="shell-admin"><Panel><ErrorState message={error} onRetry={() => void load()} /></Panel></div>;
  if (!r) return <div className="shell-admin"><Panel><ListSkeleton rows={6} /></Panel></div>;

  const rules = r.applicableRules ?? [];
  const canVerify = r.status === "RECEIVED" || r.status === "UNDER_VERIFICATION";
  const closed = ["APPROVED", "REJECTED", "CANCELLED"].includes(r.status);
  const calc = r.calculation;
  // The button is only trusted while the form still matches what the server calculated.
  const inSync = r.status === "UNDER_VERIFICATION" && calc?.credits != null && !calc.error
    && Number(qty) === r.verifiedQuantity && ruleId === r.ruleId;
  const qtyValid = /^\d+(\.\d{1,3})?$/.test(qty.trim()) && Number(qty) > 0;

  const calculate = async () => {
    setCalcError(null);
    setBusy(true);
    try {
      adopt(await adminRecyclingApi.verify(r.id, { verifiedQuantity: Number(qty), ruleId, condition: condition || null, adminNotes: notes.trim() || null }));
    } catch (e) { setCalcError(describeApiError(e).message); }
    finally { setBusy(false); }
  };

  const reached = new Map(r.timeline.map((t) => [t.status, t.at]));
  const flow: RecyclingStatus[] = r.status === "REJECTED" || r.status === "CANCELLED" ? [...FLOW.filter((s) => reached.has(s)), r.status] : FLOW;

  return (
    <div className="shell-admin">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Returns & Recycling", to: "/admin/returns" }, { label: "Recycling Requests", to: "/admin/returns/recycling" }, { label: r.requestNumber }]}
        title={<span className="flex flex-wrap items-center gap-3">Recycling request {r.requestNumber} <RecyclingStatusBadge status={r.status} /></span>}
        subtitle={`Submitted ${formatDateTime(r.createdAt)}`}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------------- what the customer sent ---------------- */}
        <div className="space-y-5">
          <Panel title="Request">
            <KeyValue items={[
              { label: "Customer", value: r.customer ? <Link to={`/admin/customers/${r.customer.id}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">{r.customer.name}</Link> : "—" },
              { label: "Email", value: r.customer?.email ?? "—" },
              { label: "Request ID", value: <span className="font-mono">{r.requestNumber}</span> },
              { label: "Material", value: r.material },
              { label: "Customer estimate", value: `${fmtQty(r.estimatedQuantity)} ${r.unit}` },
              { label: "Request date", value: formatDateTime(r.createdAt) },
              { label: "Current status", value: RECYCLING_STATUS_LABEL[r.status] },
            ]} />
            {r.description && <p className="mt-3 rounded-lg erp-surface-2 p-3 text-sm erp-text-muted">“{r.description}”</p>}
          </Panel>

          <Panel title={`Uploaded images (${r.files.length})`}>
            {r.files.length === 0
              ? <p className="text-sm erp-text-muted">The customer did not attach photos.</p>
              : <div className="flex flex-wrap gap-3">{r.files.map((f) => <Photo key={f.id} requestId={r.id} fileId={f.id} name={f.fileName} />)}</div>}
          </Panel>

          <Panel title="Pickup information">
            <address className="text-sm not-italic erp-text">
              <span className="font-semibold">{r.pickup.name}</span>{r.pickup.phone && <span className="erp-text-muted"> · {r.pickup.phone}</span>}<br />
              <span className="erp-text-muted">{[r.pickup.line1, r.pickup.line2, r.pickup.city, r.pickup.state, r.pickup.postalCode].filter(Boolean).join(", ")}</span>
            </address>
            <p className="mt-2 text-sm erp-text-muted">Pickup: {r.pickup.scheduledFor ? <span className="font-semibold erp-text">{formatDate(r.pickup.scheduledFor)}</span> : "not scheduled"}{r.receivedAt && <> · received {formatDateTime(r.receivedAt)}</>}</p>
            {(r.status === "PENDING" || r.status === "PICKUP_SCHEDULED") && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold erp-text-muted">{r.status === "PENDING" ? "Pickup date" : "Reschedule"}</span>
                  <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className={cn(FIELD, "w-44")} />
                </label>
                <Button icon={CalendarClock} disabled={busy || !pickupDate} onClick={() => void run(() => adminRecyclingApi.schedulePickup(r.id, pickupDate), "Pickup scheduled")}>
                  {r.status === "PENDING" ? "Schedule pickup" : "Update pickup"}
                </Button>
                <Button variant="primary" icon={PackageCheck} disabled={busy} onClick={() => void run(() => adminRecyclingApi.markReceived(r.id), "Marked received", () => "You can now verify the quantity.")}>
                  Mark received
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="Progress">
            <ol className="space-y-2">
              {flow.map((s) => {
                const at = reached.get(s);
                const bad = s === "REJECTED" || s === "CANCELLED";
                return (
                  <li key={s} className="flex items-center gap-2 text-sm">
                    {at ? (bad ? <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />) : <Circle className="h-4 w-4 shrink-0 erp-text-faint" aria-hidden />}
                    <span className={at ? "font-semibold erp-text" : "erp-text-faint"}>{RECYCLING_STATUS_LABEL[s]}</span>
                    <span className="ml-auto text-xs erp-text-faint">{at ? formatDateTime(at) : "—"}</span>
                  </li>
                );
              })}
            </ol>
            {r.rejectionReason && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">Rejected: {r.rejectionReason}</p>}
          </Panel>
        </div>

        {/* ---------------- verification ---------------- */}
        <Panel title="Verification">
          {!canVerify && !closed && (
            <p className="rounded-lg border erp-border erp-surface-2 p-3 text-sm erp-text-muted">Mark the material as <span className="font-semibold erp-text">received</span> first — credits are calculated on what actually arrived, not on the estimate.</p>
          )}

          {(canVerify || r.status === "APPROVED") && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Actual verified quantity (${r.unit})`} required hint={`Customer estimated ${fmtQty(r.estimatedQuantity)} ${r.unit}.`}>
                  <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="8.5" disabled={!canVerify} className={cn(FIELD, qty && !qtyValid && FIELD_ERR)} aria-label="Verified quantity" />
                </Field>
                <Field label="Unit" hint="Set by the customer's material choice.">
                  <input value={r.unit} disabled readOnly className={FIELD} />
                </Field>
              </div>
              <Field label="Recycling rule" required hint={rules.length === 0 ? `No rule exists for ${r.material} per ${r.unit}. Add one under Recycling Rules.` : "Decides the credits per unit. Only active rules can be used."}>
                <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} disabled={!canVerify} className={FIELD} aria-label="Recycling rule">
                  <option value="">Select a rule…</option>
                  {rules.map((x) => (
                    <option key={x.id} value={x.id} disabled={!x.isActive}>
                      {x.material} — {fmtQty(x.creditsPerUnit)} Credits/{x.unit}{x.minQuantity != null || x.maxQuantity != null ? ` (${x.minQuantity != null ? `min ${fmtQty(x.minQuantity)}` : ""}${x.minQuantity != null && x.maxQuantity != null ? ", " : ""}${x.maxQuantity != null ? `max ${fmtQty(x.maxQuantity)}` : ""})` : ""}{x.isActive ? "" : " — inactive"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Condition">
                  <select value={condition} onChange={(e) => setCondition(e.target.value as RecyclingCondition | "")} disabled={!canVerify} className={FIELD}>
                    <option value="">Not recorded</option>
                    {RECYCLING_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Admin notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canVerify} placeholder="Verified clean cardboard packaging" maxLength={1000} className={AREA} />
              </Field>

              {canVerify && (
                <Button icon={Calculator} loading={busy} disabled={!qtyValid || !ruleId} onClick={calculate}>Calculate Credits</Button>
              )}
              {calcError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{calcError}</p>}
              {calc?.error && !calcError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{calc.error}</p>}

              {/* ---- CALCULATION (server-produced) ---- */}
              {calc && !calc.error && calc.credits != null && (
                <div className={cn("rounded-xl border-2 p-4", inSync || calc.snapshot ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "erp-border opacity-60")} aria-live="polite">
                  <div className="text-[11px] font-bold uppercase tracking-widest erp-text-faint">Calculation{calc.snapshot ? " · recorded at approval" : ""}</div>
                  <dl className="mt-2 space-y-1 text-sm erp-text">
                    <div className="flex justify-between gap-3"><dt className="erp-text-muted">Verified quantity</dt><dd className="font-semibold">{fmtQty(calc.verifiedQuantity)} {calc.unit}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="erp-text-muted">Credits per {calc.unit}</dt><dd className="font-semibold">{fmtQty(calc.creditsPerUnit)}</dd></div>
                  </dl>
                  <div className="my-3 border-t border-dashed erp-border" />
                  <div className="text-sm erp-text-muted">{fmtQty(calc.verifiedQuantity)} {calc.unit} × {fmtQty(calc.creditsPerUnit)} Credits/{calc.unit}</div>
                  <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold erp-text">Eco Credits {calc.snapshot ? "awarded" : "to award"}</span>
                    <span className="font-display text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">= {calc.credits.toLocaleString("en-IN")}</span>
                  </div>
                  <p className="mt-1 text-[11px] erp-text-faint">{calc.rounding}. Calculated by the system — it cannot be typed or edited.</p>
                  {!calc.snapshot && !inSync && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">The form changed — press “Calculate Credits” again.</p>}
                </div>
              )}

              {canVerify && (
                <div className="flex flex-wrap justify-end gap-2 border-t erp-border pt-4">
                  <Button variant="danger" icon={XCircle} disabled={busy} onClick={() => { setReason(""); setRejectOpen(true); }}>Reject Request</Button>
                  <Button
                    variant="primary" icon={ThumbsUp} disabled={busy || !inSync || (calc?.credits ?? 0) <= 0}
                    onClick={() => void run(() => adminRecyclingApi.approve(r.id, calc!.credits!), "Eco Credits awarded", (n) => `${n.creditsAwarded} Eco Credits added to ${n.customer?.name ?? "the customer"}'s wallet.`)}
                  >
                    Approve &amp; Award {inSync ? calc!.credits : "…"} Credits
                  </Button>
                </div>
              )}
              {r.status === "APPROVED" && (
                <p className="text-sm erp-text-muted">Approved {r.approvedAt ? formatDateTime(r.approvedAt) : ""}. This record keeps the rule rate used at the time — later rule changes never alter it. <Link to={`/admin/returns/eco-credits?requestNumber=${r.requestNumber}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">View ledger entry</Link></p>
              )}
            </div>
          )}

          {!canVerify && !closed && (
            <div className="mt-4 flex justify-end border-t erp-border pt-4">
              <Button variant="danger" icon={XCircle} disabled={busy} onClick={() => { setReason(""); setRejectOpen(true); }}>Reject Request</Button>
            </div>
          )}
          {(r.status === "REJECTED" || r.status === "CANCELLED") && <p className="text-sm erp-text-muted">This request is closed. No Eco Credits were awarded.</p>}
        </Panel>
      </div>

      <Dialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject ${r.requestNumber}?`}
        description="No Eco Credits are awarded. The customer sees this reason."
        footer={<>
          <Button onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={XCircle} loading={busy} disabled={reason.trim().length < 3} onClick={async () => { const done = await run(() => adminRecyclingApi.reject(r.id, reason.trim()), "Request rejected"); if (done) setRejectOpen(false); }}>Reject request</Button>
        </>}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Reason <span className="text-red-500">*</span></span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Material contaminated with food waste" maxLength={300} className={FIELD} />
        </label>
      </Dialog>
    </div>
  );
}
