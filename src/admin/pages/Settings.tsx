import { useState } from "react";
import { Building2, CreditCard, Globe, Key, Mail, MessageCircle, Palette, RefreshCw, Truck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, PageHeader, Tabs } from "../components/ui";
import { cn } from "@/utils/cn";

function Field({ label, defaultValue, placeholder, type = "text" }: { label: string; defaultValue?: string; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold erp-text-muted">{label}</span>
      <input type={type} defaultValue={defaultValue} placeholder={placeholder} className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
    </label>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary-500" : "erp-surface-2 border erp-border")}>
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function ToggleRow({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b erp-border-soft py-3 last:border-0">
      <div><div className="text-sm font-semibold erp-text">{label}</div>{sub && <div className="text-xs erp-text-faint">{sub}</div>}</div>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

function SaveBar({ onSave }: { onSave: () => void }) {
  return <div className="mt-5"><Button variant="primary" onClick={onSave}>Save changes</Button></div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="erp-card card-shadow max-w-2xl p-5">
      <h3 className="mb-4 text-sm font-bold erp-text">{title}</h3>
      {children}
    </div>
  );
}

const ACCENTS = ["#f97316", "#0ea5e9", "#22c55e", "#a855f7", "#ef4444", "#eab308"];

export default function Settings() {
  const toast = useToast();
  const [tab, setTab] = useState("company");
  const save = () => toast.success("Settings saved", "Your changes have been stored.");

  const [payments, setPayments] = useState({ razorpay: true, upi: true, netbanking: false, cod: false });
  const [couriers, setCouriers] = useState({ bluedart: true, delhivery: true, dtdc: false, ekart: true });
  const [theme, setTheme] = useState("system");
  const [accent, setAccent] = useState(ACCENTS[0]);

  const TABS = [
    { key: "company", label: "Company", icon: Building2 },
    { key: "tax", label: "Tax" },
    { key: "payment", label: "Payment", icon: CreditCard },
    { key: "shipping", label: "Shipping", icon: Truck },
    { key: "email", label: "Email", icon: Mail },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
    { key: "theme", label: "Theme", icon: Palette },
    { key: "api", label: "API", icon: Globe },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Settings" }]}
        title="Settings"
        subtitle="Configure your workspace, integrations and preferences."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "company" && (
        <Card title="Company profile">
          <div className="space-y-4">
            <Field label="Company name" defaultValue="Zolo Packaging Pvt Ltd" />
            <Field label="Registered address" defaultValue="Plot 42, Industrial Area, Gurugram, HR 122001" />
            <Field label="GSTIN" defaultValue="06AAECZ1234M1Z8" />
            <Field label="Logo URL" placeholder="https://…/logo.png" />
            <SaveBar onSave={save} />
          </div>
        </Card>
      )}

      {tab === "tax" && (
        <Card title="GST rates">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b erp-border text-left">
                  {["HSN", "Description", "Rate"].map((h) => <th key={h} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0 last:pr-0">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {[
                  { hsn: "4819", desc: "Cartons, boxes of paper/board", rate: "18%" },
                  { hsn: "4823", desc: "Other paper articles", rate: "18%" },
                  { hsn: "3923", desc: "Plastic packaging articles", rate: "18%" },
                  { hsn: "4808", desc: "Corrugated paper & board", rate: "12%" },
                ].map((r) => (
                  <tr key={r.hsn} className="border-b erp-border-soft last:border-0">
                    <td className="px-3 py-2.5 first:pl-0 font-mono erp-text">{r.hsn}</td>
                    <td className="px-3 py-2.5 erp-text-muted">{r.desc}</td>
                    <td className="px-3 py-2.5 last:pr-0"><Badge tone="info">{r.rate}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SaveBar onSave={save} />
        </Card>
      )}

      {tab === "payment" && (
        <Card title="Payment gateways">
          <ToggleRow label="Razorpay" sub="Cards, UPI, wallets, netbanking" on={payments.razorpay} onChange={(v) => setPayments((p) => ({ ...p, razorpay: v }))} />
          <ToggleRow label="UPI (direct)" sub="Collect via VPA" on={payments.upi} onChange={(v) => setPayments((p) => ({ ...p, upi: v }))} />
          <ToggleRow label="Net Banking" sub="Bank transfer at checkout" on={payments.netbanking} onChange={(v) => setPayments((p) => ({ ...p, netbanking: v }))} />
          <ToggleRow label="Cash on Delivery" sub="For low-value orders only" on={payments.cod} onChange={(v) => setPayments((p) => ({ ...p, cod: v }))} />
          <SaveBar onSave={save} />
        </Card>
      )}

      {tab === "shipping" && (
        <Card title="Courier partners">
          <ToggleRow label="BlueDart" on={couriers.bluedart} onChange={(v) => setCouriers((c) => ({ ...c, bluedart: v }))} />
          <ToggleRow label="Delhivery" on={couriers.delhivery} onChange={(v) => setCouriers((c) => ({ ...c, delhivery: v }))} />
          <ToggleRow label="DTDC" on={couriers.dtdc} onChange={(v) => setCouriers((c) => ({ ...c, dtdc: v }))} />
          <ToggleRow label="Ekart" on={couriers.ekart} onChange={(v) => setCouriers((c) => ({ ...c, ekart: v }))} />
          <div className="mt-4"><Field label="Free shipping threshold (₹)" type="number" defaultValue="25000" /></div>
          <SaveBar onSave={save} />
        </Card>
      )}

      {tab === "email" && (
        <Card title="Email (SMTP)">
          <div className="mb-3"><Badge tone="warning">Placeholder — connect real SMTP later</Badge></div>
          <div className="space-y-4">
            <Field label="SMTP host" placeholder="smtp.yourprovider.com" />
            <Field label="SMTP port" placeholder="587" type="number" />
            <Field label="Username" placeholder="notifications@zolopackaging.example" />
            <Field label="Password / API key" placeholder="•••••••• (stored securely by backend)" type="password" />
            <SaveBar onSave={save} />
          </div>
        </Card>
      )}

      {tab === "whatsapp" && (
        <Card title="WhatsApp Business API">
          <div className="mb-3"><Badge tone="warning">Placeholder — connect real provider later</Badge></div>
          <div className="space-y-4">
            <Field label="Provider" placeholder="e.g. Gupshup / Twilio" />
            <Field label="Business phone number" placeholder="+91 …" />
            <Field label="API key" placeholder="•••••••• (stored securely by backend)" type="password" />
            <SaveBar onSave={save} />
          </div>
        </Card>
      )}

      {tab === "theme" && (
        <Card title="Appearance">
          <p className="mb-3 text-xs erp-text-faint">Illustrative only — theme is controlled by your workspace shell.</p>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold erp-text-muted">Color scheme</legend>
            {["light", "dark", "system"].map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm erp-text">
                <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} className="accent-primary-500" />
                <span className="capitalize">{t}</span>
              </label>
            ))}
          </fieldset>
          <div className="mt-4">
            <span className="text-xs font-semibold erp-text-muted">Accent color</span>
            <div className="mt-2 flex gap-2">
              {ACCENTS.map((c) => (
                <button key={c} onClick={() => setAccent(c)} aria-label={`Accent ${c}`}
                  className={cn("h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-transparent", accent === c ? "ring-current" : "ring-transparent")}
                  style={{ backgroundColor: c, color: c }} />
              ))}
            </div>
          </div>
          <SaveBar onSave={save} />
        </Card>
      )}

      {tab === "api" && (
        <Card title="API access">
          <div className="mb-3"><Badge tone="info">Placeholder</Badge></div>
          <p className="text-sm erp-text-muted">API keys will connect this dashboard to the Zolo backend once the integration is live. The key below is a masked dummy for layout purposes only.</p>
          <div className="mt-4 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border erp-border erp-surface-2 px-3 py-2 font-mono text-xs erp-text-muted">zolo_sk_live_••••••••••••••••••••3a7f</code>
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => toast.success("Key regenerated", "A new API key has been issued (dummy).")}>Regenerate</Button>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs erp-text-faint">
            <Key className="h-3.5 w-3.5" aria-hidden />
            <span>Keys are never displayed in full after creation.</span>
          </div>
        </Card>
      )}
    </div>
  );
}
