import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { adsensApi, AdsensError, type AdsensService, type ConsultationInput } from "../../lib/api/adsens";

// ============================================================
// AdSens consultation form (§10).
//
// The rules this form holds to:
//   * Success is only ever shown after the server confirms the lead was
//     saved and hands back a reference number. A network failure is an
//     error state, never a cheerful thank-you over a lost enquiry.
//   * Validation happens here AND on the server. The client version exists
//     to be kind about mistakes, not to be the gate.
//   * Double submission is blocked while a request is in flight, and the
//     server additionally de-duplicates identical enquiries.
//   * Consent is a real checkbox, unticked by default.
// ============================================================

const BUDGETS = [
  "Under ₹25,000 / month",
  "₹25,000 – ₹50,000 / month",
  "₹50,000 – ₹1,00,000 / month",
  "Over ₹1,00,000 / month",
  "Not decided yet",
];
const CONTACT_METHODS: { value: "phone" | "email" | "whatsapp"; label: string }[] = [
  { value: "phone", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
];
const TIMES = ["Morning (9am – 12pm)", "Afternoon (12pm – 4pm)", "Evening (4pm – 8pm)", "Anytime"];

const EMPTY = {
  fullName: "", phone: "", email: "",
  companyName: "", website: "", industry: "", location: "",
  budgetRange: "", challenges: "", requirement: "",
  bestTimeToContact: "",
};

type Errors = Partial<Record<keyof typeof EMPTY | "services" | "consent" | "form", string>>;

export function ConsultationForm({
  services,
  preselect,
}: {
  services: AdsensService[];
  /** Set when the visitor clicked "Get started" on a service or package. */
  preselect: { services?: string[]; packageId?: string } | null;
}) {
  const [form, setForm] = useState(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [packageId, setPackageId] = useState<string | undefined>();
  const [contact, setContact] = useState<"phone" | "email" | "whatsapp">("phone");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [reference, setReference] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // A "Get started" click adds that service to whatever is already ticked
  // rather than replacing it — the visitor may have chosen several.
  useEffect(() => {
    if (!preselect) return;
    if (preselect.services?.length) {
      setPicked((prev) => [...new Set([...prev, ...preselect.services!])]);
    }
    if (preselect.packageId) setPackageId(preselect.packageId);
    firstFieldRef.current?.focus({ preventScroll: true });
  }, [preselect]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((prev) => ({ ...prev, [k]: undefined, form: undefined }));
  };

  const toggleService = (slug: string) => {
    setPicked((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
    setErrors((prev) => ({ ...prev, services: undefined }));
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!form.fullName.trim()) e.fullName = "Please tell us your name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = "Enter a valid email address.";
    if (form.phone.replace(/\D/g, "").length < 10) e.phone = "Enter a valid 10-digit phone number.";
    if (!consent) e.consent = "Please agree to be contacted so we can reply.";
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (state === "sending") return; // double-submit guard

    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      // Move focus to the first problem so a keyboard user is not stranded.
      const first = document.querySelector<HTMLElement>("[data-field-error='true']");
      first?.focus?.();
      return;
    }

    setState("sending");
    setErrors({});
    const payload: ConsultationInput = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      companyName: form.companyName.trim() || undefined,
      website: form.website.trim() || undefined,
      industry: form.industry.trim() || undefined,
      location: form.location.trim() || undefined,
      services: picked.length ? picked : undefined,
      budgetRange: form.budgetRange || undefined,
      challenges: form.challenges.trim() || undefined,
      requirement: form.requirement.trim() || undefined,
      packageId,
      preferredContact: contact,
      bestTimeToContact: form.bestTimeToContact || undefined,
      consent: true,
    };

    try {
      const res = await adsensApi.submitConsultation(payload);
      // Only now — the server has the lead and gave us its reference.
      setReference(res.leadNumber);
      setState("done");
    } catch (err) {
      const e = err as AdsensError;
      setState("idle");
      setErrors({ form: e?.message ?? "We couldn't send your enquiry. Please try again." });
    }
  }

  if (state === "done") {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center" role="status">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
        <h3 className="mt-4 text-lg font-bold text-emerald-900">Thank you for contacting AdSens by Zolo!</h3>
        <p className="mt-2 text-sm leading-relaxed text-emerald-800">
          Your enquiry has been received successfully. Our team will review your requirements and contact you shortly.
        </p>
        {reference && (
          <p className="mt-4 text-sm text-emerald-900">
            Your reference: <span className="font-mono font-bold">{reference}</span>
          </p>
        )}
      </div>
    );
  }

  const sending = state === "sending";

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-[var(--ads-line)] bg-white p-6 sm:p-8">
      <Group title="Your details">
        <Field label="Full name" required error={errors.fullName}>
          <input ref={firstFieldRef} className={inputCls(errors.fullName)} value={form.fullName} onChange={set("fullName")}
            autoComplete="name" data-field-error={errors.fullName ? "true" : undefined} />
        </Field>
        <Field label="Phone number" required error={errors.phone}>
          <input className={inputCls(errors.phone)} value={form.phone} onChange={set("phone")} inputMode="tel"
            autoComplete="tel" placeholder="10-digit number" data-field-error={errors.phone ? "true" : undefined} />
        </Field>
        <Field label="Email address" required error={errors.email} className="sm:col-span-2">
          <input className={inputCls(errors.email)} value={form.email} onChange={set("email")} type="email"
            autoComplete="email" data-field-error={errors.email ? "true" : undefined} />
        </Field>
      </Group>

      <Group title="Your business">
        <Field label="Company / business name"><input className={inputCls()} value={form.companyName} onChange={set("companyName")} autoComplete="organization" /></Field>
        <Field label="Website (optional)"><input className={inputCls()} value={form.website} onChange={set("website")} placeholder="https://" /></Field>
        <Field label="Industry"><input className={inputCls()} value={form.industry} onChange={set("industry")} placeholder="e.g. Apparel, Food, Manufacturing" /></Field>
        <Field label="Business location"><input className={inputCls()} value={form.location} onChange={set("location")} placeholder="City, State" /></Field>
      </Group>

      <Group title="What you need">
        {services.length > 0 && (
          <div className="sm:col-span-2">
            <span className="mb-2 block text-xs font-semibold text-[var(--ads-muted)]">Services you're interested in</span>
            <div className="flex flex-wrap gap-2">
              {services.map((s) => {
                const on = picked.includes(s.slug);
                return (
                  <button
                    key={s.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleService(s.slug)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                      on
                        ? "border-[var(--ads-orange)] bg-[var(--ads-orange)] text-white"
                        : "border-[var(--ads-line)] bg-white text-[var(--ads-muted)] hover:border-[var(--ads-orange)]"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <Field label="Monthly marketing budget">
          <select className={inputCls()} value={form.budgetRange} onChange={set("budgetRange")}>
            <option value="">Select a range</option>
            {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Best time to contact">
          <select className={inputCls()} value={form.bestTimeToContact} onChange={set("bestTimeToContact")}>
            <option value="">Any time</option>
            {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Current marketing challenges" className="sm:col-span-2">
          <textarea className={`${inputCls()} min-h-20 resize-y`} value={form.challenges} onChange={set("challenges")}
            placeholder="What isn't working right now?" />
        </Field>
        <Field label="Brief about your requirement" className="sm:col-span-2">
          <textarea className={`${inputCls()} min-h-24 resize-y`} value={form.requirement} onChange={set("requirement")}
            placeholder="Tell us what you'd like to achieve." />
        </Field>
      </Group>

      <Group title="How should we reach you?">
        <div className="sm:col-span-2">
          <span className="mb-2 block text-xs font-semibold text-[var(--ads-muted)]">Preferred contact method</span>
          <div className="flex flex-wrap gap-2">
            {CONTACT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={contact === m.value}
                onClick={() => setContact(m.value)}
                className={`rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  contact === m.value
                    ? "border-[var(--ads-orange)] bg-[var(--ads-orange)] text-white"
                    : "border-[var(--ads-line)] bg-white text-[var(--ads-muted)] hover:border-[var(--ads-orange)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Group>

      <label className="mt-6 flex items-start gap-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => { setConsent(e.target.checked); setErrors((p) => ({ ...p, consent: undefined })); }}
          data-field-error={errors.consent ? "true" : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--ads-line)] accent-[var(--ads-orange)]"
        />
        <span className="text-sm leading-relaxed text-[var(--ads-muted)]">
          I agree to be contacted by the AdSens team about my enquiry.
          {errors.consent && <span className="mt-1 block text-xs font-medium text-red-600">{errors.consent}</span>}
        </span>
      </label>

      {errors.form && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700" role="alert">{errors.form}</p>
      )}

      <button type="submit" disabled={sending} className="btn btn-primary btn-lg mt-6 w-full sm:w-auto">
        {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {sending ? "Sending…" : "Request free consultation"}
      </button>
    </form>
  );
}

/* ---------- small helpers ---------- */

const inputCls = (err?: string) =>
  `w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[var(--ads-orange)] ${
    err ? "border-red-400" : "border-[var(--ads-line)]"
  }`;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-6 first:mt-0">
      <legend className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ads-muted)]">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label, required, error, children, className = "",
}: {
  label: string; required?: boolean; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold text-[var(--ads-muted)]">
        {label}{required && <span className="text-[var(--ads-orange)]"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>}
    </label>
  );
}
