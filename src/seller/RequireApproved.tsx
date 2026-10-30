import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { onboardingApi, type SupplierStatus } from "./onboarding-api";

// ============================================================
// Status gate for supplier routes that only make sense once an application
// has been approved.
//
// `RequireSeller` answers "is this a logged-in supplier?" — it says nothing
// about whether their application was ever approved, so a DRAFT or REJECTED
// supplier could load the operational pages and see a wall of locked tiles.
//
// The status is read from the SERVER (`/sellers/me/onboarding`), never from
// the stored session blob: a client-side claim about approval is exactly the
// thing an unapproved supplier could forge.
// ============================================================

/** Statuses that may use the operational modules. */
const OPERATIONAL: SupplierStatus[] = ["APPROVED"];

/** Statuses where the right destination is the application form. */
const STILL_APPLYING: SupplierStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export function RequireApproved({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SupplierStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    onboardingApi
      .get()
      .then((p) => { if (alive) { setStatus(p.status); setState("ready"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, []);

  if (state === "loading") {
    return <div className="grid min-h-[50vh] place-items-center text-slate-400">Loading…</div>;
  }

  // A failed status check must not silently unlock the page, and must not
  // strand a legitimate supplier either: say what happened and let them retry.
  if (state === "error" || !status) {
    return (
      <Notice
        title="Couldn't check your account status"
        body="We couldn't reach the server to confirm whether your account is approved. Please check your connection and try again."
        action={<button onClick={() => window.location.reload()} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">Try again</button>}
      />
    );
  }

  if (OPERATIONAL.includes(status)) return <>{children}</>;

  // Mid-application: the application form is the useful page, not a dashboard
  // of tiles they cannot use.
  if (STILL_APPLYING.includes(status)) return <Navigate to="/seller/onboarding" replace />;

  if (status === "SUBMITTED" || status === "UNDER_REVIEW") {
    return (
      <Notice
        title="Your application is under review"
        body="We're reviewing the details you submitted. You'll be notified as soon as it's approved, and your dashboard will unlock then."
        action={<Link to="/seller/onboarding" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">View your application</Link>}
      />
    );
  }

  if (status === "REJECTED") {
    return (
      <Notice
        tone="error"
        title="Your application wasn't approved"
        body="Please contact support for the next steps. Your application details are still available to view."
        action={<Link to="/seller/onboarding" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">View your application</Link>}
      />
    );
  }

  // SUSPENDED / INACTIVE. A suspended supplier also loses API access
  // server-side (see middleware/auth.mjs), so this is the honest explanation
  // rather than a page of failing requests.
  return (
    <Notice
      tone="error"
      title={status === "SUSPENDED" ? "Your account is suspended" : "Your account is inactive"}
      body="Please contact support to restore access to your supplier dashboard."
    />
  );
}

function Notice({ title, body, action, tone = "info" }: { title: string; body: string; action?: ReactNode; tone?: "info" | "error" }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className={`rounded-xl border p-8 ${tone === "error" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
