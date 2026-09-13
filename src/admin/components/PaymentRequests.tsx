// Payment requests — shared admin UI used by Settings, Finance and the
// customer profile. Everything renders from /admin/payment-requests; the
// amount is fixed server-side and a request only becomes PAID when an admin
// approves it here (never from the customer's own claim).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, ExternalLink, FileImage, Link2, RefreshCw, Send, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { inrMinor, formatDateTime } from "../format";
import { Badge, Button, Dialog, Select } from "./ui";
import { EmptyState, Panel } from "./Panel";
import { DataTable, type Column } from "./DataTable";
import { useAdminQuery } from "../dashboard-api";
import {
  paymentRequestsApi,
  paymentSettingsApi,
  PAYMENT_METHOD_LABEL,
  REQUEST_STATUS_TONE,
  type CreatePaymentRequestInput,
  type PaymentMethodKey,
  type PaymentRequest,
} from "@/lib/api/settings";

const STATUS_OPTIONS = ["", "SENT", "SUBMITTED", "PAID", "PENDING", "REJECTED", "EXPIRED", "CANCELLED"];
const ONLINE_METHODS: PaymentMethodKey[] = ["upi", "bank_transfer", "neft", "cheque"];

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Send a payment request (dialog)
// ---------------------------------------------------------------------------
export function SendPaymentRequestDialog({
  open,
  onClose,
  customer,
  orders = [],
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name: string; email: string } | null;
  orders?: { id: string; orderNumber: string; grandTotalMinor: number; paymentStatus: string }[];
  onCreated?: (pr: PaymentRequest) => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [orderId, setOrderId] = useState("");
  const [expires, setExpires] = useState("");
  const [methods, setMethods] = useState<PaymentMethodKey[]>([]);
  const [enabledMethods, setEnabledMethods] = useState<PaymentMethodKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PaymentRequest | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(""); setTitle(""); setDescription(""); setOrderId(""); setExpires(""); setError(null); setCreated(null); setBusy(false);
    paymentSettingsApi.list()
      .then((r) => {
        const on = r.methods.filter((m) => m.enabled && ONLINE_METHODS.includes(m.key)).map((m) => m.key);
        setEnabledMethods(on);
        setMethods(on);
      })
      .catch(() => setEnabledMethods([]));
  }, [open]);

  // Picking an order pre-fills the outstanding amount and title.
  useEffect(() => {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    setAmount(String(Math.round(o.grandTotalMinor / 100)));
    setTitle(`Payment for order ${o.orderNumber}`);
  }, [orderId, orders]);

  const submit = async () => {
    if (!customer) return;
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees < 1) { setError("Enter an amount of at least ₹1."); return; }
    if (title.trim().length < 2) { setError("Give the request a short title."); return; }
    if (methods.length === 0) { setError("Choose at least one payment method."); return; }
    setBusy(true); setError(null);
    try {
      const input: CreatePaymentRequestInput = {
        userId: customer.id,
        amountMinor: Math.round(rupees * 100),
        title: title.trim(),
        description: description.trim() || null,
        orderId: orderId || null,
        expiresAt: expires ? new Date(expires).toISOString() : null,
        allowedMethods: methods,
        send: true,
      };
      const pr = await paymentRequestsApi.create(input);
      setCreated(pr);
      toast.success("Payment request sent", `${pr.requestNumber} · ${inrMinor(pr.amountMinor)} — the customer has been notified.`);
      onCreated?.(pr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the payment request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={created ? "Payment link ready" : "Send payment request"}
      description={customer ? `${customer.name} · ${customer.email}` : undefined}
      footer={
        created ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" icon={Send} loading={busy} onClick={submit} disabled={!customer}>Send request</Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3 text-sm">
          <p className="erp-text">
            <span className="font-mono font-semibold">{created.requestNumber}</span> for <b>{inrMinor(created.amountMinor)}</b> was sent to the customer
            (in-app, plus email/WhatsApp where enabled).
          </p>
          {created.payUrl && (
            <div className="flex items-center gap-2 rounded-lg border erp-border erp-surface-2 p-2">
              <Link2 className="h-4 w-4 shrink-0 erp-text-muted" aria-hidden />
              <code className="min-w-0 flex-1 truncate text-xs erp-text">{created.payUrl}</code>
              <Button size="sm" icon={Copy} onClick={() => void copyText(created.payUrl!).then((ok) => (ok ? toast.success("Link copied") : toast.error("Copy failed")))}>Copy</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {orders.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold erp-text-muted">Link to an order (optional)</span>
              <Select value={orderId} onChange={setOrderId} className="w-full">
                <option value="">— No order —</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>{o.orderNumber} · {inrMinor(o.grandTotalMinor)} · {o.paymentStatus}</option>
                ))}
              </Select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Amount (₹)</span>
            <input type="number" min={1} step="1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="erp-input w-full" placeholder="e.g. 12500" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="erp-input w-full" placeholder="e.g. Advance for custom mailer boxes" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Message to customer (optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} className="erp-input w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Pay by (optional)</span>
            <input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} className="erp-input w-full" />
          </label>
          <div>
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Allowed payment methods</span>
            {enabledMethods.length === 0 ? (
              <p className="text-xs text-amber-600">No online method is enabled — turn on UPI or Bank transfer in Settings → Payments first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {enabledMethods.map((m) => {
                  const on = methods.includes(m);
                  return (
                    <button key={m} type="button" onClick={() => setMethods((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300" : "erp-border erp-text-muted"}`}>
                      {PAYMENT_METHOD_LABEL[m] ?? m}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Review / list panel
// ---------------------------------------------------------------------------
export function PaymentRequestsPanel({
  userId,
  orderId,
  title = "Payment requests",
  compact = false,
  action,
}: {
  userId?: string;
  orderId?: string;
  title?: string;
  compact?: boolean;
  action?: React.ReactNode;
}) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const path = useMemo(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (userId) qs.set("userId", userId);
    if (orderId) qs.set("orderId", orderId);
    qs.set("take", "100");
    return `/admin/payment-requests?${qs.toString()}`;
  }, [status, userId, orderId]);
  const q = useAdminQuery<{ requests: PaymentRequest[]; total: number }>(path, 20_000);

  const [review, setReview] = useState<{ pr: PaymentRequest; mode: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofFor, setProofFor] = useState<PaymentRequest | null>(null);

  const openReview = (pr: PaymentRequest, mode: "approve" | "reject") => {
    setReview({ pr, mode });
    setNote("");
    setReference(pr.proof?.reference ?? "");
  };

  const confirmReview = async () => {
    if (!review) return;
    if (review.mode === "reject" && note.trim().length < 3) { toast.error("Give the customer a reason", "They will see it on the payment page."); return; }
    setBusy(true);
    try {
      if (review.mode === "approve") {
        const r = await paymentRequestsApi.approve(review.pr.id, { reference: reference.trim() || undefined, note: note.trim() || undefined });
        toast.success("Payment verified", `${r.requestNumber} marked paid${r.order ? ` — order ${r.order.orderNumber} is ${r.order.paymentStatus.toLowerCase()}` : ""}.`);
      } else {
        await paymentRequestsApi.reject(review.pr.id, note.trim());
        toast.info("Sent back to the customer", "They can resubmit with the correct details.");
      }
      setReview(null);
      q.refetch();
    } catch (e) {
      toast.error("Action failed", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (pr: PaymentRequest, what: "resend" | "cancel") => {
    try {
      if (what === "resend") { await paymentRequestsApi.resend(pr.id); toast.success("Link resent", `${pr.requestNumber} was sent to the customer again.`); }
      else { await paymentRequestsApi.cancel(pr.id); toast.info("Request cancelled", pr.requestNumber); }
      q.refetch();
    } catch (e) {
      toast.error("Action failed", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const viewProof = useCallback(async (pr: PaymentRequest) => {
    try {
      const url = await paymentRequestsApi.proofBlobUrl(pr.id);
      setProofUrl(url); setProofFor(pr);
    } catch (e) {
      toast.error("Could not load proof", e instanceof Error ? e.message : undefined);
    }
  }, [toast]);
  useEffect(() => () => { if (proofUrl) URL.revokeObjectURL(proofUrl); }, [proofUrl]);

  const columns: Column<PaymentRequest>[] = [
    {
      key: "req", header: "Request",
      render: (r) => (
        <div>
          <span className="font-mono text-sm font-semibold erp-text">{r.requestNumber}</span>
          <span className="block max-w-56 truncate text-xs erp-text-muted">{r.title}</span>
        </div>
      ),
    },
    ...(userId ? [] : [{
      key: "customer", header: "Customer", hideBelow: "md" as const,
      render: (r: PaymentRequest) => r.customer ? (
        <Link to={`/admin/customers/${r.customer.id}`} className="block max-w-48 truncate text-sm erp-text hover:text-primary-600">{r.customer.name}<span className="block truncate text-xs erp-text-faint">{r.customer.email}</span></Link>
      ) : <span className="erp-text-faint">—</span>,
    }]),
    { key: "order", header: "Order", hideBelow: "lg", render: (r) => r.order ? <Link to={`/admin/orders/${r.order.id}`} className="font-mono text-xs erp-text-muted hover:text-primary-600">{r.order.orderNumber}</Link> : <span className="erp-text-faint">—</span> },
    { key: "amount", header: "Amount", className: "text-right", render: (r) => <span className="font-semibold tabular-nums erp-text">{inrMinor(r.amountMinor)}</span> },
    {
      key: "proof", header: "Submitted", hideBelow: "md",
      render: (r) => r.proof ? (
        <div className="text-xs">
          <span className="erp-text">{PAYMENT_METHOD_LABEL[r.proof.method ?? ""] ?? r.proof.method}</span>
          {r.proof.reference && <span className="block font-mono erp-text-muted">{r.proof.reference}</span>}
          {r.proof.hasFile && <button type="button" onClick={() => void viewProof(r)} className="mt-0.5 inline-flex items-center gap-1 text-primary-600 hover:underline"><FileImage className="h-3 w-3" /> View proof</button>}
        </div>
      ) : <span className="text-xs erp-text-faint">{r.sentAt ? `Sent ${formatDateTime(r.sentAt)}` : "Not sent"}</span>,
    },
    { key: "status", header: "Status", render: (r) => <Badge tone={REQUEST_STATUS_TONE[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge> },
    {
      key: "actions", header: "", className: "text-right",
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-1">
          {r.status === "SUBMITTED" && (
            <>
              <Button size="sm" variant="primary" icon={Check} onClick={() => openReview(r, "approve")}>Approve</Button>
              <Button size="sm" variant="danger" icon={X} onClick={() => openReview(r, "reject")}>Reject</Button>
            </>
          )}
          {(r.status === "SENT" || r.status === "PENDING") && (
            <>
              <Button size="sm" variant="ghost" icon={Check} onClick={() => openReview(r, "approve")} title="Record payment received offline">Mark paid</Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void act(r, "resend")}>Resend</Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => void act(r, "cancel")}>Cancel</Button>
            </>
          )}
          {r.payUrl && r.status !== "PAID" && r.status !== "CANCELLED" && r.status !== "EXPIRED" && (
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyText(r.payUrl!).then((ok) => (ok ? toast.success("Link copied") : toast.error("Copy failed")))}>Link</Button>
          )}
        </div>
      ),
    },
  ];

  const rows = q.data?.requests ?? [];
  const submittedCount = rows.filter((r) => r.status === "SUBMITTED").length;

  return (
    <>
      <Panel
        title={
          <span className="flex items-center gap-2">
            {title}
            {submittedCount > 0 && <Badge tone="warning">{submittedCount} to review</Badge>}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <Select value={status} onChange={setStatus} aria-label="Filter by status" className="h-9">
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? s.charAt(0) + s.slice(1).toLowerCase() : "All statuses"}</option>)}
            </Select>
            {action}
          </div>
        }
        bodyClassName="p-0"
      >
        {q.status === "loading" ? (
          <div className="p-6 text-center text-sm erp-text-muted">Loading payment requests…</div>
        ) : q.status === "error" ? (
          <EmptyState icon={Link2} title="Couldn't load payment requests" message={q.error} action={<Button onClick={q.refetch}>Retry</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Link2} title="No payment requests" message={compact ? "Send one from the button above." : "Requests you send to customers appear here, with their submitted proof for review."} />
        ) : (
          <DataTable caption={title} columns={columns} rows={rows} rowKey={(r) => r.id} />
        )}
      </Panel>

      {/* Approve / reject */}
      <Dialog
        open={Boolean(review)}
        onClose={() => (busy ? undefined : setReview(null))}
        title={review?.mode === "approve" ? "Confirm payment received" : "Reject submitted payment"}
        description={review ? `${review.pr.requestNumber} · ${inrMinor(review.pr.amountMinor)}${review.pr.order ? ` · order ${review.pr.order.orderNumber}` : ""}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReview(null)} disabled={busy}>Back</Button>
            <Button variant={review?.mode === "approve" ? "primary" : "danger"} loading={busy} onClick={confirmReview}>
              {review?.mode === "approve" ? "Mark as paid" : "Reject & ask to resubmit"}
            </Button>
          </>
        }
      >
        {review && (
          <div className="space-y-3 text-sm">
            {review.pr.proof && (
              <div className="rounded-lg erp-surface-2 p-3 text-xs">
                <p className="erp-text"><b>Method:</b> {PAYMENT_METHOD_LABEL[review.pr.proof.method ?? ""] ?? review.pr.proof.method}</p>
                {review.pr.proof.reference && <p className="erp-text"><b>Reference:</b> <span className="font-mono">{review.pr.proof.reference}</span></p>}
                {review.pr.proof.note && <p className="erp-text-muted"><b>Customer note:</b> {review.pr.proof.note}</p>}
                {review.pr.proof.hasFile && <button type="button" onClick={() => void viewProof(review.pr)} className="mt-1 inline-flex items-center gap-1 text-primary-600 hover:underline"><FileImage className="h-3 w-3" /> View attached proof</button>}
              </div>
            )}
            {review.mode === "approve" ? (
              <>
                <p className="erp-text-muted">Confirm only after you have verified the money in your bank/UPI statement. This records a PAID payment on the order and notifies the customer.</p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold erp-text-muted">Transaction reference (UTR / UPI ref)</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} className="erp-input w-full" placeholder="Optional if already submitted" />
                </label>
              </>
            ) : (
              <p className="erp-text-muted">The customer will be told the payment could not be verified and can resubmit using the same link.</p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold erp-text-muted">{review.mode === "approve" ? "Internal note (optional)" : "Reason shown to the customer"}</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="erp-input w-full" />
            </label>
          </div>
        )}
      </Dialog>

      {/* Proof viewer */}
      <Dialog open={Boolean(proofUrl)} onClose={() => { setProofUrl(null); setProofFor(null); }} title={`Proof — ${proofFor?.requestNumber ?? ""}`} description={proofFor?.proof?.fileName ?? undefined}
        footer={<>{proofUrl && <a href={proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-primary-600"><ExternalLink className="h-4 w-4" /> Open in new tab</a>}<Button onClick={() => { setProofUrl(null); setProofFor(null); }}>Close</Button></>}>
        {proofUrl && (proofFor?.proof?.fileName?.toLowerCase().endsWith(".pdf") ? (
          <iframe title="Payment proof" src={proofUrl} className="h-[60vh] w-full rounded-lg border erp-border" />
        ) : (
          <img src={proofUrl} alt="Payment proof" className="max-h-[60vh] w-full rounded-lg object-contain" />
        ))}
      </Dialog>
    </>
  );
}
