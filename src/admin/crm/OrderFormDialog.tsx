import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Dialog, Select } from "../components/ui";
import { useToast } from "@/components/ui/Toast";
import { inrMinor } from "../format";
import {
  adminCrmApi,
  ORDER_SOURCES,
  PAYMENT_METHODS,
  type OrderItemInput,
  type OrderSource,
  type PaymentMethod,
} from "@/lib/api/admin-crm";
import { friendlyError, lineTotalMinor, rupeesToMinor } from "./money";

// ============================================================
// Create order (§9–13).
//
// The customer is chosen BEFORE this opens and shown read-only, so an admin
// never retypes name/email/phone for a repeat order (§9).
//
// Lines can be a catalog product OR a free-text custom packaging item (§12),
// because a packaging business quotes jobs that do not exist in the catalog.
// Prices are editable on every line: B2B pricing is negotiated, and the
// catalog price is only a starting point.
//
// Totals are computed live for CONFIRMATION, then recomputed server-side on
// save — the response is what we trust. The advance is posted as a real
// Payment row by the same request, never as a "paid" field (§13/§14).
// ============================================================

interface DraftLine {
  key: string;
  productId: string | null;
  name: string;
  sku: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  tax: string;
}

const newLine = (): DraftLine => ({
  key: Math.random().toString(36).slice(2),
  productId: null,
  name: "",
  sku: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  discount: "",
  tax: "",
});

export interface OrderCustomer {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
}

export function OrderFormDialog({
  open,
  onClose,
  customer,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  customer: OrderCustomer;
  onCreated?: (orderId: string, orderNumber: string) => void;
}) {
  const toast = useToast();
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [source, setSource] = useState<OrderSource>("admin");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [orderDiscount, setOrderDiscount] = useState("");
  const [orderTax, setOrderTax] = useState("");
  const [shipping, setShipping] = useState("");
  const [advance, setAdvance] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<PaymentMethod>("cash");
  const [advanceReference, setAdvanceReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLines([newLine()]);
    setSource("admin");
    setNotes("");
    setDueDate("");
    setExpectedDelivery("");
    setOrderDiscount("");
    setOrderTax("");
    setShipping("");
    setAdvance("");
    setAdvanceMethod("cash");
    setAdvanceReference("");
    setError(null);
  }, [open, customer.id]);

  const patch = (key: string, field: keyof DraftLine, value: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  // Live preview only. The server recomputes all of this on save.
  const totals = useMemo(() => {
    let subtotal = 0;
    let itemDiscount = 0;
    let itemTax = 0;
    for (const l of lines) {
      const qty = Number(l.quantity) || 0;
      const unit = rupeesToMinor(l.unitPrice) ?? 0;
      const disc = rupeesToMinor(l.discount) ?? 0;
      const tax = rupeesToMinor(l.tax) ?? 0;
      subtotal += unit * qty;
      itemDiscount += disc;
      itemTax += tax;
    }
    const oDisc = rupeesToMinor(orderDiscount) ?? 0;
    const oTax = rupeesToMinor(orderTax) ?? 0;
    const ship = rupeesToMinor(shipping) ?? 0;
    const discount = itemDiscount + oDisc;
    const tax = itemTax + oTax;
    const grand = Math.max(0, subtotal - discount) + tax + ship;
    const adv = rupeesToMinor(advance) ?? 0;
    return { subtotal, discount, tax, shipping: ship, grand, advance: adv, pending: Math.max(0, grand - adv) };
  }, [lines, orderDiscount, orderTax, shipping, advance]);

  const advanceExceeds = totals.advance > totals.grand;
  const validLines = lines.filter((l) => l.name.trim() && (Number(l.quantity) || 0) > 0 && rupeesToMinor(l.unitPrice) !== null);
  const canSubmit = validLines.length > 0 && totals.grand > 0 && !advanceExceeds && !saving;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const items: OrderItemInput[] = validLines.map((l) => ({
        productId: l.productId ?? undefined,
        itemName: l.name.trim(),
        sku: l.sku.trim() || undefined,
        description: l.description.trim() || undefined,
        quantity: Number(l.quantity),
        unitPriceMinor: rupeesToMinor(l.unitPrice) ?? 0,
        discountMinor: rupeesToMinor(l.discount) ?? undefined,
        taxMinor: rupeesToMinor(l.tax) ?? undefined,
      }));

      const res = await adminCrmApi.createOrder({
        customerId: customer.id,
        items,
        source,
        notes: notes.trim() || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        expectedDeliveryDate: expectedDelivery ? new Date(expectedDelivery).toISOString() : undefined,
        discountMinor: rupeesToMinor(orderDiscount) ?? undefined,
        taxMinor: rupeesToMinor(orderTax) ?? undefined,
        shippingMinor: rupeesToMinor(shipping) ?? undefined,
        advanceMinor: totals.advance > 0 ? totals.advance : undefined,
        advanceMethod: totals.advance > 0 ? advanceMethod : undefined,
        advanceReference: advanceReference.trim() || undefined,
      });

      const order = res.order;
      toast.success(
        "Order created",
        `${order.orderNumber} — ${inrMinor(order.grandTotalMinor)}${order.paidMinor > 0 ? `, ${inrMinor(order.paidMinor)} received` : ""}`,
      );
      onCreated?.(order.id, order.orderNumber);
      onClose();
    } catch (err) {
      setError(friendlyError(err, "Unable to create the order. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border erp-border erp-surface px-2.5 py-1.5 text-sm erp-text outline-none focus:border-primary-500";
  const label = "mb-1 block text-xs font-semibold erp-text-muted";

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      size="lg"
      title="Create order"
      description={customer.company || customer.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} loading={saving}>
            {saving ? "Creating…" : "Create order"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Customer — read-only (§10 section 1). */}
        <section className="rounded-lg erp-surface-2 p-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Fact label="Customer" value={customer.name} />
            <Fact label="Company" value={customer.company || "—"} />
            <Fact label="Email" value={customer.email} />
            <Fact label="Phone" value={customer.phone || "—"} />
          </div>
        </section>

        {/* Order information (§10 section 2). */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={label} htmlFor="o-source">Order source</label>
            <Select id="o-source" value={source} onChange={(v) => setSource(v as OrderSource)}>
              {ORDER_SOURCES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className={label} htmlFor="o-due">Payment due date</label>
            <input id="o-due" type="date" className={field} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={label} htmlFor="o-delivery">Expected delivery</label>
            <input id="o-delivery" type="date" className={field} value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
          </div>
        </section>

        {/* Line items (§11, §12). */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide erp-text-faint">Items</h3>
            <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, newLine()])} icon={Plus}>
              Add item
            </Button>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => {
              const qty = Number(l.quantity) || 0;
              const unit = rupeesToMinor(l.unitPrice) ?? 0;
              const total = lineTotalMinor(unit, qty, rupeesToMinor(l.discount) ?? 0, rupeesToMinor(l.tax) ?? 0);
              return (
                <div key={l.key} className="rounded-lg border erp-border p-2.5">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-12 sm:col-span-5">
                      <label className={label} htmlFor={`l-name-${l.key}`}>Item {i + 1} *</label>
                      <input
                        id={`l-name-${l.key}`}
                        className={field}
                        value={l.name}
                        onChange={(e) => patch(l.key, "name", e.target.value)}
                        placeholder="e.g. 5 Ply Corrugated Box 12x10x8"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className={label} htmlFor={`l-qty-${l.key}`}>Qty *</label>
                      <input id={`l-qty-${l.key}`} inputMode="numeric" className={field} value={l.quantity} onChange={(e) => patch(l.key, "quantity", e.target.value)} />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className={label} htmlFor={`l-price-${l.key}`}>Unit ₹ *</label>
                      <input id={`l-price-${l.key}`} inputMode="decimal" className={field} value={l.unitPrice} onChange={(e) => patch(l.key, "unitPrice", e.target.value)} />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className={label}>Line total</label>
                      <div className="px-2.5 py-1.5 text-sm font-bold tabular-nums erp-text">{inrMinor(total)}</div>
                    </div>
                    <div className="col-span-12 flex items-end justify-end sm:col-span-1">
                      <button
                        type="button"
                        onClick={() => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((x) => x.key !== l.key)))}
                        className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        aria-label={`Remove item ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>

                    <div className="col-span-6 sm:col-span-3">
                      <label className={label} htmlFor={`l-sku-${l.key}`}>SKU</label>
                      <input id={`l-sku-${l.key}`} className={field} value={l.sku} onChange={(e) => patch(l.key, "sku", e.target.value)} />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <label className={label} htmlFor={`l-disc-${l.key}`}>Discount ₹</label>
                      <input id={`l-disc-${l.key}`} inputMode="decimal" className={field} value={l.discount} onChange={(e) => patch(l.key, "discount", e.target.value)} />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <label className={label} htmlFor={`l-tax-${l.key}`}>Tax ₹</label>
                      <input id={`l-tax-${l.key}`} inputMode="decimal" className={field} value={l.tax} onChange={(e) => patch(l.key, "tax", e.target.value)} />
                    </div>
                    <div className="col-span-12 sm:col-span-5">
                      <label className={label} htmlFor={`l-desc-${l.key}`}>Description / spec</label>
                      <input id={`l-desc-${l.key}`} className={field} value={l.description} onChange={(e) => patch(l.key, "description", e.target.value)} placeholder="e.g. 2-colour brand print" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Money (§11 totals + §13 advance). */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide erp-text-faint">Order charges</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={label} htmlFor="o-disc">Discount ₹</label>
                <input id="o-disc" inputMode="decimal" className={field} value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="o-tax">Tax ₹</label>
                <input id="o-tax" inputMode="decimal" className={field} value={orderTax} onChange={(e) => setOrderTax(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="o-ship">Shipping ₹</label>
                <input id="o-ship" inputMode="decimal" className={field} value={shipping} onChange={(e) => setShipping(e.target.value)} />
              </div>
            </div>

            <h3 className="pt-2 text-xs font-bold uppercase tracking-wide erp-text-faint">Advance received</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={label} htmlFor="o-adv">Amount ₹</label>
                <input id="o-adv" inputMode="decimal" className={field} value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="o-advm">Method</label>
                <Select id="o-advm" value={advanceMethod} onChange={(v) => setAdvanceMethod(v as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </div>
              <div>
                <label className={label} htmlFor="o-advr">Reference</label>
                <input id="o-advr" className={field} value={advanceReference} onChange={(e) => setAdvanceReference(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Running totals — the admin never adds these up (§47). */}
          <dl className="self-start rounded-lg erp-surface-2 p-3 text-sm">
            <Row label="Subtotal" value={inrMinor(totals.subtotal)} />
            {totals.discount > 0 && <Row label="Discount" value={`− ${inrMinor(totals.discount)}`} />}
            {totals.tax > 0 && <Row label="Tax" value={inrMinor(totals.tax)} />}
            {totals.shipping > 0 && <Row label="Shipping" value={inrMinor(totals.shipping)} />}
            <div className="my-2 border-t erp-border" />
            <Row label="Order total" value={inrMinor(totals.grand)} strong />
            {totals.advance > 0 && (
              <>
                <Row label="Advance" value={`− ${inrMinor(totals.advance)}`} />
                <Row label="Pending" value={inrMinor(totals.pending)} strong tone={totals.pending === 0 ? "success" : undefined} />
              </>
            )}
          </dl>
        </section>

        <div>
          <label className={label} htmlFor="o-notes">Notes</label>
          <textarea id="o-notes" className={`${field} min-h-16 resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {advanceExceeds && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            The advance is more than the order total.
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide erp-text-faint">{label}</div>
      <div className="truncate text-sm font-medium erp-text">{value}</div>
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "success" }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <dt className="erp-text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : "font-medium"} ${tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "erp-text"}`}>{value}</dd>
    </div>
  );
}
