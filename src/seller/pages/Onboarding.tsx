// Seller onboarding wizard. Multi-step, autosaving, resumable. The server's
// completeness check is authoritative — the review step + submit gate mirror it.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOnboarding } from "../useOnboarding";
import { Card, Button, StatusPill, Alert } from "../ui";
import {
  BusinessStep, LegalStep, LocationsStep, CapabilitiesStep, CapacityStep,
  CertificationsStep, DocumentsStep, BankStep, QualityStep, LogisticsStep,
} from "../steps";
import type { OnboardingProfile } from "../onboarding-api";

// Step definitions. `section` maps to the server completeness key (for the
// required badge); steps without a required section are optional.
const STEPS: { key: string; title: string; section?: string; Component: any }[] = [
  { key: "business", title: "Business Details", section: "business", Component: BusinessStep },
  { key: "legal", title: "Legal & Tax", section: "legal", Component: LegalStep },
  { key: "locations", title: "Locations", section: "locations", Component: LocationsStep },
  { key: "capabilities", title: "Capabilities", section: "capabilities", Component: CapabilitiesStep },
  { key: "capacity", title: "Capacity", section: "capacity", Component: CapacityStep },
  { key: "certifications", title: "Certifications", Component: CertificationsStep },
  { key: "documents", title: "Documents", section: "documents", Component: DocumentsStep },
  { key: "bank", title: "Bank Details", section: "bank", Component: BankStep },
  { key: "quality", title: "Quality", Component: QualityStep },
  { key: "logistics", title: "Logistics", Component: LogisticsStep },
];

const SaveIndicator = ({ state }: { state: string }) => {
  const map: Record<string, { t: string; c: string }> = {
    idle: { t: "", c: "" },
    saving: { t: "Saving…", c: "text-slate-400" },
    saved: { t: "✓ Saved", c: "text-emerald-600" },
    error: { t: "⚠ Save failed", c: "text-red-600" },
  };
  const s = map[state] ?? map.idle;
  return <span className={`text-xs ${s.c}`}>{s.t}</span>;
};

export default function Onboarding() {
  const { profile, loading, error, saveState, updateField, mutate, flush, submit, setError } = useOnboarding();
  const [stepIndex, setStepIndex] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-slate-400">Loading your application…</div>;
  if (!profile) return <div className="p-8"><Alert tone="error">{error ?? "No supplier profile found."}</Alert></div>;

  const readOnly = !["DRAFT", "CHANGES_REQUESTED"].includes(profile.status);
  const completeness = profile.completeness;
  const openCR = profile.changeRequests?.[0];

  async function goto(i: number) { await flush(); setStepIndex(i); setShowReview(false); }

  async function onSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await submit();
      navigate("/seller/dashboard");
    } catch { /* error surfaced by hook */ } finally {
      setSubmitting(false);
    }
  }

  const Step = STEPS[stepIndex].Component;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Supplier onboarding</h1>
          <p className="text-sm text-slate-500">{profile.displayName || "Your company"} · <StatusPill status={profile.status} /></p>
        </div>
        <SaveIndicator state={saveState} />
      </header>

      {readOnly && (
        <div className="mb-5"><Alert tone="info" title="Read-only">
          Your application is <b>{profile.status.replace(/_/g, " ").toLowerCase()}</b> and can't be edited right now.
        </Alert></div>
      )}
      {profile.status === "CHANGES_REQUESTED" && openCR && (
        <div className="mb-5"><Alert tone="warn" title="Changes requested by our team">
          <ul className="mt-1 list-disc pl-5">
            {openCR.issues.map((it, i) => <li key={i}><b>{it.section}:</b> {it.message}</li>)}
          </ul>
          <p className="mt-2">Update the relevant sections and resubmit.</p>
        </Alert></div>
      )}
      {error && <div className="mb-5"><Alert tone="error">{error}</Alert></div>}

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        {/* Step nav */}
        <nav className="space-y-1">
          {STEPS.map((s, i) => {
            const done = s.section ? completeness.sections[s.section] : undefined;
            return (
              <button key={s.key} onClick={() => goto(i)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${i === stepIndex && !showReview ? "bg-orange-50 font-semibold text-orange-700" : "text-slate-600 hover:bg-slate-100"}`}>
                <span>{i + 1}. {s.title}{s.section && completeness.required.includes(s.section) && <span className="text-orange-500"> *</span>}</span>
                {done === true && <span className="text-emerald-500">✓</span>}
                {done === false && s.section && completeness.required.includes(s.section) && <span className="text-amber-500">!</span>}
              </button>
            );
          })}
          <button onClick={async () => { await flush(); setShowReview(true); }}
            className={`mt-2 flex w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${showReview ? "bg-orange-50 text-orange-700" : "text-slate-700 hover:bg-slate-100"}`}>
            Review &amp; Submit
          </button>
        </nav>

        {/* Step content */}
        <div>
          {showReview ? (
            <ReviewStep profile={profile} onEdit={(section) => {
              const idx = STEPS.findIndex((s) => s.section === section || s.key === section);
              if (idx >= 0) goto(idx);
            }} onSubmit={onSubmit} submitting={submitting} readOnly={readOnly} />
          ) : (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">{STEPS[stepIndex].title}</h2>
              <Step profile={profile} updateField={updateField} mutate={mutate} readOnly={readOnly} />
              <div className="mt-6 flex justify-between border-t border-slate-100 pt-4">
                <Button variant="secondary" disabled={stepIndex === 0} onClick={() => goto(stepIndex - 1)}>Back</Button>
                {stepIndex < STEPS.length - 1
                  ? <Button onClick={() => goto(stepIndex + 1)}>Save &amp; continue</Button>
                  : <Button onClick={async () => { await flush(); setShowReview(true); }}>Go to review</Button>}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStep({ profile, onEdit, onSubmit, submitting, readOnly }: {
  profile: OnboardingProfile; onEdit: (section: string) => void; onSubmit: () => void; submitting: boolean; readOnly: boolean;
}) {
  const c = profile.completeness;
  const rows: { section: string; label: string; ok: boolean; required: boolean }[] = [
    { section: "business", label: "Business details", ok: c.sections.business, required: true },
    { section: "legal", label: "Legal & tax", ok: c.sections.legal, required: true },
    { section: "locations", label: "Locations", ok: c.sections.locations, required: true },
    { section: "capabilities", label: "Capabilities", ok: c.sections.capabilities, required: true },
    { section: "capacity", label: "Capacity", ok: c.sections.capacity, required: false },
    { section: "documents", label: "Documents", ok: c.sections.documents, required: false },
    { section: "bank", label: "Bank details", ok: c.sections.bank, required: true },
  ];
  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-slate-900">Review &amp; submit</h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.section} className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">{r.label}{r.required && <span className="text-orange-500"> *</span>}</span>
            <span className="flex items-center gap-3">
              <span className={`text-xs font-semibold ${r.ok ? "text-emerald-600" : r.required ? "text-amber-600" : "text-slate-400"}`}>
                {r.ok ? "Complete" : r.required ? "Incomplete" : "Optional"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onEdit(r.section)}>Edit</Button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-slate-100 pt-4">
        {c.canSubmit ? (
          <Alert tone="success">All required sections are complete. You're ready to submit for review.</Alert>
        ) : (
          <Alert tone="warn">Complete these required sections to submit: <b>{c.missing.join(", ")}</b></Alert>
        )}
        {!readOnly && (
          <div className="mt-4">
            <Button onClick={onSubmit} loading={submitting} disabled={!c.canSubmit} variant="success">
              {profile.status === "CHANGES_REQUESTED" ? "Resubmit application" : "Submit application"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
