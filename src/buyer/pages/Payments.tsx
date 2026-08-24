// Buyer payment history — GET /me/payments, scoped server-side to the
// signed-in buyer. Amounts are integer paise from the API and are formatted
// with inrMinor; refunds are shown against the payment they belong to.
import { Link } from "react-router-dom";
import { CreditCard, IndianRupee, Wallet } from "lucide-react";
import { Badge, PageHeader } from "@/admin/components/ui";
import { Panel, EmptyState } from "@/admin/components/Panel";
import { MetricCard, MetricCardSkeleton } from "@/admin/components/MetricCard";
import { inrMinor, formatDate } from "@/admin/format";
import { paymentTone, prettyStatus } from "@/lib/order-status";
import { buyerApi } from "@/lib/api/commerce";
import { useBuyerQuery } from "@/buyer/use-buyer-query";

const METHOD_LABEL: Record<string, string> = {
  cod: "Cash on delivery",
  neft: "NEFT",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  card: "Card",
  cash: "Cash",
};

export default function Payments() {
  const q = useBuyerQuery(() => buyerApi.payments(100), []);

  return (
    <div>
      <PageHeader title="Payments" subtitle="Every payment and refund on your account." />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {q.status === "loading" ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : q.status === "success" ? (
          <>
            <MetricCard label="Paid" value={inrMinor(q.data.summary.paidMinor)} icon={IndianRupee} detail="settled" to="#" />
            <MetricCard label="Outstanding" value={inrMinor(q.data.summary.outstandingMinor)} icon={Wallet} tone={q.data.summary.outstandingMinor > 0 ? "warn" : "default"} detail="awaiting payment" to="#" />
            <MetricCard label="Pending" value={inrMinor(q.data.summary.pendingMinor)} icon={CreditCard} detail="not yet captured" to="#" />
            <MetricCard label="Refunded" value={inrMinor(q.data.summary.refundedMinor)} icon={IndianRupee} detail="returned to you" to="#" />
          </>
        ) : null}
      </div>

      <Panel bodyClassName="p-0">
        {q.status === "loading" ? (
          <div className="p-8 text-center text-sm erp-text-muted">Loading payments…</div>
        ) : q.status === "error" ? (
          <EmptyState
            icon={CreditCard}
            title="Unable to load payments"
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
        ) : q.data.payments.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No payments yet"
            message="Payments appear here once you place an order."
            action={
              <Link to="/shop" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600">
                Browse products
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Your payment history</caption>
              <thead>
                <tr className="border-b erp-border-soft text-left text-xs font-semibold uppercase tracking-wider erp-text-muted">
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Method</th>
                  <th className="hidden px-4 py-3 md:table-cell">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {q.data.payments.map((p) => (
                  <tr key={p.id} className="border-b erp-border-soft last:border-0">
                    <td className="px-4 py-3 font-mono font-semibold erp-text">{p.paymentNumber}</td>
                    <td className="px-4 py-3">
                      {p.orderId ? (
                        <Link to={`/account/orders/${p.orderId}`} className="font-mono text-primary-600 hover:underline">
                          {p.orderNumber}
                        </Link>
                      ) : (
                        <span className="erp-text-faint">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 erp-text-muted sm:table-cell">
                      {p.method ? METHOD_LABEL[p.method] ?? p.method.toUpperCase() : "—"}
                    </td>
                    <td className="hidden px-4 py-3 erp-text-muted md:table-cell">{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={paymentTone(p.status)}>{prettyStatus(p.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums erp-text">{inrMinor(p.amountMinor)}</span>
                      {p.refundedMinor > 0 && (
                        <span className="block text-xs tabular-nums text-rose-500">−{inrMinor(p.refundedMinor)} refunded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
