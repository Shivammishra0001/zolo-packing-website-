import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { onboardingApi } from "../onboarding-api";
import { Card, StatusPill, Alert, EmptyState, Button } from "../ui";

export default function SellerDashboard() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onboardingApi.dashboard()
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="grid min-h-[50vh] place-items-center text-slate-400">Loading dashboard…</div>;
  if (error) return <div className="p-6"><Alert tone="error">{error}</Alert></div>;
  if (!data) return null;

  const approved = data.status === "APPROVED";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Seller dashboard</h1>
        <div className="flex items-center gap-2">
          <StatusPill status={data.status} />
          <StatusPill status={data.verificationStatus} />
        </div>
      </header>

      {/* Action-required alerts */}
      {data.actionRequired?.length > 0 && (
        <div className="space-y-2">
          {data.actionRequired.map((a: any, i: number) => {
            const tone = a.kind === "approved" ? "success"
              : a.kind === "rejected" ? "error"
              : a.kind === "under_review" ? "info"
              : a.kind === "submit" ? "success"
              : "warn";
            // Only actionable states get a button linking into the wizard.
            const showButton = ["submit", "address_changes", "complete_profile", "renew_documents"].includes(a.kind);
            return (
              <Alert key={i} tone={tone}>
                <div className="flex items-center justify-between gap-3">
                  <span>{a.message}</span>
                  {showButton && (
                    <Link to="/seller/onboarding">
                      <Button size="sm" variant={a.kind === "submit" ? "success" : "secondary"}>
                        {a.kind === "address_changes" ? "Make changes" : "Open onboarding"}
                      </Button>
                    </Link>
                  )}
                </div>
              </Alert>
            );
          })}
        </div>
      )}

      {/* Profile completion */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Profile completion</p>
            <p className="text-xs text-slate-400">Complete your profile to unlock RFQs.</p>
          </div>
          <span className="text-2xl font-bold text-slate-900">{data.profileCompletion}%</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${data.profileCompletion}%` }} />
        </div>
      </Card>

      {/* Real counts */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Documents" value={data.counts.documents} />
        <Metric label="Capabilities" value={data.counts.capabilities} />
        <Metric label="Locations" value={data.counts.locations} />
        <Metric label="Expiring soon" value={data.documentsExpiring} tone={data.documentsExpiring > 0 ? "warn" : "default"} />
      </div>

      {/* Operational modules — honest empty states until built */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Operations</h2>
        {!approved ? (
          <EmptyState title="Operational modules unlock after approval" hint="RFQs, quotes, orders, production, QC, inventory and payments appear here once your account is approved." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Live: the RFQ lead inbox + quoting. */}
            <Link to="/seller/rfqs" className="rounded-lg border border-orange-200 bg-orange-50/50 p-3 text-center transition hover:bg-orange-50">
              <p className="text-xs font-bold uppercase tracking-wide text-orange-700">RFQ Leads</p>
              <p className="mt-1 text-xs text-orange-600">View &amp; quote →</p>
            </Link>
            {["orders", "production", "qc", "inventory", "payments"].map((k) => (
              <div key={k} className="rounded-lg border border-dashed border-slate-200 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-slate-400">{k.replace(/([A-Z])/g, " $1")}</p>
                <p className="mt-1 text-xs text-slate-400">Coming soon</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.status === "REJECTED" && (
        <Alert tone="error" title="Application not approved">Please contact support for next steps.</Alert>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</p>
    </Card>
  );
}
