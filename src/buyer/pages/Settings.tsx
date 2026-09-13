import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Building2, Camera, Lock, MapPin, Pencil, Plus, Star, Trash2, User } from "lucide-react";
import { Button, Dialog, PageHeader, Select, Tabs, type TabItem } from "@/admin/components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "@/admin/components/Panel";
import { INDIAN_STATES } from "@/lib/auth/constants";
import { useToast } from "@/components/ui/Toast";
import { useAuthSession } from "@/components/auth/AuthContext";
import * as authService from "@/lib/auth/service";
import { ApiError, describeApiError } from "@/lib/api/client";
import { addressApi, type Address, type AddressInput } from "@/lib/api/commerce";

// ============================================================
// Buyer Settings — profile (with photo), business details, addresses,
// notification preferences and account security.
//
// Everything here talks to the REAL backend — nothing is held only in React:
//   Profile / Business / Preferences → PATCH /auth/me  (then the session refreshes)
//   Photo                            → POST / DELETE /auth/me/photo
//   Addresses                        → /addresses CRUD (+ /:id/default)
//   Password                         → POST /auth/change-password
// Admin → Customers reads the same rows, so every save is visible there too.
// ============================================================

const INPUT =
  "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";
const LABEL = "text-xs font-semibold erp-text-muted";

type SettingsTab = "profile" | "business" | "addresses" | "preferences" | "account";

const TABS: TabItem[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "business", label: "Business", icon: Building2 },
  { key: "addresses", label: "Addresses", icon: MapPin },
  { key: "preferences", label: "Preferences", icon: Bell },
  { key: "account", label: "Account", icon: Lock },
];

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={LABEL}>{label}</label>
      {children}
      {error ? <p className="text-xs font-semibold text-red-600" role="alert">{error}</p> : hint ? <p className="text-[11px] erp-text-faint">{hint}</p> : null}
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

const initialsOf = (first?: string, last?: string, email?: string) =>
  `${first?.[0] ?? email?.[0] ?? "U"}${last?.[0] ?? ""}`.toUpperCase();

// ---------- Profile tab (photo + identity + contact) ----------

function ProfilePhoto() {
  const toast = useToast();
  const { user, refreshSession } = useAuthSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Revoke object URLs so previews never leak.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy("upload");
    try {
      await authService.uploadPhoto(file);
      await refreshSession(); // header, dashboard and admin all read the new URL
      toast.success("Profile photo updated.");
    } catch (e) {
      toast.error("Couldn't upload photo", e instanceof Error ? e.message : saveErrorMessage(e));
    } finally {
      setBusy(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await authService.removePhoto();
      await refreshSession();
      toast.success("Profile photo removed.");
    } catch (e) {
      toast.error("Couldn't remove photo", saveErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const shown = preview ?? user?.avatarUrl ?? null;
  const hasPhoto = Boolean(user?.avatarUrl);

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
      <div className="relative">
        {shown ? (
          <img src={shown} alt="Profile photo" className={`h-20 w-20 rounded-full object-cover ring-2 ring-primary-100 ${busy ? "opacity-60" : ""}`} />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-amber-400 text-xl font-bold text-white">
            {initialsOf(user?.firstName, user?.lastName, user?.email)}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30 text-[10px] font-bold text-white">
            {busy === "upload" ? "Uploading…" : "Removing…"}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={Camera} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {hasPhoto ? "Replace photo" : "Upload photo"}
          </Button>
          {hasPhoto && (
            <Button size="sm" variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-[11px] erp-text-faint">JPG, PNG or WebP · up to 5 MB. Shown on your account, orders and to our team.</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => void pick(e.target.files?.[0])}
          aria-label="Choose a profile photo"
        />
      </div>
    </div>
  );
}

function ProfileTab() {
  const toast = useToast();
  const { user, refreshSession } = useAuthSession();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", alternatePhone: "", dateOfBirth: "", gender: "" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed (and re-seed) from the verified session — it can resolve after first
  // paint, and it refreshes after every save. Never clobber unsaved typing.
  useEffect(() => {
    if (!user || dirty) return;
    setForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
      alternatePhone: user.alternatePhone ?? "",
      dateOfBirth: user.dateOfBirth ?? "",
      gender: user.gender ?? "",
    });
  }, [user, dirty]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };
  const setGender = (v: string) => {
    setDirty(true);
    setForm((f) => ({ ...f, gender: v }));
  };
  const today = new Date().toISOString().slice(0, 10);

  const save = async () => {
    if (!form.firstName.trim()) {
      toast.error("Please check the highlighted fields", "First name is required.");
      return;
    }
    setSaving(true);
    try {
      await authService.updateProfile({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        alternatePhone: form.alternatePhone.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
      });
      setDirty(false);
      await refreshSession();
      toast.success("Profile updated successfully.");
    } catch (e) {
      toast.error("Unable to update your profile", saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <ListSkeleton rows={4} />;

  return (
    <div className="space-y-5">
      <Panel title="Profile photo">
        <ProfilePhoto />
      </Panel>
      <Panel title="Profile">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name *" htmlFor="fn">
            <input id="fn" className={INPUT} value={form.firstName} onChange={set("firstName")} />
          </Field>
          <Field label="Last name" htmlFor="ln">
            <input id="ln" className={INPUT} value={form.lastName} onChange={set("lastName")} />
          </Field>
          <Field label="Email *" htmlFor="em">
            <input id="em" type="email" className={INPUT} value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone *" htmlFor="ph">
            <input id="ph" type="tel" className={INPUT} value={form.phone} onChange={set("phone")} placeholder="10-digit mobile" />
          </Field>
          <Field label="Alternate phone" htmlFor="aph" hint="Optional second number our team can reach you on.">
            <input id="aph" type="tel" className={INPUT} value={form.alternatePhone} onChange={set("alternatePhone")} placeholder="10-digit mobile" />
          </Field>
          <Field label="Date of birth" htmlFor="dob">
            <input id="dob" type="date" className={INPUT} value={form.dateOfBirth} onChange={set("dateOfBirth")} max={today} min="1900-01-01" />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={setGender} aria-label="Gender" className="w-full">
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-[11px] erp-text-faint">
          Email and phone are your sign-in identifiers. Your delivery details (address, city, state, pincode) live under Addresses.
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Business tab ----------

const BUSINESS_TYPES = ["Manufacturer", "Trader / Wholesaler", "Retailer", "D2C Brand", "Restaurant / Food Service", "E-commerce Seller", "Agency / Consultant", "Individual", "Other"];
const INDUSTRIES = ["Food & Beverage", "Cosmetics & Personal Care", "Pharma & Healthcare", "Electronics", "Apparel & Fashion", "E-commerce", "FMCG", "Industrial", "Gifting", "Other"];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function BusinessTab() {
  const toast = useToast();
  const { user, refreshSession } = useAuthSession();
  const [form, setForm] = useState({ company: "", businessType: "", industry: "", gstin: "", pan: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || dirty) return;
    setForm({
      company: user.company ?? "",
      businessType: user.businessType ?? "",
      industry: user.industry ?? "",
      gstin: user.gstin ?? "",
      pan: user.pan ?? "",
      website: user.website ?? "",
    });
  }, [user, dirty]);

  const patch = (p: Partial<typeof form>) => {
    setDirty(true);
    setForm((f) => ({ ...f, ...p }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.company.trim()) e.company = "Company / business name is required";
    const g = form.gstin.trim().toUpperCase();
    if (g && !GSTIN_RE.test(g)) e.gstin = "Enter a valid 15-character GSTIN";
    const p = form.pan.trim().toUpperCase();
    if (p && !PAN_RE.test(p)) e.pan = "Enter a valid 10-character PAN";
    const w = form.website.trim();
    if (w && !/^https?:\/\/\S+\.\S+/.test(w)) e.website = "Enter a full URL, e.g. https://example.com";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) {
      toast.error("Please check the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      await authService.updateProfile({
        company: form.company.trim(),
        businessType: form.businessType || null,
        industry: form.industry || null,
        gstin: form.gstin.trim().toUpperCase() || null,
        pan: form.pan.trim().toUpperCase() || null,
        website: form.website.trim() || null,
      });
      setDirty(false);
      await refreshSession();
      toast.success("Business details updated successfully.");
    } catch (e) {
      toast.error("Unable to update business details", saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <ListSkeleton rows={4} />;

  return (
    <Panel title="Business details">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Company / Business name *" htmlFor="co" error={errors.company}>
            <input id="co" className={INPUT} value={form.company} onChange={(e) => patch({ company: e.target.value })} placeholder="Acme Packaging Pvt. Ltd." />
          </Field>
        </div>
        <Field label="Business type">
          <Select value={form.businessType} onChange={(v) => patch({ businessType: v })} aria-label="Business type" className="w-full">
            <option value="">Select…</option>
            {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Industry">
          <Select value={form.industry} onChange={(v) => patch({ industry: v })} aria-label="Industry" className="w-full">
            <option value="">Select…</option>
            {INDUSTRIES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="GSTIN" htmlFor="gst" error={errors.gstin} hint="15 characters, e.g. 27ABCDE1234F1Z5. Used on your invoices.">
          <input id="gst" className={`${INPUT} uppercase`} value={form.gstin} onChange={(e) => patch({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
        </Field>
        <Field label="PAN" htmlFor="pan" error={errors.pan} hint="10 characters, e.g. ABCDE1234F.">
          <input id="pan" className={`${INPUT} uppercase`} value={form.pan} onChange={(e) => patch({ pan: e.target.value.toUpperCase() })} maxLength={10} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Website" htmlFor="web" error={errors.website}>
            <input id="web" type="url" className={INPUT} value={form.website} onChange={(e) => patch({ website: e.target.value })} placeholder="https://" />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Panel>
  );
}

// ---------- Preferences tab ----------

const PREFERENCES: { key: string; label: string; desc: string; defaultOn: boolean }[] = [
  { key: "orderUpdates", label: "Order updates", desc: "Confirmation, shipping and delivery status for your orders.", defaultOn: true },
  { key: "rfqUpdates", label: "Quotation updates", desc: "New quotations, revisions and replies on your bulk quote requests.", defaultOn: true },
  { key: "returnUpdates", label: "Returns & recycling", desc: "Progress on return requests and recycling points.", defaultOn: true },
  { key: "promotions", label: "Offers & news", desc: "Occasional promotions and new packaging products.", defaultOn: false },
  { key: "whatsapp", label: "WhatsApp messages", desc: "Receive the above on WhatsApp as well as email.", defaultOn: true },
  { key: "sms", label: "SMS alerts", desc: "Short text alerts for time-critical updates.", defaultOn: false },
];

function PreferencesTab() {
  const toast = useToast();
  const { user, refreshSession } = useAuthSession();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || dirty) return;
    const stored = user.preferences ?? {};
    setPrefs(Object.fromEntries(PREFERENCES.map((p) => [p.key, stored[p.key] ?? p.defaultOn])));
  }, [user, dirty]);

  const toggle = (k: string) => {
    setDirty(true);
    setPrefs((p) => ({ ...p, [k]: !p[k] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await authService.updateProfile({ preferences: prefs });
      setDirty(false);
      await refreshSession();
      toast.success("Preferences saved.");
    } catch (e) {
      toast.error("Unable to save preferences", saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <ListSkeleton rows={4} />;

  return (
    <Panel title="Notifications & communication">
      <ul className="divide-y erp-border-soft">
        {PREFERENCES.map((p) => {
          const on = prefs[p.key] ?? p.defaultOn;
          return (
            <li key={p.key} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold erp-text">{p.label}</p>
                <p className="text-xs erp-text-muted">{p.desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={p.label}
                onClick={() => toggle(p.key)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary-500" : "bg-dark-200 dark:bg-white/20"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "left-0.5 translate-x-5" : "left-0.5"}`} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </Panel>
  );
}

// ---------- Addresses tab ----------

const EMPTY_FORM: AddressInput = {
  kind: "shipping", label: "", name: "", phone: "", line1: "", line2: "", city: "", state: "",
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
        kind: a.kind, label: a.label ?? "", name: a.name, phone: a.phone, line1: a.line1, line2: a.line2 ?? "",
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
      const payload = {
        ...editing.form,
        label: editing.form.label?.trim() || null,
        phone: editing.form.phone.replace(/\D/g, "").slice(-10),
      };
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
    if (!window.confirm(`Delete the ${a.label || a.kind} address for ${a.name}? This can't be undone.`)) return;
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
      // Per kind: one default shipping AND one default billing address.
      await addressApi.setDefault(a.id);
      toast.success(`Default ${a.kind} address updated.`);
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
        <>
          <p className="mb-3 text-[11px] erp-text-faint">
            You can keep one default <b>shipping</b> address and one default <b>billing</b> address. Checkout uses both automatically.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {addresses.map((a) => (
              <div key={a.id} className="rounded-xl border erp-border erp-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="rounded-full bg-dark-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide erp-text-muted dark:bg-white/10">
                      {a.kind}
                    </span>
                    {a.label && <span className="text-xs font-semibold erp-text">{a.label}</span>}
                  </span>
                  {a.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                      <Star className="h-3 w-3 fill-current" aria-hidden /> Default {a.kind}
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
                      Set default {a.kind}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
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
            <Field label="Label (optional)" htmlFor="ad-label">
              <input id="ad-label" className={INPUT} value={f.label ?? ""} onChange={(e) => setF({ label: e.target.value })} placeholder="Home, Office, Warehouse…" maxLength={40} />
            </Field>
            <Field label="Type">
              <Select value={f.kind} onChange={(v) => setF({ kind: v as AddressInput["kind"] })} aria-label="Address type" className="w-full">
                <option value="shipping">Shipping</option>
                <option value="billing">Billing</option>
              </Select>
            </Field>
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
            <Field label="Country" htmlFor="ad-country">
              <input id="ad-country" className={INPUT} value={f.country} onChange={(e) => setF({ country: e.target.value })} />
            </Field>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm erp-text">
              <input type="checkbox" checked={!!f.isDefault} onChange={(e) => setF({ isDefault: e.target.checked })} className="accent-primary-600" />
              Set as default {f.kind} address
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
        subtitle="Manage your profile, business details, delivery addresses, notifications and account security."
      />
      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as SettingsTab)} />
      {tab === "profile" && <ProfileTab />}
      {tab === "business" && <BusinessTab />}
      {tab === "addresses" && <AddressesTab />}
      {tab === "preferences" && <PreferencesTab />}
      {tab === "account" && <AccountTab />}
    </div>
  );
}
