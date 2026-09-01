import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Download, FileText, LogIn, Paperclip, RefreshCw, Send, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "../components/Panel";
import { Badge, Button, KeyValue, PageHeader, Timeline } from "../components/ui";
import { formatDateTime, inrMinor } from "../format";
import {
  adminRfqApi,
  type AdminRfqDetail,
  type RfqStatus,
} from "@/lib/api/rfq";
import { describeApiError, saveBlob } from "@/lib/api/client";

// ============================================================
// Admin RFQ / quotation detail — REAL data from /api/v1/admin/rfqs/:id.
//
// Replaces the mock page that read empty arrays and answered every route with
// "We couldn't find that RFQ" — including for RFQs that existed. Errors are
// now told apart: 401 renders a sign-in prompt, 404 a real not-found, network
// failure a retry — never a fake not-found.
// ============================================================

const STATUS_TONE: Record<RfqStatus, "warning" | "info" | "success" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  SUBMITTED: "warning",
  UNDER_REVIEW: "info",
  QUOTED: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
  EXPIRED: "neutral",
};

const MATCH_TONE: Record<string, "warning" | "info" | "success" | "danger"> = {
  INVITED: "warning",
  VIEWED: "info",
  QUOTED: "success",
  DECLINED: "danger",
};

const QUOTE_TONE: Record<string, "warning" | "info" | "success" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "success",
  REJECTED: "danger",
  CHANGES_REQUESTED: "warning",
  EXPIRED: "neutral",
  WITHDRAWN: "neutral",
};

const EVENT_LABEL: Record<string, string> = {
  "rfq.created": "RFQ submitted",
  "rfq.cancelled": "RFQ cancelled",
  "rfq.matched": "Sellers matched",
  "rfq.file.attached": "Requirement sheet attached",
  "quotation.created": "Quotation sent",
  "quotation.accepted": "Quotation accepted — order created",
  "quotation.rejected": "Quotation rejected by customer",
  "quotation.changes_requested": "Customer requested changes",
};

const prettySpecs = (specs: Record<string, unknown>) =>
  Object.entries(specs ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => ({ key: k, value: String(v) }));

const prettySize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ---- Quotation composer ----------------------------------------------------

interface ComposerLine {
  rfqItemId: string;
  productName: string;
  quantity: number;
  unit: string;
  /** Rupees, as typed. Converted to paise on submit; blank lines are skipped. */
  price: string;
}

function QuoteComposer({ rfq, onSent }: { rfq: AdminRfqDetail; onSent: () => void }) {
  const toast = useToast();
  const [lines, setLines] = useState<ComposerLine[]>(
    rfq.items.map((i) => ({ rfqItemId: i.id, productName: i.productName, quantity: i.quantity, unit: i.unit, price: "" })),
  );
  const [shipping, setShipping] = useState("");
  const [discount, setDiscount] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [validDays, setValidDays] = useState("15");
  const [paymentTerms, setPaymentTerms] = useState("50% advance, balance before dispatch");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);

  const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
  const priced = lines.filter((l) => l.price.trim() !== "" && Number(l.price) >= 0);
  const subtotal = priced.reduce((s, l) => s + l.quantity * toPaise(l.price), 0);
  const grand = subtotal - (Number(discount) ? toPaise(discount) : 0) + (Number(shipping) ? toPaise(shipping) : 0);

  const send = async () => {
    if (priced.length === 0) {
      toast.error("Price at least one line", "Enter a unit price for the products you are quoting.");
      return;
    }
    setSending(true);
    try {
      const validUntil = new Date(Date.now() + (Number(validDays) || 15) * 86400_000).toISOString();
      await adminRfqApi.createQuotation(rfq.id, {
        items: priced.map((l) => ({ rfqItemId: l.rfqItemId, unitPriceMinor: toPaise(l.price) })),
        shippingMinor: Number(shipping) ? toPaise(shipping) : 0,
        discountMinor: Number(discount) ? toPaise(discount) : 0,
        leadTimeDays: leadTimeDays ? Number(leadTimeDays) : undefined,
        paymentTerms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        validUntil,
        send: true,
      });
      toast.success("Quotation sent", `The customer has been notified on ${rfq.rfqNumber}.`);
      onSent();
    } catch (e) {
      toast.error("Couldn't send the quotation", describeApiError(e).message);
    } finally {
      setSending(false);
    }
  };

  const numCls =
    "w-28 rounded-lg border erp-border bg-transparent px-2.5 py-1.5 text-right text-sm erp-text focus:border-primary-500 focus:outline-none";

  return (
    <Panel title="Build quotation">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="border-b erp-border-soft text-xs erp-text-muted">
              <th className="py-2 pr-3 font-bold">Product</th>
              <th className="py-2 pr-3 font-bold">Qty</th>
              <th className="py-2 pr-3 font-bold">Unit price (₹)</th>
              <th className="py-2 font-bold text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.rfqItemId} className="border-b erp-border-soft last:border-0">
                <td className="py-2 pr-3 erp-text">{l.productName}</td>
                <td className="py-2 pr-3 erp-text-muted">
                  {l.quantity.toLocaleString("en-IN")} {l.unit}
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.price}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...l, price: e.target.value };
                      setLines(next);
                    }}
                    placeholder="0.00"
                    className={numCls}
                    aria-label={`Unit price for ${l.productName}`}
                  />
                </td>
                <td className="py-2 text-right font-semibold erp-text">
                  {l.price.trim() !== "" ? inrMinor(l.quantity * toPaise(l.price)) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Shipping (₹)", value: shipping, set: setShipping, placeholder: "0" },
          { label: "Discount (₹)", value: discount, set: setDiscount, placeholder: "0" },
          { label: "Lead time (days)", value: leadTimeDays, set: setLeadTimeDays, placeholder: "14" },
          { label: "Valid for (days)", value: validDays, set: setValidDays, placeholder: "15" },
        ].map((f) => (
          <label key={f.label} className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">{f.label}</span>
            <input
              type="number"
              min={0}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              className="w-full rounded-lg border erp-border bg-transparent px-2.5 py-1.5 text-sm erp-text focus:border-primary-500 focus:outline-none"
            />
          </label>
        ))}
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Payment terms</span>
          <input
            type="text"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            className="w-full rounded-lg border erp-border bg-transparent px-2.5 py-1.5 text-sm erp-text focus:border-primary-500 focus:outline-none"
          />
        </label>
        <label className="col-span-2 block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Notes to customer</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-lg border erp-border bg-transparent px-2.5 py-1.5 text-sm erp-text focus:border-primary-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t erp-border-soft pt-4">
        <p className="text-sm erp-text-muted">
          Subtotal <span className="font-bold erp-text">{inrMinor(subtotal)}</span>
          <span className="mx-2">·</span>
          Grand total <span className="font-bold erp-text">{inrMinor(Math.max(0, grand))}</span>
          <span className="ml-2 text-xs erp-text-faint">(totals are recomputed server-side)</span>
        </p>
        <Button variant="primary" icon={Send} onClick={send} disabled={sending}>
          {sending ? "Sending…" : "Send quotation"}
        </Button>
      </div>
    </Panel>
  );
}

// ---- Page ------------------------------------------------------------------

export default function QuotationDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [rfq, setRfq] = useState<AdminRfqDetail | null>(null);
  const [error, setError] = useState<ReturnType<typeof describeApiError> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRfq(await adminRfqApi.get(id));
    } catch (e) {
      setRfq(null);
      setError(describeApiError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Opening the queue item marks it under review (idempotent server-side).
  useEffect(() => {
    if (rfq && rfq.status === "SUBMITTED") {
      adminRfqApi.markUnderReview(rfq.id).then(() => void load()).catch(() => {/* non-fatal */});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfq?.id, rfq?.status]);

  const timeline = useMemo(
    () =>
      (rfq?.activity ?? []).map((a) => ({
        id: a.id,
        title: EVENT_LABEL[a.eventType] ?? a.eventType,
        meta: [
          a.actor,
          a.metadata?.quotationNumber ? String(a.metadata.quotationNumber) : null,
          a.metadata?.invited != null ? `${a.metadata.invited} seller(s) invited` : null,
          a.metadata?.fileName ? String(a.metadata.fileName) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        time: formatDateTime(a.createdAt),
        tone: (a.eventType.includes("accepted") ? "success" : a.eventType.includes("rejected") || a.eventType.includes("cancelled") ? "danger" : "primary") as "success" | "danger" | "primary",
      })),
    [rfq?.activity],
  );

  const download = async (fileId: string, fileName: string) => {
    if (!rfq) return;
    try {
      saveBlob(await adminRfqApi.downloadFile(rfq.id, fileId), fileName);
    } catch (e) {
      toast.error("Download failed", describeApiError(e).message);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <Panel><ListSkeleton rows={6} /></Panel>
      </div>
    );
  }

  if (error || !rfq) {
    // Honest error taxonomy — a session problem must never read as "not found".
    const kind = error?.kind ?? "notFound";
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Quotations", to: "/admin/quotes" }, { label: id }]} title="Quotation request" />
        <Panel>
          {kind === "unauthorized" ? (
            <EmptyState
              icon={LogIn}
              title="Please sign in again"
              message="Your admin session has expired. Sign back in to view this RFQ."
              action={<Button variant="primary" onClick={() => nav("/")}>Go to sign in</Button>}
            />
          ) : kind === "notFound" ? (
            <EmptyState
              icon={FileText}
              title="RFQ not found"
              message={`No quotation request matches “${id}”. It may have been removed.`}
              action={<Button variant="secondary" onClick={() => nav("/admin/quotes")}>Back to quotations</Button>}
            />
          ) : (
            <ErrorState message={error?.message ?? "Unable to load this RFQ."} onRetry={() => void load()} />
          )}
        </Panel>
      </div>
    );
  }

  const canQuote = !["ACCEPTED", "CANCELLED", "REJECTED", "EXPIRED"].includes(rfq.status);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Quotations", to: "/admin/quotes" }, { label: rfq.rfqNumber }]}
        title={
          <span className="flex items-center gap-3">
            {rfq.rfqNumber}
            <Badge tone={STATUS_TONE[rfq.status]}>{rfq.status.replace(/_/g, " ")}</Badge>
          </span>
        }
        subtitle={`Submitted ${rfq.submittedAt ? formatDateTime(rfq.submittedAt) : formatDateTime(rfq.createdAt)}`}
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => void load()}>Refresh</Button>
            {canQuote && (
              <Button
                variant="secondary"
                icon={Users}
                onClick={async () => {
                  try {
                    const r = await adminRfqApi.rematch(rfq.id);
                    toast.success("Matching re-run", `${r.invited} new seller(s) invited.`);
                    void load();
                  } catch (e) {
                    toast.error("Matching failed", describeApiError(e).message);
                  }
                }}
              >
                Re-run matching
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Customer + delivery */}
          <Panel title="Customer & delivery">
            <KeyValue
              items={[
                { label: "Customer", value: rfq.customer?.name ?? "—" },
                { label: "Email", value: rfq.customer?.email ?? "—" },
                { label: "Phone", value: rfq.customer?.phone ?? "—" },
                {
                  label: "Delivery location",
                  value: [rfq.ship.city, rfq.ship.state, rfq.ship.postalCode].filter(Boolean).join(", ") || "—",
                },
                { label: "Required by", value: rfq.requiredBy ? formatDateTime(rfq.requiredBy) : "—" },
                { label: "Customer notes", value: rfq.notes || "—" },
              ]}
            />
            {rfq.customer && (
              <Link to={`/admin/customers/${rfq.customer.id}`} className="mt-3 inline-block text-xs font-bold text-primary-600 hover:underline dark:text-primary-400">
                View customer profile →
              </Link>
            )}
          </Panel>

          {/* Product requirements */}
          <Panel title={`Product requirements (${rfq.items.length})`}>
            <div className="space-y-4">
              {rfq.items.map((item, idx) => {
                const specs = prettySpecs(item.specs as Record<string, unknown>);
                return (
                  <div key={item.id} className="rounded-lg border erp-border-soft p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold erp-text">
                        {idx + 1}. {item.productName}
                        {item.sku && <span className="ml-2 text-xs font-normal erp-text-faint">SKU {item.sku}</span>}
                      </p>
                      <p className="text-sm font-semibold erp-text">
                        {item.quantity.toLocaleString("en-IN")} {item.unit}
                      </p>
                    </div>
                    {specs.length > 0 && (
                      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                        {specs.map((s) => (
                          <div key={s.key}>
                            <dt className="font-medium capitalize erp-text-faint">{s.key}</dt>
                            <dd className="erp-text">{s.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {item.notes && <p className="mt-2 text-xs erp-text-muted">Note: {item.notes}</p>}
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Files */}
          <Panel title="Requirement files">
            {rfq.files.length === 0 ? (
              <EmptyState icon={Paperclip} message="No requirement sheet was attached to this request." />
            ) : (
              <ul className="space-y-2">
                {rfq.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-lg border erp-border-soft px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-primary-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate erp-text">{f.fileName}</span>
                    <span className="shrink-0 text-xs erp-text-faint">{prettySize(f.size)}</span>
                    <Button variant="secondary" size="sm" icon={Download} onClick={() => void download(f.id, f.fileName)}>
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Quotations already on this RFQ */}
          <Panel title={`Quotations (${rfq.quotations.length})`}>
            {rfq.quotations.length === 0 ? (
              <EmptyState icon={FileText} message="No quotation has been sent yet — build one below or wait for matched sellers." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b erp-border-soft text-xs erp-text-muted">
                      <th className="py-2 pr-3 font-bold">Quotation</th>
                      <th className="py-2 pr-3 font-bold">Seller</th>
                      <th className="py-2 pr-3 font-bold">Total</th>
                      <th className="py-2 pr-3 font-bold">Lead time</th>
                      <th className="py-2 pr-3 font-bold">Valid until</th>
                      <th className="py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfq.quotations.map((q) => (
                      <tr key={q.id} className="border-b erp-border-soft align-top last:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="font-semibold erp-text">{q.quotationNumber}</span>
                          {q.version > 1 && <span className="ml-1 text-xs erp-text-faint">v{q.version}</span>}
                          <div className="mt-1 space-y-0.5 text-xs erp-text-muted">
                            {q.items.map((i) => (
                              <p key={i.id}>
                                {i.productName} × {i.quantity.toLocaleString("en-IN")} @ {inrMinor(i.unitPriceMinor)}
                              </p>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 erp-text-muted">{q.seller?.name ?? "House (Zolo)"}</td>
                        <td className="py-2.5 pr-3 font-bold erp-text">{inrMinor(q.grandTotalMinor)}</td>
                        <td className="py-2.5 pr-3 erp-text-muted">{q.leadTimeDays != null ? `${q.leadTimeDays}d` : "—"}</td>
                        <td className="py-2.5 pr-3 erp-text-muted">
                          {q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}
                        </td>
                        <td className="py-2.5">
                          <Badge tone={QUOTE_TONE[q.status] ?? "neutral"}>{q.status.replace(/_/g, " ")}</Badge>
                          {q.buyerMessage && <p className="mt-1 max-w-40 text-xs erp-text-muted">“{q.buyerMessage}”</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Composer */}
          {canQuote && <QuoteComposer rfq={rfq} onSent={() => void load()} />}
        </div>

        <div className="space-y-4">
          {/* Matched sellers */}
          <Panel title={`Matched sellers (${rfq.matches.length})`}>
            {rfq.matches.length === 0 ? (
              <EmptyState icon={Users} message="No sellers matched yet. Approve suppliers with this capability, or re-run matching." />
            ) : (
              <ul className="space-y-2.5">
                {rfq.matches.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 rounded-lg border erp-border-soft p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold erp-text">{m.supplier?.name ?? m.supplierId}</p>
                      <p className="mt-0.5 text-xs erp-text-faint">
                        Score {m.score}
                        {m.reasons.length > 0 && ` · ${m.reasons.join(", ")}`}
                      </p>
                    </div>
                    <Badge tone={MATCH_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Activity */}
          <Panel title="Activity">
            {timeline.length === 0 ? (
              <EmptyState message="No activity recorded yet." />
            ) : (
              <Timeline entries={timeline} />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
