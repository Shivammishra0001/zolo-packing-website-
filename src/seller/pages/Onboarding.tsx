// Supplier application — ONE form.
//
// This replaced an eleven-step wizard (business, legal, locations,
// capabilities, capacity, certifications, documents, bank, quality,
// logistics). Nothing reached an admin until every required step was done, so
// most applications were abandoned part-way and sat as unreviewable drafts.
//
// Everything here is submitted in a single request and a single transaction,
// so an application either exists in full or not at all.
//
// Not asked for, deliberately: GST and PAN (many small packaging suppliers are
// not registered, and blocking signup on a number they do not have loses real
// suppliers), and email (the account is keyed on the phone number used to log
// in). Both still exist on the model for an admin to fill in later.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onboardingApi } from "../onboarding-api";
import { ApiError } from "../api";
import { Card, Button, Field, Input, Alert, StatusPill } from "../ui";

/** Shown as chips; a supplier can also type their own. */
const SUGGESTED_CATEGORIES = [
  "Corrugated Boxes",
  "Kraft Boxes",
  "Paper Bags",
  "Food Packaging",
  "Bottles & Containers",
  "Labels & Stickers",
  "Protective Packaging",
  "Gift Packaging",
  "Flexible Packaging",
  "Tapes",
];

const EMPTY = {
  contactName: "",
  companyName: "",
  website: "",
  contactPhone: "",
  addressLine: "",
  city: "",
  state: "",
  postalCode: "",
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
};

export default function Onboarding() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [categories, setCategories] = useState<string[]>([]);
  const [customCategory, setCustomCategory] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Prefill from whatever the account already has, so a supplier returning
  // after a change request is not retyping their own name.
  useEffect(() => {
    let cancelled = false;
    onboardingApi
      .get()
      .then((p) => {
        if (cancelled) return;
        setStatus(p.status);
        setForm((f) => ({
          ...f,
          contactName: p.contactName ?? "",
          companyName: p.displayName ?? "",
          website: p.website ?? "",
          contactPhone: p.contactPhone ?? "",
        }));
      })
      .catch(() => {
        // A missing profile is not fatal — the form still submits and the
        // server creates what it needs.
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleCategory = (c: string) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  function addCustomCategory() {
    const v = customCategory.trim();
    if (!v || categories.includes(v)) return;
    setCategories((prev) => [...prev, v]);
    setCustomCategory("");
  }

  // Mirrors the server's rule. The server is still the authority — this just
  // avoids a round trip to learn something the form already knows.
  const canSubmit = useMemo(
    () =>
      form.contactName.trim() !== "" &&
      form.companyName.trim() !== "" &&
      form.contactPhone.replace(/\D/g, "").length >= 10 &&
      form.addressLine.trim() !== "" &&
      categories.length > 0 &&
      !busy,
    [form, categories, busy],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const bankTouched = form.accountNumber.trim() || form.ifsc.trim() || form.bankName.trim();
      await onboardingApi.apply({
        contactName: form.contactName.trim(),
        companyName: form.companyName.trim(),
        website: form.website.trim() || undefined,
        contactPhone: form.contactPhone.trim(),
        addressLine: form.addressLine.trim(),
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        postalCode: form.postalCode.trim() || undefined,
        categories,
        bank: bankTouched
          ? {
              accountHolderName: form.accountHolderName.trim(),
              bankName: form.bankName.trim(),
              accountNumber: form.accountNumber.trim(),
              ifsc: form.ifsc.trim(),
            }
          : undefined,
      });
      navigate("/seller/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues?.[0]?.message ?? err.message) : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card><p className="py-8 text-center text-sm text-slate-500">Loading…</p></Card>
      </div>
    );
  }

  // Already with the admin: show where it stands rather than a form that would
  // overwrite what is being reviewed.
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "APPROVED") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <div className="py-6 text-center">
            <StatusPill status={status} />
            <h1 className="mt-4 text-xl font-bold text-slate-900">
              {status === "APPROVED" ? "You're approved" : "Application under review"}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
              {status === "APPROVED"
                ? "Your supplier account is active. Head to your dashboard to start receiving enquiries."
                : "Our team is reviewing your details. You'll be notified as soon as a decision is made."}
            </p>
            <div className="mt-5">
              <Button onClick={() => navigate("/seller/dashboard")}>Go to dashboard</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Become a Zolo supplier</h1>
        <p className="mt-1 text-sm text-slate-500">
          One short form. We review it and get back to you — no documents needed to apply.
        </p>
      </div>

      {status === "CHANGES_REQUESTED" && (
        <div className="mb-4">
          <Alert tone="warn" title="Changes requested">
            Update your details below and submit again.
          </Alert>
        </div>
      )}
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}

      <form onSubmit={submit} className="space-y-5">
        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">Your details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier name" required>
              <Input value={form.contactName} onChange={set("contactName")} required placeholder="Ravi Kumar" autoComplete="name" />
            </Field>
            <Field label="Company name" required>
              <Input value={form.companyName} onChange={set("companyName")} required placeholder="Kumar Packaging Pvt Ltd" autoComplete="organization" />
            </Field>
            <Field label="Contact number" required hint="You'll use this number to sign in">
              <Input value={form.contactPhone} onChange={set("contactPhone")} required inputMode="tel" placeholder="98765 43210" autoComplete="tel" />
            </Field>
            <Field label="Website">
              <Input value={form.website} onChange={set("website")} inputMode="url" placeholder="https://example.com" autoComplete="url" />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">Address</h2>
          <div className="space-y-4">
            <Field label="Address" required>
              <Input value={form.addressLine} onChange={set("addressLine")} required placeholder="12 Industrial Estate" autoComplete="street-address" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City"><Input value={form.city} onChange={set("city")} placeholder="Pune" /></Field>
              <Field label="State"><Input value={form.state} onChange={set("state")} placeholder="Maharashtra" /></Field>
              <Field label="PIN code"><Input value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" placeholder="411001" /></Field>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">
            Product categories <span className="text-red-500">*</span>
          </h2>
          <p className="mb-3 text-xs text-slate-500">What do you manufacture? Pick all that apply.</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_CATEGORIES.map((c) => {
              const on = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    on
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          {/* A supplier's own words matter more than our taxonomy. */}
          <div className="mt-4 flex gap-2">
            <Input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomCategory(); } }}
              placeholder="Something else? Type it here"
            />
            <Button type="button" variant="secondary" onClick={addCustomCategory} disabled={!customCategory.trim()}>
              Add
            </Button>
          </div>

          {categories.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Selected: <span className="font-semibold text-slate-700">{categories.join(", ")}</span>
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">Account details</h2>
          <p className="mb-4 text-xs text-slate-500">
            Optional — you can add these later. We need them before we can pay you.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account holder name">
              <Input value={form.accountHolderName} onChange={set("accountHolderName")} placeholder="Kumar Packaging Pvt Ltd" />
            </Field>
            <Field label="Bank name">
              <Input value={form.bankName} onChange={set("bankName")} placeholder="HDFC Bank" />
            </Field>
            <Field label="Account number">
              <Input value={form.accountNumber} onChange={set("accountNumber")} inputMode="numeric" autoComplete="off" placeholder="XXXXXXXXXXXX" />
            </Field>
            <Field label="IFSC code">
              <Input value={form.ifsc} onChange={set("ifsc")} autoComplete="off" placeholder="HDFC0001234" />
            </Field>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            We'll review your application and let you know by phone.
          </p>
          <Button type="submit" disabled={!canSubmit}>
            {busy ? "Submitting…" : "Submit application"}
          </Button>
        </div>
      </form>
    </div>
  );
}
