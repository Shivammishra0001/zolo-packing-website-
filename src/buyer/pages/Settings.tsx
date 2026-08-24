import { useState, type ReactNode } from "react";
import { Building2, Lock, MapPin, Pencil, Plus, User } from "lucide-react";
import { Button, PageHeader, Select, Tabs, type TabItem } from "@/admin/components/ui";
import { Panel } from "@/admin/components/Panel";
import { useBuyerProfile } from "@/buyer/data";
import { INDIAN_STATES } from "@/lib/auth/constants";
import { useToast } from "@/components/ui/Toast";

// ============================================================
// Buyer Settings — profile, business, addresses and account preferences.
// All fields are local state seeded from the logged-in buyer's own profile.
// (Backend persistence is a TODO — Save actions confirm via toast.)
// ============================================================

const INPUT =
  "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";
const LABEL = "text-xs font-semibold erp-text-muted";

type SettingsTab = "profile" | "business" | "addresses" | "account";

const TABS: TabItem[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "business", label: "Business", icon: Building2 },
  { key: "addresses", label: "Addresses", icon: MapPin },
  { key: "account", label: "Account", icon: Lock },
];

// ---------- Field wrapper ----------

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------- Toggle switch (local, accessible) ----------

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 " +
        (checked ? "bg-primary-500" : "erp-surface-2 border erp-border")
      }
    >
      <span
        className={
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform " +
          (checked ? "translate-x-6" : "translate-x-1")
        }
        aria-hidden
      />
    </button>
  );
}

export default function Settings() {
  const toast = useToast();
  const profile = useBuyerProfile();
  const [tab, setTab] = useState<SettingsTab>("profile");

  // ---- Profile ----
  const [firstName, setFirstName] = useState(profile.firstName === "there" ? "" : profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [email, setEmail] = useState(profile.email);
  const [phone, setPhone] = useState(profile.phone);
  const [state, setState] = useState(profile.state);

  // ---- Business ----
  const [company, setCompany] = useState(profile.company);
  const [gstin, setGstin] = useState(profile.gstin);

  // ---- Addresses ----
  const [billing, setBilling] = useState(
    profile.city ? `${profile.company || profile.name}\n${profile.city}, ${profile.state || ""}`.trim() : "",
  );
  const [shipDefault, setShipDefault] = useState(
    profile.city ? `${profile.company || profile.name}\n${profile.city}, ${profile.state || ""}`.trim() : "",
  );

  // ---- Account ----
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [prefs, setPrefs] = useState({
    orderUpdates: true,
    quotationReplies: true,
    promotions: false,
    recycleReminders: true,
  });

  const savePassword = () => {
    if (!curPw || !newPw || !confirmPw) {
      toast.error("Please fill all password fields");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("New passwords do not match");
      return;
    }
    setCurPw("");
    setNewPw("");
    setConfirmPw("");
    toast.success("Password updated");
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Settings" }]}
        title="Settings"
        subtitle="Manage your profile, business details and preferences."
      />

      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as SettingsTab)} />

      {/* -------- Profile -------- */}
      {tab === "profile" && (
        <Panel title="Profile">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="fn">
              <input id="fn" className={INPUT} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Last name" htmlFor="ln">
              <input id="ln" className={INPUT} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="em">
              <input
                id="em"
                type="email"
                className={INPUT}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Phone" htmlFor="ph">
              <input id="ph" type="tel" className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="State">
              <Select value={state} onChange={setState} aria-label="State" className="w-full">
                <option value="">Select state…</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={() => toast.success("Saved")}>
              Save changes
            </Button>
          </div>
        </Panel>
      )}

      {/* -------- Business -------- */}
      {tab === "business" && (
        <Panel title="Business details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="co">
              <input id="co" className={INPUT} value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
            <Field label="GSTIN" htmlFor="gst">
              <input
                id="gst"
                className={INPUT}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
              />
            </Field>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={() => toast.success("Saved")}>
              Save changes
            </Button>
          </div>
        </Panel>
      )}

      {/* -------- Addresses -------- */}
      {tab === "addresses" && (
        <div className="space-y-5">
          <Panel title="Billing address">
            <Field label="Billing address" htmlFor="bill">
              <textarea
                id="bill"
                rows={3}
                className={INPUT + " h-auto py-2 leading-relaxed"}
                value={billing}
                onChange={(e) => setBilling(e.target.value)}
                placeholder="Company, street, city, state, PIN"
              />
            </Field>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={() => toast.success("Saved")}>
                Save billing address
              </Button>
            </div>
          </Panel>

          <Panel
            title="Shipping addresses"
            action={
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => toast.info("Add address — coming soon")}>
                Add address
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="rounded-xl border erp-border erp-surface p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary-500" aria-hidden />
                    <span className="text-sm font-bold erp-text">Default shipping address</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Pencil}
                    onClick={() => toast.info("Edit shipping address — coming soon")}
                  >
                    Edit
                  </Button>
                </div>
                <textarea
                  rows={3}
                  aria-label="Default shipping address"
                  className={INPUT + " h-auto py-2 leading-relaxed"}
                  value={shipDefault}
                  onChange={(e) => setShipDefault(e.target.value)}
                  placeholder="Company, street, city, state, PIN"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={() => toast.success("Saved")}>
                Save shipping address
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {/* -------- Account -------- */}
      {tab === "account" && (
        <div className="space-y-5">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Lock className="h-4 w-4 erp-text-muted" aria-hidden /> Change password
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Current password" htmlFor="cpw">
                <input
                  id="cpw"
                  type="password"
                  className={INPUT}
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <Field label="New password" htmlFor="npw">
                <input
                  id="npw"
                  type="password"
                  className={INPUT}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm new password" htmlFor="cfpw">
                <input
                  id="cfpw"
                  type="password"
                  className={INPUT}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <p className="mt-3 text-[11px] erp-text-faint">
              This is a placeholder — password changes are not yet persisted pending backend integration.
            </p>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" icon={Lock} onClick={savePassword}>
                Update password
              </Button>
            </div>
          </Panel>

          <Panel title="Notification preferences">
            <ul className="divide-y erp-border-soft">
              {(
                [
                  ["orderUpdates", "Order updates", "Status changes and delivery notifications for your orders."],
                  ["quotationReplies", "Quotation replies", "When we respond to your quotation requests."],
                  ["promotions", "Promotions", "Occasional offers and product announcements."],
                  ["recycleReminders", "Recycle reminders", "Pickup reminders and eco-reward updates."],
                ] as const
              ).map(([key, title, desc]) => (
                <li key={key} className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold erp-text">{title}</p>
                    <p className="text-xs erp-text-muted">{desc}</p>
                  </div>
                  <Switch
                    checked={prefs[key]}
                    onChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))}
                    label={title}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" onClick={() => toast.success("Saved")}>
                Save preferences
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
