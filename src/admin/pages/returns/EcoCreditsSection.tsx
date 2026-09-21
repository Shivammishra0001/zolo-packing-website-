import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Coins, Gift, Hourglass, ListChecks, MinusCircle, PlusCircle, ShieldCheck, SlidersHorizontal, TimerOff, Undo2 } from "lucide-react";
import {
  adminEcoCreditsApi, ECO_CREDIT_TYPE_LABEL, fmtQty, type AdminEcoTransaction, type EcoCreditType, type EcoDashboard,
} from "@/lib/api/recycling";
import { describeApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Badge, Button, Dialog, Select } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { formatDateTime, inrMinor } from "../../format";
import { AREA, errorsFrom, Field, FIELD, FIELD_ERR, SummaryCards, type FormErrors } from "../marketing/shared";

// Eco Credits — the ledger. Every balance change is a row here (rewards,
// redemptions, manual adjustments, reversals, expirations); nothing on this page
// edits a balance directly. A correction is a NEW row with a reason.

const TYPE_TONE: Record<EcoCreditType, "success" | "primary" | "info" | "warning" | "danger" | "neutral"> = {
  RECYCLING_REWARD: "success", REDEMPTION: "primary", MANUAL_CREDIT: "info", MANUAL_DEBIT: "warning", REVERSAL: "neutral", EXPIRATION: "danger",
};

function AdjustmentDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ id: string; name: string; email: string; balance: number }[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string; email: string; balance: number } | null>(null);
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setQ(""); setMatches([]); setCustomer(null); setDirection("credit"); setAmount(""); setReason(""); setNote(""); setErrors({}); } }, [open]);
  useEffect(() => {
    if (customer || q.trim().length < 2) { setMatches([]); return; }
    let alive = true;
    const t = setTimeout(() => adminEcoCreditsApi.searchCustomers(q.trim()).then((d) => alive && setMatches(d.customers)).catch(() => alive && setMatches([])), 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, customer]);

  const save = async () => {
    const e: FormErrors = {};
    if (!customer) e.userId = "Choose the customer.";
    if (!/^\d+$/.test(amount.trim()) || Number(amount) < 1) e.amount = "Enter a whole number of 1 or more.";
    else if (direction === "debit" && customer && Number(amount) > customer.balance) e.amount = `The customer only has ${customer.balance.toLocaleString("en-IN")} Eco Credits.`;
    if (reason.trim().length < 3) e.reason = "A reason is required.";
    setErrors(e);
    if (Object.keys(e).length || !customer) return;
    setSaving(true);
    try {
      const res = await adminEcoCreditsApi.adjust({ userId: customer.id, direction, amount: Number(amount), reason: reason.trim(), adminNote: note.trim() || null });
      toast.success("Eco Credits adjusted", `${direction === "credit" ? "+" : "−"}${Number(amount).toLocaleString("en-IN")} for ${customer.name}. New balance ${res.balance.toLocaleString("en-IN")}.`);
      onSaved();
    } catch (err) { setErrors(errorsFrom(err, "Could not save the adjustment.")); }
    finally { setSaving(false); }
  };

  return (
    <Dialog
      open={open} onClose={onClose} title="Manual Eco Credit Adjustment"
      description="For exceptional corrections only. It is recorded in the ledger and the audit log with your name and the reason — a balance is never changed silently."
      footer={<><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Record adjustment</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{errors.form}</p>}
        <Field label="Customer" required error={errors.userId}>
          {customer ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border erp-border p-2.5">
              <span className="min-w-0"><span className="block truncate text-sm font-semibold erp-text">{customer.name}</span><span className="block truncate text-xs erp-text-muted">{customer.email} · balance {customer.balance.toLocaleString("en-IN")}</span></span>
              <Button size="sm" variant="ghost" type="button" onClick={() => { setCustomer(null); setQ(""); }}>Change</Button>
            </div>
          ) : (
            <div className="relative">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" className={cn(FIELD, errors.userId && FIELD_ERR)} aria-label="Search customer" />
              {matches.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-lg border erp-border erp-surface py-1 shadow-lg">
                  {matches.map((m) => (
                    <li key={m.id}><button type="button" onClick={() => setCustomer(m)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:erp-surface-2">
                      <span className="min-w-0"><span className="block truncate font-semibold erp-text">{m.name}</span><span className="block truncate text-xs erp-text-muted">{m.email}</span></span>
                      <span className="shrink-0 text-xs erp-text-faint">{m.balance.toLocaleString("en-IN")} credits</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" required>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Adjustment type">
              {(["credit", "debit"] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)}
                  className={cn("flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold", direction === d ? (d === "credit" ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300") : "erp-border erp-text-muted")}>
                  {d === "credit" ? <PlusCircle className="h-4 w-4" aria-hidden /> : <MinusCircle className="h-4 w-4" aria-hidden />}{d === "credit" ? "Credit" : "Debit"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Amount (Eco Credits)" required error={errors.amount}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="50" className={cn(FIELD, errors.amount && FIELD_ERR)} />
          </Field>
        </div>
        <Field label="Reason" required error={errors.reason} hint="Shown to the customer in their wallet history.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Additional verified recycling incentive" maxLength={300} className={cn(FIELD, errors.reason && FIELD_ERR)} />
        </Field>
        <Field label="Admin note" hint="Internal only."><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={AREA} /></Field>
      </form>
    </Dialog>
  );
}

export default function EcoCreditsSection() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [dash, setDash] = useState<EcoDashboard | null>(null);
  const [rows, setRows] = useState<{ transactions: AdminEcoTransaction[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ customer: "", type: "", from: "", to: "", material: "", requestNumber: params.get("requestNumber") ?? "" });
  const [adjusting, setAdjusting] = useState(false);
  const [revoking, setRevoking] = useState<AdminEcoTransaction | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const load = useCallback(async () => {
    try {
      setError(null);
      const [d, t] = await Promise.all([
        adminEcoCreditsApi.overview(),
        adminEcoCreditsApi.transactions({
          customer: f.customer.trim() || undefined, type: f.type || undefined, material: f.material.trim() || undefined, requestNumber: f.requestNumber.trim() || undefined,
          from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined, to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : undefined, take: 100,
        }),
      ]);
      setDash(d); setRows(t);
    } catch (e) { setError(describeApiError(e).message); }
  }, [f]);
  useEffect(() => { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t); }, [load]);

  const runExpiry = async () => {
    setBusy(true);
    try { const r = await adminEcoCreditsApi.runExpiry(); toast.success("Expiry run complete", r.credits ? `${r.credits.toLocaleString("en-IN")} credits expired for ${r.customers} customer(s).` : "Nothing was due to expire."); await load(); }
    catch (e) { toast.error("Couldn't run expiry", describeApiError(e).message); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!revoking?.coupon) return;
    setBusy(true);
    try {
      const r = await adminEcoCreditsApi.revokeCoupon(revoking.coupon.id, revokeReason.trim());
      toast.success("Coupon revoked", `${r.creditsReturned.toLocaleString("en-IN")} Eco Credits returned to the customer.`);
      setRevoking(null); setRevokeReason(""); await load();
    } catch (e) { toast.error("Couldn't revoke the coupon", describeApiError(e).message); }
    finally { setBusy(false); }
  };

  const columns: Column<AdminEcoTransaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="whitespace-nowrap erp-text-muted">{formatDateTime(t.createdAt)}</span> },
    { key: "customer", header: "Customer", render: (t) => t.customer ? <Link to={`/admin/customers/${t.customer.id}`} className="block max-w-44 truncate font-semibold text-primary-600 hover:underline dark:text-primary-400" title={t.customer.email}>{t.customer.name}</Link> : <span className="erp-text-faint">—</span> },
    { key: "type", header: "Type", render: (t) => <Badge tone={TYPE_TONE[t.type]}>{ECO_CREDIT_TYPE_LABEL[t.type]}</Badge> },
    {
      key: "desc", header: "Description", hideBelow: "md", render: (t) => (
        <div className="min-w-0 max-w-xs">
          <div className="truncate erp-text" title={t.description ?? undefined}>{t.description ?? "—"}</div>
          {t.request && (
            <Link to={`/admin/returns/recycling/${t.request.requestNumber}`} className="block truncate text-[11px] text-primary-600 hover:underline dark:text-primary-400">
              {t.request.requestNumber}{t.request.verifiedQuantity != null && t.request.creditsPerUnit != null ? ` · ${fmtQty(t.request.verifiedQuantity)} ${t.request.unit} × ${fmtQty(t.request.creditsPerUnit)}` : ""}
            </Link>
          )}
          {t.coupon && <div className="truncate text-[11px] erp-text-faint"><span className="font-mono">{t.coupon.code}</span> · {inrMinor(t.coupon.valueMinor)} · {t.coupon.revoked ? "revoked" : t.coupon.used ? "used" : "unused"}</div>}
          {t.adminNote && <div className="truncate text-[11px] erp-text-faint" title={t.adminNote}>Note: {t.adminNote}</div>}
        </div>
      ),
    },
    { key: "amount", header: "Credits", render: (t) => <span className={cn("whitespace-nowrap font-bold", t.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{t.amount > 0 ? "+" : "−"}{Math.abs(t.amount).toLocaleString("en-IN")}</span> },
    { key: "balance", header: "Balance", hideBelow: "sm", render: (t) => <span className="erp-text-muted">{t.balanceAfter.toLocaleString("en-IN")}</span> },
    {
      key: "act", header: <span className="sr-only">Actions</span>, className: "w-24", render: (t) =>
        t.type === "REDEMPTION" && t.coupon && !t.coupon.used && !t.coupon.revoked
          ? <Button size="sm" variant="ghost" icon={Undo2} onClick={() => { setRevokeReason(""); setRevoking(t); }}>Revoke</Button> : null,
    },
  ];

  return (
    <div className="space-y-5">
      <SummaryCards items={[
        { label: "Total credits issued", value: dash?.totals.issued ?? 0, icon: Coins, tone: "success" },
        { label: "Total credits redeemed", value: dash?.totals.redeemed ?? 0, icon: Gift },
        { label: "Total credits expired", value: dash?.totals.expired ?? 0, icon: TimerOff, tone: "danger" },
        { label: "Credits in wallets", value: dash?.totals.outstanding ?? 0, icon: Hourglass, tone: "info" },
      ]} />
      <SummaryCards items={[
        { label: "Pending recycling requests", value: dash?.requests.pending ?? 0, icon: ListChecks, tone: "info" },
        { label: "Approved recycling requests", value: dash?.requests.approved ?? 0, icon: CheckCircle2, tone: "success" },
      ]} />

      {dash && (
        <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", dash.ledger.reconciled ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200")}>
          {dash.ledger.reconciled ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {dash.ledger.reconciled ? "Ledger reconciled — every customer's balance equals the sum of their transactions." : `${dash.ledger.mismatchedCustomers} customer balance(s) do not match their transactions — investigate before adjusting.`}
        </div>
      )}

      <div className="erp-card card-shadow">
        <div className="flex flex-col gap-3 border-b erp-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-bold erp-text">Transactions{rows ? ` (${rows.total.toLocaleString("en-IN")})` : ""}</h2>
          <div className="flex flex-wrap gap-2">
            {dash?.expiry.enabled && <Button icon={TimerOff} loading={busy} onClick={runExpiry}>Run expiry now ({dash.expiry.days} days)</Button>}
            <Button variant="primary" icon={SlidersHorizontal} onClick={() => setAdjusting(true)}>Manual adjustment</Button>
          </div>
        </div>
        <div className="grid gap-3 border-b erp-border p-4 sm:grid-cols-2 xl:grid-cols-6">
          <input value={f.customer} onChange={(e) => set("customer", e.target.value)} placeholder="Customer name / email" className={FIELD} aria-label="Filter by customer" />
          <Select value={f.type} onChange={(v) => set("type", v)} aria-label="Transaction type" className="w-full">
            <option value="">All types</option>
            {(Object.keys(ECO_CREDIT_TYPE_LABEL) as EcoCreditType[]).map((t) => <option key={t} value={t}>{ECO_CREDIT_TYPE_LABEL[t]}</option>)}
          </Select>
          <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} className={FIELD} aria-label="From date" />
          <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} className={FIELD} aria-label="To date" />
          <input value={f.material} onChange={(e) => set("material", e.target.value)} placeholder="Material" className={FIELD} aria-label="Filter by material" />
          <input value={f.requestNumber} onChange={(e) => set("requestNumber", e.target.value)} placeholder="Request ID (RCY-…)" className={FIELD} aria-label="Filter by request ID" />
        </div>
        <div className="p-4">
          {rows === null && !error && <TableSkeleton rows={5} cols={6} />}
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {rows !== null && !error && rows.transactions.length === 0 && <EmptyState icon={Coins} title="No transactions" message="Eco Credit transactions appear here when recycling requests are approved, credits are redeemed or adjusted." />}
          {rows !== null && !error && rows.transactions.length > 0 && <DataTable caption="Eco Credit transactions" columns={columns} rows={rows.transactions} rowKey={(t) => t.id} />}
        </div>
      </div>

      <AdjustmentDialog open={adjusting} onClose={() => setAdjusting(false)} onSaved={() => { setAdjusting(false); void load(); }} />
      <Dialog
        open={!!revoking} onClose={() => setRevoking(null)}
        title={`Revoke coupon ${revoking?.coupon?.code ?? ""}?`}
        description={`The unused coupon stops working and ${Math.abs(revoking?.amount ?? 0).toLocaleString("en-IN")} Eco Credits go back to ${revoking?.customer?.name ?? "the customer"} as a Reversal.`}
        footer={<><Button onClick={() => setRevoking(null)} disabled={busy}>Cancel</Button><Button variant="danger" icon={Undo2} loading={busy} disabled={revokeReason.trim().length < 3} onClick={revoke}>Revoke &amp; return credits</Button></>}
      >
        <label className="block"><span className="mb-1.5 block text-xs font-semibold erp-text-muted">Reason <span className="text-red-500">*</span></span>
          <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} maxLength={300} className={FIELD} /></label>
      </Dialog>
    </div>
  );
}
