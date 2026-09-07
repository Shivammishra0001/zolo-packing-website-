import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Lock, MapPin, Pencil, Plus, Star, Trash2, User } from "lucide-react";
import { Button, Dialog, PageHeader, Select, Tabs, type TabItem } from "@/admin/components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "@/admin/components/Panel";
import { INDIAN_STATES } from "@/lib/auth/constants";
import { useToast } from "@/components/ui/Toast";
import { useAuthSession } from "@/components/auth/AuthContext";
import * as authService from "@/lib/auth/service";
import { ApiError, describeApiError } from "@/lib/api/client";
import { addressApi, type Address, type AddressInput } from "@/lib/api/commerce";

// ============================================================
// Buyer Settings — profile, addresses and account security.
//
// Everything here talks to the REAL backend:
//   Profile   → PATCH /auth/me          (then the session context refreshes)
//   Addresses → /addresses CRUD          (the same book checkout uses)
//   Password  → POST /auth/change-password
//
// The previous version kept every field in local state and confirmed saves
// with a toast while persisting nothing — which is why the admin dashboard
// (reading the database) never saw customer edits.
// ============================================================

const INPUT =
  "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";
const LABEL = "text-xs font-semibold erp-text-muted";

type SettingsTab = "profile" | "addresses" | "account";

const TABS: TabItem[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "addresses", label: "Addresses", icon: MapPin },
  { key: "account", label: "Account", icon: Lock },
];

function Field({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={LABEL}>{label}</label>
      {children}
      {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
    </div>
  );
}

/** Map API failures onto a field-level or toast-level message. */
function saveErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "EMAIL_TAKEN") return "That email is already used by another account.";
    if (e.code === "PHONE_TAKEN") return "That phone number is already used by another account.";
    if (e.status === 400 && e.issues?.length) return e.issues.map((i) => i.message).join(" · ");
  }
  return describeApiError(e).message;
}

// ---------- Profile tab ----------

function ProfileTab() {
  const toast = useToast();
  const { user, refreshSession } = useAuthSession();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!firstName.trim()) {
      toast.error("Please check the highlighted fields", "First name is required.");
      return;
    }
    setSaving(true);
    try {
      await authService.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        email: email.trim(),
        phone: phone.trim() || null,
      });
      // Refresh the verified session so the account menu, checkout and every
      // other consumer shows the new values immediately.
      await refreshSession();
      toast.success("Profile updated successfully.");
    } catch (e) {
      toast.error("Unable to update your profile", saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Profile">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="fn">
          <input id="fn" className={INPUT} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Last name" htmlFor="ln">
          <input id="ln" className={INPUT} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="em">
          <input id="em" type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="ph">
          <input id="ph" type="tel" className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
        </Field>
      </div>
      <p className="mt-3 text-[11px] erp-text-faint">
        Email and phone are your sign-in identifiers. Your delivery details (address, city, state, pincode) live under Addresses.
      </p>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Panel>
  );
}

// ---------- Addresses tab ----------

const EMPTY_FORM: AddressInput = {
  kind: "shipping", name: "", phone: "", line1: "", line2: "", city: "", state: "",
  postalCode: "", country: "India", isDefault: false,
};

function validateAddress(f: AddressInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = "Enter the full name";
  if (!/^[6-9]\d{9}$/.test(f.phone.replace(/\D/g, "").slice(-10))) e.phone = "Enter a valid 10-digit mobile";
  if (f.line1.trim().length < 3) e.line1 = "Enter the address";
  if (!f.city.trim()) e.city = "Enter the city";
  if (!f.state.trim()) e.state = "Select the state";
  if (!/^[1-9][0-9]{5}$/.test(f.postalCode)) e.postalCode = "Enter a valid 6-digit pincode";
  return e;
}

function AddressesTab() {
  const toast = useToast();
  const { user } = useAuthSession();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: AddressInput } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setAddresses(await addressApi.list());
    } catch (e) {
      setAddresses(null);
      setError(describeApiError(e).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openNew = () =>
    setEditing({
      id: null,
      // Prefill the contact fields from the profile — the whole point of a
      // saved profile is not retyping your own name.
      form: {
        ...EMPTY_FORM,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
        phone: user?.phone ?? "",
        isDefault: (addresses?.length ?? 0) === 0,
      },
    });

  const openEdit = (a: Address) =>
    setEditing({
      id: a.id,
      form: {
        kind: a.kind, name: a.name, phone: a.phone, line1: a.line1, line2: a.line2 ?? "",
        city: a.city, state: a.state, postalCode: a.postalCode, country: a.country, isDefault: a.isDefault,
      },
    });

  const save = async () => {
    if (!editing) return;
    const errs = validateAddress(editing.form);
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Please check the highlighted fields");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...editing.form, phone: editing.form.phone.replace(/\D/g, "").slice(-10) };
      if (editing.id) {
        await addressApi.update(editing.id, payload);
        toast.success("Address updated successfully.");
      } else {
        await addressApi.create(payload);
        toast.success("Address saved successfully.");
      }
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(editing.id ? "Unable to update address" : "Unable to save address", saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Address) => {
    setBusy(true);
    try {
      await addressApi.remove(a.id);
      toast.success("Address deleted successfully.");
      await load();
    } catch (e) {
      toast.error("Unable to delete address", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (a: Address) => {
    setBusy(true);
    try {
      // The backend demotes every other default in the same transaction.
      await addressApi.update(a.id, { isDefault: true });
      toast.success("Default address updated.");
      await load();
    } catch (e) {
      toast.error("Unable to update default address", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const f = editing?.form;
  const setF = (patch: Partial<AddressInput>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });

  return (
    <Panel
      title="My addresses"
      action={
        <Button size="sm" variant="secondary" icon={Plus} onClick={openNew}>
          Add address
        </Button>
      }
    >
      {addresses === null && !error && <ListSkeleton rows={3} />}
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {addresses !== null && addresses.length === 0 && (
        <EmptyState
          icon={MapPin}
          title="No saved addresses"
          message="Add a delivery address once and checkout will fill it in automatically."
          action={<Button variant="primary" icon={Plus} onClick={openNew}>Add address</Button>}
        />
      )}

      {addresses !== null && addresses.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {addresses.map((a) => (
            <div key={a.id} className="rounded-xl border erp-border erp-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-dark-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide erp-text-muted dark:bg-white/10">
                  {a.kind}
                </span>
                {a.isDefault && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                    <Star className="h-3 w-3 fill-current" aria-hidden /> Default
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-bold erp-text">{a.name}</p>
              <p className="text-xs erp-text-muted">+91 {a.phone}</p>
              <p className="mt-1.5 text-sm erp-text-muted">
                {a.line1}{a.line2 ? `, ${a.line2}` : ""}
                <br />
                {a.city}, {a.state} — {a.postalCode}
                <br />
                {a.country}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => openEdit(a)}>Edit</Button>
                <Button size="sm" variant="secondary" icon={Trash2} disabled={busy} onClick={() => void remove(a)}>Delete</Button>
                {!a.isDefault && (
                  <Button size="sm" variant="ghost" icon={Star} disabled={busy} onClick={() => void setDefault(a)}>
                    Set default
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit address" : "Add address"}
        description="Saved to your account and used to autofill checkout and quotation requests."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save address"}
            </Button>
          </>
        }
      >
        {f && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full name" htmlFor="ad-name" error={fieldErrors.name}>
              <input id="ad-name" className={INPUT} value={f.name} onChange={(e) => setF({ name: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="ad-phone" error={fieldErrors.phone}>
              <input id="ad-phone" type="tel" className={INPUT} value={f.phone} onChange={(e) => setF({ phone: e.target.value })} placeholder="10-digit mobile" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address line 1" htmlFor="ad-l1" error={fieldErrors.line1}>
                <input id="ad-l1" className={INPUT} value={f.line1} onChange={(e) => setF({ line1: e.target.value })} placeholder="House / street" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Address line 2 (optional)" htmlFor="ad-l2">
                <input id="ad-l2" className={INPUT} value={f.line2 ?? ""} onChange={(e) => setF({ line2: e.target.value })} />
              </Field>
            </div>
            <Field label="City" htmlFor="ad-city" error={fieldErrors.city}>
              <input id="ad-city" className={INPUT} value={f.city} onChange={(e) => setF({ city: e.target.value })} />
            </Field>
            <Field label="State" error={fieldErrors.state}>
              <Select value={f.state} onChange={(v) => setF({ state: v })} aria-label="State" className="w-full">
                <option value="">Select state…</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Pincode" htmlFor="ad-pin" error={fieldErrors.postalCode}>
              <input id="ad-pin" inputMode="numeric" className={INPUT} value={f.postalCode} onChange={(e) => setF({ postalCode: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="6-digit" />
            </Field>
            <Field label="Type">
              <Select value={f.kind} onChange={(v) => setF({ kind: v as AddressInput["kind"] })} aria-label="Address type" className="w-full">
                <option value="shipping">Shipping</option>
                <option value="billing">Billing</option>
              </Select>
            </Field>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm erp-text">
              <input type="checkbox" checked={!!f.isDefault} onChange={(e) => setF({ isDefault: e.target.checked })} className="accent-primary-600" />
              Set as default address
            </label>
          </div>
        )}
      </Dialog>
    </Panel>
  );
}

// ---------- Account tab ----------

function AccountTab() {
  const toast = useToast();
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    if (!curPw || !newPw || !confirmPw) {
      toast.error("Please fill all password fields");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPw.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await authService.changePassword(curPw, newPw);
      setCurPw(""); setNewPw(""); setConfirmPw("");
      toast.success("Password updated", "Other signed-in devices have been logged out.");
    } catch (e) {
      const d = e instanceof ApiError && e.status === 401
        ? "Current password is incorrect."
        : describeApiError(e).message;
      toast.error("Unable to update password", d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Lock className="h-4 w-4 erp-text-muted" aria-hidden /> Change password
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current password" htmlFor="cpw">
          <input id="cpw" type="password" className={INPUT} value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" htmlFor="npw">
          <input id="npw" type="password" className={INPUT} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" htmlFor="cfpw">
          <input id="cfpw" type="password" className={INPUT} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <p className="mt-3 text-[11px] erp-text-faint">
        Changing your password signs out every other device; this session stays signed in.
      </p>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon={Lock} onClick={() => void savePassword()} disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </div>
    </Panel>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>("profile");
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Settings" }]}
        title="Settings"
        subtitle="Manage your profile, delivery addresses and account security."
      />
      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as SettingsTab)} />
      {tab === "profile" && <ProfileTab />}
      {tab === "addresses" && <AddressesTab />}
      {tab === "account" && <AccountTab />}
      {/* Business details (company / GSTIN) have no storage for buyer accounts
          yet — the previous tab pretended to save them. It returns when the
          backend stores organisation data for buyers. */}
    </div>
  );
}
