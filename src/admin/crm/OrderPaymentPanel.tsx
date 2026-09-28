import { useState } from "react";
import { BellRing, Plus } from "lucide-react";
import { Badge, Button, Select } from "../components/ui";
import { Panel } from "../components/Panel";
import { useToast } from "@/components/ui/Toast";
import { formatDate, inrMinor } from "../format";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import { friendlyError, kindLabel, methodLabel, paymentLabel, paymentTone } from "./money";
import { adminCrmApi, type DispatchResult, type NotificationTemplate } from "@/lib/api/admin-crm";

// ============================================================
// Order → payment ledger + balance (§23, §14, §26).
//
// This is what the order detail page was missing: it showed `paidMinor` with
// no balance and only `payments[0]`, so an order with three instalments looked
// like it had one. Here every transaction is listed, the balance is explicit,
// and "Record payment" is one click from the order.
//
// Balance is displayed as (total − paid) using the SERVER's paid figure. The
// client never re-derives what has been paid from the rows it happens to have.
// ============================================================

interface LedgerPayment {
  /** `paymentNumber` is unique and always present; `id` is only returned by
      the CRM endpoints, so the list keys on the number instead. */
  id?: string;
  paymentNumber: string;
  amountMinor: number;
  method: string;
  status: string;
  kind?: string;
  reference?: string | null;
  notes?: string | null;
  paidAt?: string | null;
  createdAt?: string;
}

const TEMPLATES: { value: NotificationTemplate; label: string }[] = [
  { value: "PAYMENT_DUE", label: "Payment reminder" },
  { value: "PAYMENT_OVERDUE", label: "Overdue notice" },
  { value: "PAYMENT_RECEIVED", label: "Payment receipt" },
  { value: "ORDER_CREATED", label: "Order confirmation" },
];

export function OrderPaymentPanel({
  order,
  onChanged,
}: {
  order: {
    id: string;
    orderNumber: string;
    grandTotalMinor: number;
    paidMinor: number;
    paymentStatus: string;
    paymentMethod?: string;
    dueDate?: string | null;
    payments: LedgerPayment[];
  };
  /** Called after a payment lands so the parent can refetch the order. */
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [template, setTemplate] = useState<NotificationTemplate>("PAYMENT_DUE");
  const [sending, setSending] = useState(false);

  const pendingMinor = Math.max(0, order.grandTotalMinor - order.paidMinor);
  const overdue = pendingMinor > 0 && Boolean(order.dueDate) && new Date(order.dueDate!) < new Date();

  async function sendReminder() {
    setSending(true);
    try {
      const res = await adminCrmApi.notify(order.id, template);
      describeDispatch(res.result, toast);
    } catch (err) {
      toast.error("Could not send", friendlyError(err, "The message could not be sent."));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Panel
        title="Payments"
        action={
          <Button size="sm" icon={Plus} onClick={() => setPayOpen(true)} disabled={pendingMinor === 0}>
            Record payment
          </Button>
        }
      >
        <div className="p-4">
          {/* Balance — the figure the old page never showed. */}
          <dl className="mb-4 grid grid-cols-3 gap-3 rounded-lg erp-surface-2 p-3 text-sm">
            <Figure label="Order total" value={inrMinor(order.grandTotalMinor)} />
            <Figure label="Paid" value={inrMinor(order.paidMinor)} />
            <Figure
              label="Balance"
              value={inrMinor(pendingMinor)}
              tone={pendingMinor === 0 ? "success" : overdue ? "danger" : "warn"}
            />
          </dl>

          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={paymentTone(overdue ? "OVERDUE" : order.paymentStatus)}>
              {paymentLabel(overdue ? "OVERDUE" : order.paymentStatus)}
            </Badge>
            {order.dueDate && (
              <span className={overdue ? "font-semibold text-red-600 dark:text-red-400" : "erp-text-muted"}>
                Due {formatDate(order.dueDate)}
              </span>
            )}
            {order.paymentMethod && <span className="erp-text-muted">· {methodLabel(order.paymentMethod)}</span>}
          </div>

          {/* The full ledger — every instalment, not just the first (§14). */}
          {order.payments.length === 0 ? (
            <p className="rounded-lg border border-dashed erp-border px-3 py-6 text-center text-sm erp-text-muted">
              No payments recorded yet.
            </p>
          ) : (
            <ul className="divide-y erp-border">
              {order.payments.map((p) => (
                <li key={p.paymentNumber} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs erp-text">{p.paymentNumber}</span>
                      <Badge tone={paymentTone(p.status)}>{paymentLabel(p.status)}</Badge>
                      {p.kind && <span className="text-[11px] font-semibold uppercase tracking-wide erp-text-faint">{kindLabel(p.kind)}</span>}
                    </div>
                    <div className="mt-0.5 text-xs erp-text-muted">
                      {methodLabel(p.method)}
                      {p.reference && <> · <span className="font-mono">{p.reference}</span></>}
                      {(p.paidAt || p.createdAt) && <> · {formatDate((p.paidAt ?? p.createdAt)!)}</>}
                    </div>
                    {p.notes && <div className="mt-0.5 text-xs erp-text-muted">{p.notes}</div>}
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums erp-text">{inrMinor(p.amountMinor)}</div>
                </li>
              ))}
            </ul>
          )}

          {/* Reminders (§26). Delivery status is reported honestly. */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t erp-border pt-4">
            <Select value={template} onChange={(v) => setTemplate(v as NotificationTemplate)} aria-label="Message template">
              {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <Button size="sm" variant="secondary" onClick={sendReminder} disabled={sending} loading={sending} icon={BellRing}>
              {sending ? "Sending…" : "Send to customer"}
            </Button>
          </div>
        </div>
      </Panel>

      <RecordPaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        order={order}
        onRecorded={() => onChanged?.()}
      />
    </>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "success" | "warn" | "danger" }) {
  const toneClass =
    tone === "success" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "danger" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : "erp-text";
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide erp-text-faint">{label}</dt>
      <dd className={`mt-0.5 text-base font-bold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

/**
 * Turn a dispatch result into an honest toast.
 *
 * A SKIPPED channel is NOT a success: if WhatsApp is unconfigured the admin
 * must be told the message did not go out, never shown a green "Sent" (§28).
 */
function describeDispatch(result: DispatchResult, toast: ReturnType<typeof useToast>) {
  const channels = (["email", "whatsapp"] as const)
    .map((c) => ({ channel: c, outcome: result[c] }))
    .filter((c) => c.outcome);

  const sent = channels.filter((c) => c.outcome!.status === "SENT").map((c) => c.channel);
  const skipped = channels.filter((c) => c.outcome!.status === "SKIPPED");
  const failed = channels.filter((c) => c.outcome!.status === "FAILED");

  if (sent.length > 0) {
    const extra = [...skipped, ...failed].map((c) => `${c.channel}: ${c.outcome!.error ?? c.outcome!.status.toLowerCase()}`);
    toast.success(`Sent by ${sent.join(" and ")}`, extra.length ? extra.join(" · ") : undefined);
    return;
  }
  if (failed.length > 0) {
    toast.error("Message failed", failed.map((c) => `${c.channel}: ${c.outcome!.error ?? "failed"}`).join(" · "));
    return;
  }
  if (skipped.length > 0) {
    // The common case: a channel is switched off or the provider has no
    // credentials. Say so plainly and point at the fix.
    toast.error("Nothing was sent", `${skipped.map((c) => `${c.channel}: ${c.outcome!.error ?? "skipped"}`).join(" · ")}. Check Settings → Notifications.`);
    return;
  }
  toast.error("Nothing was sent", "No delivery channel is configured for this message.");
}
