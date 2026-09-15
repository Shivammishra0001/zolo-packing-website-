// Settings — admin-managed payment methods and customer notifications.
//
// Everything on this page is read from and written to PostgreSQL through
// /api/v1/admin/settings/*. Secrets (SMTP password, WhatsApp token) are sent
// once, stored encrypted, and never come back — the API only reports "set".
// Test buttons really send through the configured provider and show the
// provider's actual outcome; nothing here fakes success.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  CreditCard,
  ImageOff,
  Link2,
  Mail,
  MessageCircle,
  QrCode,
  Save,
  Send,
  ServerCog,
  Trash2,
  Truck,
  Upload,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, PageHeader, Select, Tabs, type TabItem } from "../components/ui";
import { EmptyState, Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { PaymentRequestsPanel } from "../components/PaymentRequests";
import { formatDateTime } from "../format";
import {
  fileToBase64,
  notificationSettingsApi,
  paymentSettingsApi,
  type DeliveryRow,
  type NotificationSettings,
  type PaymentMethodKey,
  type PaymentMethodSetting,
} from "@/lib/api/settings";

const TABS: TabItem[] = [
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "email", label: "Email (SMTP)", icon: Mail },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "requests", label: "Payment requests", icon: Link2 },
  { key: "general", label: "General", icon: Building2 },
];

const rupees = (minor: number | null | undefined) => (minor == null ? "" : String(Math.round(minor) / 100));
const toMinor = (v: string): number | null => {
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  if (!v.trim() || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold erp-text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] erp-text-faint">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-primary-500" : "bg-dark-300 dark:bg-dark-600"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5.5" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Warn before leaving the tab/page when a form has unsaved edits. */
function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
function PaymentsTab() {
  const toast = useToast();
  const [methods, setMethods] = useState<PaymentMethodSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    paymentSettingsApi.list().then((r) => setMethods(r.methods)).catch((e) => setError(e instanceof Error ? e.message : "Could not load payment settings."));
  }, []);
  useEffect(load, [load]);

  const patch = (updated: PaymentMethodSetting) => setMethods((cur) => (cur ? cur.map((m) => (m.key === updated.key ? updated : m)) : cur));

  const toggle = async (m: PaymentMethodSetting) => {
    try {
      const r = await paymentSettingsApi.update(m.key, { enabled: !m.enabled });
      patch(r);
      toast.success(`${r.displayName} ${r.enabled ? "enabled" : "disabled"}`, r.enabled ? "Customers can choose it at checkout now." : "It no longer appears at checkout.");
    } catch (e) {
      toast.error("Could not update", e instanceof Error ? e.message : undefined);
    }
  };

  if (error) return <Panel><EmptyState icon={CreditCard} title="Couldn't load payment settings" message={error} action={<Button onClick={load}>Retry</Button>} /></Panel>;
  if (!methods) return <Panel><div className="p-6 text-center text-sm erp-text-muted">Loading payment methods…</div></Panel>;

  const cod = methods.find((m) => m.key === "cod");
  const upi = methods.find((m) => m.key === "upi");
  const bank = methods.find((m) => m.key === "bank_transfer");
  const others = methods.filter((m) => !["cod", "upi", "bank_transfer"].includes(m.key));

  return (
    <div className="space-y-4">
      <p className="text-sm erp-text-muted">
        Methods enabled here are offered to customers at checkout and on payment links immediately. No online gateway is integrated —
        UPI and bank transfers are verified manually from the customer's submitted reference/proof.
      </p>
      {cod && <CodCard method={cod} onToggle={() => toggle(cod)} onSaved={patch} />}
      {upi && <UpiCard method={upi} onToggle={() => toggle(upi)} onSaved={patch} />}
      {bank && <BankCard method={bank} onToggle={() => toggle(bank)} onSaved={patch} />}
      <Panel title="Other offline methods">
        <ul className="divide-y erp-border-soft">
          {others.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-semibold erp-text">{m.displayName}</p>
                <p className="text-xs erp-text-muted">{m.description}</p>
              </div>
              <Toggle checked={m.enabled} onChange={() => toggle(m)} label={`Enable ${m.displayName}`} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function MethodHeader({ method, icon: Icon, onToggle }: { method: PaymentMethodSetting; icon: typeof CreditCard; onToggle: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300"><Icon className="h-5 w-5" aria-hidden /></span>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold erp-text">{method.displayName} <Badge tone={method.enabled ? "success" : "neutral"}>{method.enabled ? "Enabled" : "Disabled"}</Badge></p>
          <p className="text-xs erp-text-muted">{method.description}</p>
        </div>
      </div>
      <Toggle checked={method.enabled} onChange={onToggle} label={`Enable ${method.displayName}`} />
    </div>
  );
}

function CodCard({ method, onToggle, onSaved }: { method: PaymentMethodSetting; onToggle: () => void; onSaved: (m: PaymentMethodSetting) => void }) {
  const toast = useToast();
  const [min, setMin] = useState(rupees(method.config.minOrderMinor));
  const [max, setMax] = useState(rupees(method.config.maxOrderMinor));
  const [charge, setCharge] = useState(rupees(method.config.codChargeMinor ?? 0));
  const [busy, setBusy] = useState(false);
  const dirty = min !== rupees(method.config.minOrderMinor) || max !== rupees(method.config.maxOrderMinor) || charge !== rupees(method.config.codChargeMinor ?? 0);
  useUnsavedGuard(dirty);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const minM = toMinor(min), maxM = toMinor(max), chM = toMinor(charge) ?? 0;
    if (minM != null && maxM != null && minM > maxM) { setErr("Minimum cannot be greater than maximum."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await paymentSettingsApi.update("cod", { config: { minOrderMinor: minM, maxOrderMinor: maxM, codChargeMinor: chM } });
      onSaved(r);
      toast.success("COD settings saved", "Limits and charge apply to new checkouts immediately.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };

  return (
    <div className="erp-card card-shadow p-5">
      <MethodHeader method={method} icon={Truck} onToggle={onToggle} />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Minimum order (₹)" hint="Leave blank for no minimum"><input className="erp-input w-full" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="e.g. 500" /></Field>
        <Field label="Maximum order (₹)" hint="Leave blank for no maximum"><input className="erp-input w-full" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="e.g. 50000" /></Field>
        <Field label="COD charge (₹)" hint="Added to the order total; 0 for none"><input className="erp-input w-full" inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} placeholder="0" /></Field>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save COD settings</Button>
      </div>
    </div>
  );
}

function UpiCard({ method, onToggle, onSaved }: { method: PaymentMethodSetting; onToggle: () => void; onSaved: (m: PaymentMethodSetting) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [upiId, setUpiId] = useState(method.config.upiId ?? "");
  const [accountName, setAccountName] = useState(method.config.accountName ?? "");
  const [instructions, setInstructions] = useState(method.config.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = upiId !== (method.config.upiId ?? "") || accountName !== (method.config.accountName ?? "") || instructions !== (method.config.instructions ?? "");
  useUnsavedGuard(dirty);

  const save = async () => {
    if (upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim())) { setErr("Enter a valid UPI ID like name@bank."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await paymentSettingsApi.update("upi", { config: { upiId: upiId.trim(), accountName: accountName.trim(), instructions: instructions.trim() } });
      onSaved(r);
      toast.success("UPI settings saved");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };

  const upload = async (f: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) { toast.error("Unsupported format", "Use a PNG, JPG or WebP image of the QR code."); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error("Image too large", "Maximum 5 MB."); return; }
    setQrBusy(true);
    try {
      const r = await paymentSettingsApi.uploadQr(f.name, f.type, await fileToBase64(f));
      onSaved(r);
      toast.success(method.config.qrUrl ? "QR code replaced" : "QR code uploaded", "Customers now see this QR at checkout and on payment links.");
    } catch (e) { toast.error("Upload failed", e instanceof Error ? e.message : undefined); } finally { setQrBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeQr = async () => {
    if (!window.confirm("Remove the UPI QR code? Customers will only see the UPI ID.")) return;
    setQrBusy(true);
    try { onSaved(await paymentSettingsApi.removeQr()); toast.info("QR code removed"); }
    catch (e) { toast.error("Could not remove", e instanceof Error ? e.message : undefined); }
    finally { setQrBusy(false); }
  };

  return (
    <div className="erp-card card-shadow p-5">
      <MethodHeader method={method} icon={QrCode} onToggle={onToggle} />
      <div className="mt-4 grid gap-4 md:grid-cols-[200px_1fr]">
        <div>
          <span className="mb-1 block text-xs font-semibold erp-text-muted">QR code image</span>
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border erp-border erp-surface-2">
            {method.config.qrUrl ? <img src={method.config.qrUrl} alt="UPI QR code" className="h-full w-full object-contain" /> : <ImageOff className="h-8 w-8 erp-text-faint" aria-hidden />}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" icon={Upload} loading={qrBusy} onClick={() => fileRef.current?.click()}>{method.config.qrUrl ? "Replace" : "Upload"}</Button>
            {method.config.qrUrl && <Button size="sm" variant="ghost" icon={Trash2} disabled={qrBusy} onClick={removeQr}>Remove</Button>}
          </div>
        </div>
        <div className="space-y-3">
          <Field label="UPI ID" hint="Shown to customers so they can pay without scanning"><input className="erp-input w-full" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="zolopackaging@upi" /></Field>
          <Field label="Account / payee name"><input className="erp-input w-full" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Zolo Packaging" /></Field>
          <Field label="Instructions to customer" hint="Shown under the QR code"><textarea className="erp-input w-full" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Scan and pay the exact amount, then enter the UPI transaction ID." /></Field>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex items-center justify-end gap-2">
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save UPI settings</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BankCard({ method, onToggle, onSaved }: { method: PaymentMethodSetting; onToggle: () => void; onSaved: (m: PaymentMethodSetting) => void }) {
  const toast = useToast();
  const c = method.config;
  const [form, setForm] = useState({ accountName: c.accountName ?? "", bankName: c.bankName ?? "", accountNumber: c.accountNumber ?? "", ifsc: c.ifsc ?? "", instructions: c.instructions ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify({ accountName: c.accountName ?? "", bankName: c.bankName ?? "", accountNumber: c.accountNumber ?? "", ifsc: c.ifsc ?? "", instructions: c.instructions ?? "" });
  useUnsavedGuard(dirty);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (form.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.trim().toUpperCase())) { setErr("IFSC should look like HDFC0001234."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await paymentSettingsApi.update("bank_transfer", { config: { ...form, ifsc: form.ifsc.trim().toUpperCase() } });
      onSaved(r);
      toast.success("Bank details saved");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };

  return (
    <div className="erp-card card-shadow p-5">
      <MethodHeader method={method} icon={Building2} onToggle={onToggle} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Account name"><input className="erp-input w-full" value={form.accountName} onChange={set("accountName")} /></Field>
        <Field label="Bank name"><input className="erp-input w-full" value={form.bankName} onChange={set("bankName")} /></Field>
        <Field label="Account number"><input className="erp-input w-full font-mono" value={form.accountNumber} onChange={set("accountNumber")} /></Field>
        <Field label="IFSC"><input className="erp-input w-full font-mono uppercase" value={form.ifsc} onChange={set("ifsc")} /></Field>
        <div className="sm:col-span-2"><Field label="Instructions to customer"><textarea className="erp-input w-full" rows={2} value={form.instructions} onChange={set("instructions")} placeholder="Transfer via NEFT/IMPS and share the UTR number." /></Field></div>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save bank details</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications (channels + per-event matrix + delivery history)
// ---------------------------------------------------------------------------
function useNotificationSettings() {
  const [data, setData] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    notificationSettingsApi.get().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Could not load notification settings."));
  }, []);
  useEffect(load, [load]);
  return { data, error, load, setData };
}

const CHANNELS: { key: "inApp" | "email" | "whatsapp" | "sms"; label: string }[] = [
  { key: "inApp", label: "In-app" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "sms", label: "SMS" },
];

function NotificationsTab() {
  const toast = useToast();
  const { data, error, load, setData } = useNotificationSettings();
  const [channels, setChannels] = useState<NotificationSettings["channels"] | null>(null);
  const [matrix, setMatrix] = useState<Record<string, { email: boolean; whatsapp: boolean; sms: boolean; inApp: boolean }> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setChannels(data.channels); setMatrix(data.effectiveMatrix); } }, [data]);
  const dirty = Boolean(data && channels && matrix && (JSON.stringify(channels) !== JSON.stringify(data.channels) || JSON.stringify(matrix) !== JSON.stringify(data.effectiveMatrix)));
  useUnsavedGuard(dirty);

  if (error) return <Panel><EmptyState icon={Bell} title="Couldn't load notification settings" message={error} action={<Button onClick={load}>Retry</Button>} /></Panel>;
  if (!data || !channels || !matrix) return <Panel><div className="p-6 text-center text-sm erp-text-muted">Loading…</div></Panel>;

  const channelEnabled = { inApp: channels.inAppEnabled, email: channels.emailEnabled, whatsapp: channels.whatsappEnabled, sms: channels.smsEnabled };
  const save = async () => {
    setBusy(true);
    try {
      const r = await notificationSettingsApi.updateChannels({ ...channels, eventMatrix: matrix });
      setData(r);
      toast.success("Notification settings saved", "New events use these rules immediately.");
    } catch (e) { toast.error("Could not save", e instanceof Error ? e.message : undefined); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Panel title="Channels" action={<Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save</Button>}>
        <p className="mb-3 text-sm erp-text-muted">A channel switched off here is never used, whatever the event matrix or the customer's own preferences say.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChannelRow label="In-app notifications" hint="Bell + dashboard alerts" checked={channels.inAppEnabled} onChange={(v) => setChannels({ ...channels, inAppEnabled: v })} status="ready" />
          <ChannelRow label="Email" hint={data.email.configured ? `via ${data.email.host || "SMTP"} (${data.email.source})` : "SMTP not configured — see the Email tab"} checked={channels.emailEnabled} onChange={(v) => setChannels({ ...channels, emailEnabled: v })} status={data.email.configured ? "ready" : "missing"} />
          <ChannelRow label="WhatsApp" hint={data.whatsapp.configured ? `Meta Cloud API (${data.whatsapp.source})` : "Provider not configured — see the WhatsApp tab"} checked={channels.whatsappEnabled} onChange={(v) => setChannels({ ...channels, whatsappEnabled: v })} status={data.whatsapp.configured ? "ready" : "missing"} />
          <ChannelRow label="SMS" hint="No SMS provider is integrated; enabling records deliveries as skipped" checked={channels.smsEnabled} onChange={(v) => setChannels({ ...channels, smsEnabled: v })} status="missing" />
        </div>
      </Panel>

      <Panel title="Events × channels" action={dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : undefined} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b erp-border-soft text-left text-[11px] font-bold uppercase tracking-wider erp-text-faint">
                <th className="px-4 py-2.5 sm:px-5">Event</th>
                {CHANNELS.map((c) => <th key={c.key} className="px-3 py-2.5 text-center">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.events.map((ev) => (
                <tr key={ev.key} className="border-b erp-border-soft last:border-0">
                  <td className="px-4 py-2.5 sm:px-5">
                    <span className="font-medium erp-text">{ev.label}</span>
                    {!ev.mandatory && <span className="ml-2 text-[11px] erp-text-faint">respects customer opt-out</span>}
                  </td>
                  {CHANNELS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${ev.label} via ${c.label}`}
                        className="h-4 w-4 accent-primary-600 disabled:opacity-40"
                        checked={Boolean(matrix[ev.key]?.[c.key])}
                        disabled={!channelEnabled[c.key]}
                        onChange={(e) => setMatrix({ ...matrix, [ev.key]: { ...matrix[ev.key], [c.key]: e.target.checked } })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t erp-border-soft px-4 py-3 sm:px-5">
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save notification rules</Button>
        </div>
      </Panel>

      <DeliveryHistory />
    </div>
  );
}

function ChannelRow({ label, hint, checked, onChange, status }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; status: "ready" | "missing" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border erp-border p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold erp-text">{label} <Badge tone={status === "ready" ? "success" : "warning"}>{status === "ready" ? "Ready" : "Not configured"}</Badge></p>
        <p className="truncate text-xs erp-text-muted">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={`Enable ${label}`} />
    </div>
  );
}

const DELIVERY_TONE: Record<string, "success" | "danger" | "neutral" | "info" | "warning"> = { SENT: "success", DELIVERED: "success", READ: "success", FAILED: "danger", SKIPPED: "neutral", PENDING: "info" };

function DeliveryHistory() {
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    notificationSettingsApi.deliveries({ channel: channel || undefined, status: status || undefined, take: 50 })
      .then((r) => { setRows(r.deliveries); setTotal(r.total); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load delivery history."));
  }, [channel, status]);
  useEffect(load, [load]);

  const columns: Column<DeliveryRow>[] = [
    { key: "when", header: "When", render: (d) => <span className="whitespace-nowrap text-xs erp-text-muted">{formatDateTime(d.createdAt)}</span> },
    { key: "channel", header: "Channel", render: (d) => <span className="text-xs font-semibold uppercase erp-text">{d.channel.replace("_", " ")}</span> },
    { key: "event", header: "Event", render: (d) => <span className="font-mono text-xs erp-text-muted">{d.messageType}</span>, hideBelow: "md" },
    { key: "to", header: "Recipient", render: (d) => <span className="block max-w-56 truncate text-xs erp-text">{d.customer?.name ? `${d.customer.name} · ` : ""}{d.recipient}</span> },
    { key: "status", header: "Status", render: (d) => <Badge tone={DELIVERY_TONE[d.status] ?? "neutral"}>{d.status}</Badge> },
    { key: "detail", header: "Detail", render: (d) => <span className="block max-w-72 truncate text-xs erp-text-muted" title={d.error ?? d.subject ?? ""}>{d.error ?? d.subject ?? d.providerMessageId ?? "—"}</span>, hideBelow: "lg" },
  ];

  return (
    <Panel
      title={<span className="flex items-center gap-2">Delivery history {total > 0 && <Badge tone="neutral">{total}</Badge>}</span>}
      action={
        <div className="flex gap-2">
          <Select value={channel} onChange={setChannel} aria-label="Channel" className="h-9"><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="in_app">In-app</option></Select>
          <Select value={status} onChange={setStatus} aria-label="Status" className="h-9"><option value="">All statuses</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="SKIPPED">Skipped</option><option value="PENDING">Pending</option></Select>
        </div>
      }
      bodyClassName="p-0"
    >
      {err ? <EmptyState icon={Bell} title="Couldn't load" message={err} action={<Button onClick={load}>Retry</Button>} />
        : rows == null ? <div className="p-6 text-center text-sm erp-text-muted">Loading…</div>
        : rows.length === 0 ? <EmptyState icon={Send} title="No deliveries yet" message="Every email / WhatsApp attempt is recorded here with its real outcome." />
        : <DataTable caption="Delivery history" columns={columns} rows={rows} rowKey={(d) => d.id} />}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Email (SMTP)
// ---------------------------------------------------------------------------
function EmailTab() {
  const toast = useToast();
  const { data, error, load, setData } = useNotificationSettings();
  const [form, setForm] = useState({ host: "", port: "587", secure: false, user: "", password: "", fromEmail: "", fromName: "", replyTo: "" });
  const [clearPassword, setClearPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; error?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const baseline = useMemo(() => data ? { host: data.email.host, port: String(data.email.port), secure: data.email.secure, user: data.email.user, password: "", fromEmail: data.email.fromEmail, fromName: data.email.fromName, replyTo: data.email.replyTo } : null, [data]);
  useEffect(() => { if (baseline) { setForm(baseline); setClearPassword(false); } }, [baseline]);
  const dirty = Boolean(baseline && (JSON.stringify(form) !== JSON.stringify(baseline) || clearPassword));
  useUnsavedGuard(dirty);

  if (error) return <Panel><EmptyState icon={Mail} title="Couldn't load email settings" message={error} action={<Button onClick={load}>Retry</Button>} /></Panel>;
  if (!data) return <Panel><div className="p-6 text-center text-sm erp-text-muted">Loading…</div></Panel>;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const port = Number(form.port);
    if (form.host && (!Number.isInteger(port) || port < 1 || port > 65535)) { setErr("Port must be between 1 and 65535."); return; }
    if (form.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.fromEmail)) { setErr("Enter a valid From email address."); return; }
    if (form.host && !form.fromEmail) { setErr("A From email address is required when SMTP is configured."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await notificationSettingsApi.updateEmail({
        host: form.host.trim(), port: port || 587, secure: form.secure, user: form.user.trim(),
        ...(form.password ? { password: form.password } : {}), ...(clearPassword ? { clearPassword: true } : {}),
        fromEmail: form.fromEmail.trim(), fromName: form.fromName.trim(), replyTo: form.replyTo.trim(),
      });
      setData((cur) => (cur ? { ...cur, ...r } : cur));
      toast.success("Email settings saved", r.email.configured ? "SMTP is configured — send a test email to confirm." : "SMTP is incomplete; email deliveries will be skipped.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };
  const test = async () => {
    if (!testTo.trim()) { toast.error("Enter a recipient for the test email"); return; }
    setTesting(true); setTestResult(null);
    try { setTestResult(await notificationSettingsApi.testEmail(testTo.trim())); }
    catch (e) { setTestResult({ status: "FAILED", error: e instanceof Error ? e.message : "Request failed" }); }
    finally { setTesting(false); }
  };

  return (
    <div className="space-y-4">
      <Panel title={<span className="flex items-center gap-2">SMTP server <Badge tone={data.email.configured ? "success" : "warning"}>{data.email.configured ? `Configured (${data.email.source})` : "Not configured"}</Badge></span>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SMTP host"><input className="erp-input w-full" value={form.host} onChange={set("host")} placeholder="smtp.gmail.com" autoComplete="off" /></Field>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Port"><input className="erp-input w-full" inputMode="numeric" value={form.port} onChange={set("port")} /></Field>
            <Field label="TLS (SMTPS)"><div className="flex h-10 items-center"><Toggle checked={form.secure} onChange={(v) => setForm((f) => ({ ...f, secure: v, port: v && f.port === "587" ? "465" : !v && f.port === "465" ? "587" : f.port }))} label="Use TLS" /></div></Field>
          </div>
          <Field label="Username"><input className="erp-input w-full" value={form.user} onChange={set("user")} autoComplete="off" /></Field>
          <Field label="Password" hint={data.email.passwordSet ? (clearPassword ? "Will be removed on save" : "A password is stored — leave blank to keep it") : "Stored encrypted; never shown again"}>
            <div className="flex gap-2">
              <input className="erp-input w-full" type="password" value={form.password} onChange={(e) => { setForm((f) => ({ ...f, password: e.target.value })); setClearPassword(false); }} placeholder={data.email.passwordSet ? "••••••••" : ""} autoComplete="new-password" />
              {data.email.passwordSet && <Button variant="ghost" size="sm" onClick={() => { setClearPassword((v) => !v); setForm((f) => ({ ...f, password: "" })); }}>{clearPassword ? "Keep" : "Clear"}</Button>}
            </div>
          </Field>
          <Field label="From email"><input className="erp-input w-full" value={form.fromEmail} onChange={set("fromEmail")} placeholder="no-reply@zolopackaging.com" /></Field>
          <Field label="From name"><input className="erp-input w-full" value={form.fromName} onChange={set("fromName")} placeholder="Zolo Packaging" /></Field>
          <Field label="Reply-to (optional)"><input className="erp-input w-full" value={form.replyTo} onChange={set("replyTo")} placeholder="support@zolopackaging.com" /></Field>
        </div>
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save email settings</Button>
        </div>
      </Panel>

      <Panel title="Send a test email">
        <p className="mb-3 text-sm erp-text-muted">Uses the saved settings to really send a message through your SMTP server and reports the server's response.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="erp-input w-full sm:max-w-sm" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@company.com" />
          <Button icon={Send} loading={testing} disabled={!data.email.configured || dirty} onClick={test}>Send test email</Button>
        </div>
        {!data.email.configured && <p className="mt-2 text-xs text-amber-600">Save a complete SMTP configuration first.</p>}
        {dirty && data.email.configured && <p className="mt-2 text-xs text-amber-600">Save your changes before testing.</p>}
        {testResult && (
          <p className={`mt-3 rounded-lg p-3 text-sm ${testResult.status === "SENT" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"}`}>
            {testResult.status === "SENT" ? "Test email sent — check the inbox." : `Not sent: ${testResult.error ?? testResult.status}`}
          </p>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------
function WhatsAppTab() {
  const toast = useToast();
  const { data, error, load, setData } = useNotificationSettings();
  const [form, setForm] = useState({ provider: "" as "meta" | "", phoneNumberId: "", accessToken: "", businessNumber: "" });
  const [clearToken, setClearToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; error?: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const baseline = useMemo(() => data ? { provider: (data.whatsapp.provider === "meta" ? "meta" : "") as "meta" | "", phoneNumberId: data.whatsapp.phoneNumberId, accessToken: "", businessNumber: data.whatsapp.businessNumber } : null, [data]);
  useEffect(() => { if (baseline) { setForm(baseline); setClearToken(false); } }, [baseline]);
  const dirty = Boolean(baseline && (JSON.stringify(form) !== JSON.stringify(baseline) || clearToken));
  useUnsavedGuard(dirty);

  if (error) return <Panel><EmptyState icon={MessageCircle} title="Couldn't load WhatsApp settings" message={error} action={<Button onClick={load}>Retry</Button>} /></Panel>;
  if (!data) return <Panel><div className="p-6 text-center text-sm erp-text-muted">Loading…</div></Panel>;

  const save = async () => {
    if (form.provider === "meta" && !form.phoneNumberId.trim()) { setErr("Phone number ID is required for the Meta Cloud API."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await notificationSettingsApi.updateWhatsApp({
        provider: form.provider, phoneNumberId: form.phoneNumberId.trim(), businessNumber: form.businessNumber.trim(),
        ...(form.accessToken ? { accessToken: form.accessToken } : {}), ...(clearToken ? { clearAccessToken: true } : {}),
      });
      setData((cur) => (cur ? { ...cur, ...r } : cur));
      toast.success("WhatsApp settings saved", r.whatsapp.configured ? "Provider configured — send a test message to confirm." : "Configuration incomplete; WhatsApp deliveries will be skipped.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };
  const test = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await notificationSettingsApi.testWhatsApp(testTo.trim())); }
    catch (e) { setTestResult({ status: "FAILED", error: e instanceof Error ? e.message : "Request failed" }); }
    finally { setTesting(false); }
  };

  return (
    <div className="space-y-4">
      <Panel title={<span className="flex items-center gap-2">WhatsApp provider <Badge tone={data.whatsapp.configured ? "success" : "warning"}>{data.whatsapp.configured ? `Configured (${data.whatsapp.source})` : "Not configured"}</Badge></span>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider"><Select value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v as "meta" | "" }))} className="w-full"><option value="">— Off —</option><option value="meta">Meta WhatsApp Cloud API</option></Select></Field>
          <Field label="Business number" hint="Owner number for new-RFQ alerts; digits with country code"><input className="erp-input w-full" value={form.businessNumber} onChange={(e) => setForm((f) => ({ ...f, businessNumber: e.target.value }))} placeholder="919876543210" /></Field>
          <Field label="Phone number ID" hint="From Meta Business → WhatsApp → API setup"><input className="erp-input w-full font-mono" value={form.phoneNumberId} onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))} autoComplete="off" /></Field>
          <Field label="Access token" hint={data.whatsapp.accessTokenSet ? (clearToken ? "Will be removed on save" : "A token is stored — leave blank to keep it") : "Stored encrypted; never shown again"}>
            <div className="flex gap-2">
              <input className="erp-input w-full" type="password" value={form.accessToken} onChange={(e) => { setForm((f) => ({ ...f, accessToken: e.target.value })); setClearToken(false); }} placeholder={data.whatsapp.accessTokenSet ? "••••••••" : ""} autoComplete="new-password" />
              {data.whatsapp.accessTokenSet && <Button variant="ghost" size="sm" onClick={() => { setClearToken((v) => !v); setForm((f) => ({ ...f, accessToken: "" })); }}>{clearToken ? "Keep" : "Clear"}</Button>}
            </div>
          </Field>
        </div>
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          <Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save WhatsApp settings</Button>
        </div>
      </Panel>

      <Panel title="Send a test message">
        <p className="mb-3 text-sm erp-text-muted">Really sends through the configured provider. Leave the number blank to send to the business number.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="erp-input w-full sm:max-w-sm" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={data.whatsapp.businessNumber || "919876543210"} />
          <Button icon={Send} loading={testing} disabled={!data.whatsapp.configured || dirty} onClick={test}>Send test message</Button>
        </div>
        {!data.whatsapp.configured && <p className="mt-2 text-xs text-amber-600">Save a complete provider configuration first.</p>}
        {testResult && (
          <p className={`mt-3 rounded-lg p-3 text-sm ${testResult.status === "SENT" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"}`}>
            {testResult.status === "SENT" ? "Test message sent." : `Not sent: ${testResult.error ?? testResult.status}`}
          </p>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General (what is configured elsewhere — unchanged facts)
// ---------------------------------------------------------------------------
function GeneralTab() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="erp-card card-shadow p-5">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold erp-text"><Truck className="h-4 w-4 text-primary-500" aria-hidden /> Shipping</h3>
        <p className="text-sm erp-text-muted">Shipments are recorded manually per order (courier name + tracking number on the order's status update). No courier API integration exists yet.</p>
      </div>
      <div className="erp-card card-shadow p-5">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold erp-text"><Building2 className="h-4 w-4 text-primary-500" aria-hidden /> Company profile</h3>
        <p className="text-sm erp-text-muted">Company name, address and GSTIN for invoices are not yet stored in the database — nothing is shown rather than a fabricated profile.</p>
      </div>
      <div className="flex items-start gap-2 rounded-lg border erp-border-soft p-4 text-xs erp-text-faint sm:col-span-2">
        <ServerCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Database, JWT secrets, admin account and CORS still live in <code className="font-mono">server/.env</code> (reference: <code className="font-mono">server/.env.example</code>). Payment methods and notification providers are managed on this page and take effect without a restart.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function Settings() {
  const [tab, setTab] = useState<string>(() => { try { return sessionStorage.getItem("zolo.admin.settings.tab") || "payments"; } catch { return "payments"; } });
  useEffect(() => { try { sessionStorage.setItem("zolo.admin.settings.tab", tab); } catch { /* ignore */ } }, [tab]);

  return (
    <div className="shell-form">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Settings" }]}
        title="Settings"
        subtitle="Payment methods, customer notifications and providers — stored in the database and applied instantly."
      />
      <div className="mb-5"><Tabs tabs={TABS} active={tab} onChange={setTab} /></div>
      {tab === "payments" && <PaymentsTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "email" && <EmailTab />}
      {tab === "whatsapp" && <WhatsAppTab />}
      {tab === "requests" && <PaymentRequestsPanel title="All payment requests" />}
      {tab === "general" && <GeneralTab />}
    </div>
  );
}

// Keep the key type referenced for readers of this file.
export type { PaymentMethodKey };
