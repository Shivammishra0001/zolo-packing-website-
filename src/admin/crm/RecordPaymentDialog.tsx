import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Select } from "../components/ui";
import { useToast } from "@/components/ui/Toast";
import { inrMinor } from "../format";
import {
  adminCrmApi,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  type PaymentKind,
  type PaymentMethod,
  type PaymentTotals,
} from "@/lib/api/admin-crm";
import { friendlyError, minorToRupeeInput, rupeesToMinor } from "./money";

// ============================================================
// Record Payment (§46).
//
// The live maths panel is the point of this dialog: an admin should never have
// to work out what is left. Order total / previously paid / this payment /
// remaining update as they type.
//
// IMPORTANT: the "remaining" shown while typing is a PREVIEW only. The
// authoritative figures come back from the server in `totals` after the write,
// because only the server sees the full Payment + Refund ledger. The preview
// exists to prevent mistakes, not to be the source of truth.
// ============================================================

export function RecordPaymentDialog({
  open,
  onClose,
  order,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  order: { id: string; orderNumber: string; grandTotalMinor: number; paidMinor: number };
  /** Receives the server's restated totals so the caller can refresh. */
  onRecorded?: (totals: PaymentTotals) => void;
}) {
  const toast = useToast();
  const outstandingMinor = Math.max(0, order.grandTotalMinor - order.paidMinor);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [kind, setKind] = useState<PaymentKind>("PARTIAL");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on each open so a previous entry never leaks into the next payment.
  useEffect(() => {
    if (!open) return;
    setAmount(minorToRupeeInput(outstandingMinor));
    setMethod("cash");
    // An order with nothing paid yet is almost always taking its advance;
    // one that is part-paid is usually being settled.
    setKind(order.paidMinor === 0 ? "ADVANCE" : outstandingMinor > 0 ? "PARTIAL" : "ADJUSTMENT");
    setReference("");
    setNotes("");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setError(null);
  }, [open, order.id, order.paidMinor, outstandingMinor]);

  const thisPaymentMinor = rupeesToMinor(amount);
  const preview = useMemo(() => {
    const amt = thisPaymentMinor ?? 0;
    return {
      remainingMinor: outstandingMinor - amt,
      exceeds: amt > outstandingMinor,
    };
  }, [thisPaymentMinor, outstandingMinor]);

  const canSubmit = thisPaymentMinor !== null && thisPaymentMinor > 0 && !preview.exceeds && !saving;

  async function submit() {
    if (thisPaymentMinor === null || thisPaymentMinor <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await adminCrmApi.addPayment(order.id, {
        amountMinor: thisPaymentMinor,
        method,
        kind,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
      });
      toast.success(
        "Payment recorded",
        `${inrMinor(thisPaymentMinor)} against ${order.orderNumber} — ${inrMinor(res.totals.pendingMinor)} still due`,
      );
      onRecorded?.(res.totals);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Payment could not be recorded."));
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border erp-border erp-surface px-3 py-2 text-sm erp-text outline-none focus:border-primary-500";
  const label = "mb-1 block text-xs font-semibold erp-text-muted";

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Record payment"
      description={`Order ${order.orderNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} loading={saving}>
            {saving ? "Recording…" : "Record payment"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Live maths — the admin never calculates a balance by hand (§47). */}
        <dl className="rounded-lg erp-surface-2 p-3 text-sm">
          <Row label="Order total" value={inrMinor(order.grandTotalMinor)} />
          <Row label="Previously paid" value={inrMinor(order.paidMinor)} />
          <Row
            label="This payment"
            value={thisPaymentMinor ? inrMinor(thisPaymentMinor) : "—"}
            strong
          />
          <div className="my-2 border-t erp-border" />
          <Row
            label="Remaining"
            value={inrMinor(Math.max(0, preview.remainingMinor))}
            strong
            tone={preview.exceeds ? "danger" : preview.remainingMinor === 0 ? "success" : undefined}
          />
        </dl>

        {preview.exceeds && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            That is {inrMinor(-preview.remainingMinor)} more than the outstanding balance of {inrMinor(outstandingMinor)}.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="pay-amount">Amount (₹) *</label>
            <input
              id="pay-amount"
              className={field}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </div>
          <div>
            <label className={label} htmlFor="pay-date">Payment date *</label>
            <input id="pay-date" type="date" className={field} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="pay-method">Method *</label>
            <Select id="pay-method" value={method} onChange={(v) => setMethod(v as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </div>
          <div>
            <label className={label} htmlFor="pay-kind">Type</label>
            <Select id="pay-kind" value={kind} onChange={(v) => setKind(v as PaymentKind)}>
              {PAYMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="pay-ref">
            Transaction reference {(method === "upi" || method === "bank_transfer" || method === "card" || method === "cheque") && <span className="font-normal">(recommended)</span>}
          </label>
          <input
            id="pay-ref"
            className={field}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === "cheque" ? "Cheque number" : method === "upi" ? "UPI transaction id" : "UTR / reference"}
          />
        </div>

        <div>
          <label className={label} htmlFor="pay-notes">Notes</label>
          <textarea id="pay-notes" className={`${field} min-h-16 resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "danger" | "success" }) {
  const toneClass = tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "erp-text";
  return (
    <div className="flex items-center justify-between py-0.5">
      <dt className="erp-text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : "font-medium"} ${toneClass}`}>{value}</dd>
    </div>
  );
}
