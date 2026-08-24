// Admin: seller list with search + status filters. Uses the real admin API
// (requires an admin JWT — sign in via /seller/login with an admin account).
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { adminSellerApi, type AdminSellerListItem } from "../onboarding-api";
import { Card, StatusPill, Input, Select, EmptyState, Alert, Button } from "../ui";
import { AdminGate } from "./AdminGate";

const STATUSES = ["", "DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "SUSPENDED"];

export default function AdminSellers() {
  // Real-JWT gate: shows an inline admin sign-in until authenticated.
  return <AdminGate><AdminSellersInner /></AdminGate>;
}

function AdminSellersInner() {
  const [items, setItems] = useState<AdminSellerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("SUBMITTED");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSellerApi.list({ status: status || undefined, search: search || undefined });
      setItems(res.items); setTotal(res.total); setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load sellers");
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Sellers <span className="text-sm font-normal text-slate-400">({total})</span></h1>
        <div className="flex gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, " ") : "All statuses"}</option>)}
          </Select>
          <Input placeholder="Search name / GST…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-52" />
          <Button variant="secondary" onClick={load}>Search</Button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {loading ? <p className="text-sm text-slate-400">Loading…</p>
        : items.length === 0 ? <EmptyState title="No sellers match this filter." />
        : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Company</th><th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th><th className="px-4 py-3">Verification</th>
                  <th className="px-4 py-3">Docs</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.displayName || s.legalName || s.organization.name}</td>
                    <td className="px-4 py-3 text-slate-500">{s.businessType?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="px-4 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-4 py-3"><StatusPill status={s.verificationStatus} /></td>
                    <td className="px-4 py-3 text-slate-500">{s._count.documents}</td>
                    <td className="px-4 py-3 text-slate-500">{s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3 text-right"><Link to={`/admin/sellers/${s.id}`} className="font-medium text-orange-600 hover:underline">Review →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
    </div>
  );
}
