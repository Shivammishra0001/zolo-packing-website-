// Buyer: payment requests sent to me — GET /me/payment-requests, scoped
// server-side to the signed-in customer. Each open request links to its secure
// /pay/:token page; status reflects the admin's verification, never a guess.
import { Link } from "react-router-dom";
import { Link2, QrCode } from "lucide-react";
import { Badge, PageHeader } from "@/admin/components/ui";
import { Panel, EmptyState } from "@/admin/components/Panel";
import { inrMinor, formatDateTime } from "@/admin/format";
import { paymentRequestsApi, PAYMENT_METHOD_LABEL, REQUEST_STATUS_TONE, type PaymentRequest } from "@/lib/api/settings";
import { useBuyerQuery } from "@/buyer/use-buyer-query";

const STATUS_TEXT: Record<PaymentRequest["status"], string> = {
  PENDING: "Awaiting payment",
  SENT: "Awaiting payment",
  SUBMITTED: "Under verification",
  PAID: "Paid",
  REJECTED: "Needs resubmission",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const toPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

export default function PaymentRequests() {
  const q = useBuyerQuery(() => paymentRequestsApi.mine(), []);
  const open = q.status === "success" ? q.data.requests.filter((r) => r.status === "SENT" || r.status === "PENDING") : [];

  return (
    <div>
      <PageHeader title="Payment requests" subtitle="Payments Zolo Packaging has asked you to make, with secure links to pay and share your reference." />

      <Panel bodyClassName="p-0">
        {q.status === "loading" ? (
          <div className="p-8 text-center text-sm erp-text-muted">Loading payment requests…</div>
        ) : q.status === "error" ? (
          <EmptyState icon={Link2} title="Unable to load payment requests" message={q.error} action={<button type="button" onClick={q.retry} className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600">Try again</button>} />
        ) : q.data.requests.length === 0 ? (
          <EmptyState icon={QrCode} title="No payment requests" message="When we send you a payment link (for an order, quotation or advance) it appears here." />
        ) : (
          <ul className="divide-y erp-border-soft">
            {q.data.requests.map((r) => {
              const actionable = (r.status === "SENT" || r.status === "PENDING") && r.payUrl;
              return (
                <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold erp-text">{r.requestNumber}</span>
                      <Badge tone={REQUEST_STATUS_TONE[r.status]}>{STATUS_TEXT[r.status]}</Badge>
                    </p>
                    <p className="mt-0.5 text-sm erp-text">{r.title}</p>
                    <p className="text-xs erp-text-muted">
                      {r.order && <>Order <Link to={`/account/orders/${r.order.id}`} className="font-mono font-semibold text-primary-600">{r.order.orderNumber}</Link> · </>}
                      {r.sentAt ? `Sent ${formatDateTime(r.sentAt)}` : `Created ${formatDateTime(r.createdAt)}`}
                      {r.expiresAt && r.status !== "PAID" && <> · Pay by {formatDateTime(r.expiresAt)}</>}
                      {r.proof?.reference && <> · Ref <span className="font-mono">{r.proof.reference}</span> ({PAYMENT_METHOD_LABEL[r.proof.method ?? ""] ?? r.proof.method})</>}
                    </p>
                    {r.reviewNote && r.status === "SENT" && <p className="mt-1 text-xs text-red-600">Previous submission not verified: {r.reviewNote}</p>}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <span className="text-lg font-extrabold tabular-nums erp-text">{inrMinor(r.amountMinor)}</span>
                    {actionable ? (
                      <a href={toPath(r.payUrl!)} className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-bold text-white hover:bg-primary-600">Pay now</a>
                    ) : r.payUrl && r.status === "SUBMITTED" ? (
                      <a href={toPath(r.payUrl)} className="rounded-lg border erp-border px-4 py-2 text-sm font-semibold erp-text hover:erp-surface-2">View</a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {open.length > 0 && <p className="mt-3 text-xs erp-text-faint">{open.length} request{open.length === 1 ? "" : "s"} awaiting payment.</p>}
    </div>
  );
}
