// Admin: full seller review with transactional actions (review/approve/reject/
// request-changes/suspend/reactivate) and document verification.
import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { adminSellerApi } from "../onboarding-api";
import { Card, StatusPill, Button, Alert, EmptyState, Textarea, Field } from "../ui";
import { AdminGate } from "./AdminGate";

export default function AdminSellerDetail() {
  return <AdminGate><AdminSellerDetailInner /></AdminGate>;
}

function AdminSellerDetailInner() {
  const { id = "" } = useParams();
  const [s, setS] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<{ section: string; message: string }[]>([]);
  const [issueDraft, setIssueDraft] = useState({ section: "documents", message: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setS(await adminSellerApi.get(id)); setError(null); }
    catch (e: any) { setError(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e: any) { setError(e?.message ?? "Action failed"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (error && !s) return <div className="p-6"><Alert tone="error">{error}</Alert></div>;
  if (!s) return null;

  const canReview = s.status === "SUBMITTED";
  const canDecide = s.status === "SUBMITTED" || s.status === "UNDER_REVIEW";

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/sellers" className="text-sm text-slate-400 hover:text-slate-600">← All sellers</Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{s.displayName || s.legalName || s.organization?.name}</h1>
          <div className="mt-1 flex gap-2"><StatusPill status={s.status} /><StatusPill status={s.verificationStatus} /></div>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Actions */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Review actions</h2>
        <div className="flex flex-wrap gap-2">
          {canReview && <Button variant="secondary" loading={busy} onClick={() => act(() => adminSellerApi.review(id))}>Start review</Button>}
          {canDecide && <Button variant="success" loading={busy} onClick={() => act(() => adminSellerApi.approve(id))}>Approve</Button>}
          {canDecide && <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => act(() => adminSellerApi.reject(id, reason))}>Reject</Button>}
          {s.status === "APPROVED" && <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => act(() => adminSellerApi.suspend(id, reason))}>Suspend</Button>}
          {s.status === "SUSPENDED" && <Button variant="success" loading={busy} onClick={() => act(() => adminSellerApi.reactivate(id))}>Reactivate</Button>}
        </div>
        {(canDecide || s.status === "APPROVED") && (
          <div className="mt-3">
            <Field label="Reason (required for reject / suspend)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}

        {/* Change request builder */}
        {canDecide && (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">Request changes</p>
            {issues.length > 0 && (
              <ul className="mb-2 space-y-1 text-sm text-slate-600">
                {issues.map((it, i) => <li key={i} className="flex justify-between"><span><b>{it.section}:</b> {it.message}</span><button className="text-slate-400 hover:text-red-500" onClick={() => setIssues(issues.filter((_, j) => j !== i))}>×</button></li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <select className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={issueDraft.section} onChange={(e) => setIssueDraft({ ...issueDraft, section: e.target.value })}>
                {["business", "legal", "locations", "capabilities", "documents", "bank", "capacity"].map((x) => <option key={x}>{x}</option>)}
              </select>
              <input className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" placeholder="What needs to change?" value={issueDraft.message} onChange={(e) => setIssueDraft({ ...issueDraft, message: e.target.value })} />
              <Button size="sm" variant="secondary" disabled={!issueDraft.message.trim()} onClick={() => { setIssues([...issues, issueDraft]); setIssueDraft({ section: "documents", message: "" }); }}>Add</Button>
              <Button size="sm" loading={busy} disabled={issues.length === 0} onClick={() => act(() => adminSellerApi.requestChanges(id, issues).then((r) => { setIssues([]); return r; }))}>Send request</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Summary sections */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Business">
          <KV k="Legal name" v={s.legalName} /><KV k="Display name" v={s.displayName} />
          <KV k="Type" v={s.businessType?.replace(/_/g, " ")} /><KV k="Contact" v={s.contactName} />
          <KV k="Email" v={s.contactEmail} /><KV k="Phone" v={s.contactPhone} />
        </Section>
        <Section title="Legal & tax">
          <KV k="GSTIN" v={s.gstNumber} /><KV k="PAN" v={s.panNumber} /><KV k="CIN" v={s.cinNumber} />
        </Section>
        <Section title={`Locations (${s.locations?.length ?? 0})`}>
          {s.locations?.length ? s.locations.map((l: any) => <p key={l.id} className="text-sm text-slate-600">{l.locationType}: {l.addressLine1}, {l.city}, {l.state}</p>) : <EmptyState title="None" />}
        </Section>
        <Section title={`Capabilities (${s.capabilities?.length ?? 0})`}>
          {s.capabilities?.length ? s.capabilities.map((c: any) => <p key={c.id} className="text-sm text-slate-600">{c.category}{c.subCategory ? ` / ${c.subCategory}` : ""}</p>) : <EmptyState title="None" />}
        </Section>
        <Section title={`Bank (${s.bankAccounts?.length ?? 0})`}>
          {s.bankAccounts?.length ? s.bankAccounts.map((b: any) => <p key={b.id} className="text-sm text-slate-600">{b.bankName} · {b.accountHolderName} · ••••{b.accountLast4} · {b.ifsc}</p>) : <EmptyState title="None" />}
        </Section>
        <Section title={`Documents (${s.documents?.length ?? 0})`}>
          {s.documents?.length ? s.documents.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between gap-2 py-1 text-sm">
              <span className="text-slate-600">{d.type.replace(/_/g, " ")} · {d.fileName}</span>
              <span className="flex items-center gap-2">
                <StatusPill status={d.verificationStatus} />
                <button className="text-xs text-orange-600 hover:underline" onClick={() => act(async () => {
                  // The document is streamed by an authorized route, so it must be
                  // fetched with the auth header and opened as a blob rather than
                  // linked directly. Revoke the object URL once the tab has it.
                  const blob = await adminSellerApi.documentBlob(d.id);
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank", "noopener");
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                })}>View</button>
                <button className="text-xs text-emerald-600 hover:underline" onClick={() => act(() => adminSellerApi.verifyDocument(d.id, "VERIFIED"))}>✓</button>
                <button className="text-xs text-red-600 hover:underline" onClick={() => act(() => adminSellerApi.verifyDocument(d.id, "REJECTED", "Not acceptable"))}>✗</button>
              </span>
            </div>
          )) : <EmptyState title="None" />}
        </Section>
      </div>

      {/* History */}
      <Section title="Status history">
        {s.statusHistory?.length ? (
          <ul className="space-y-1 text-sm text-slate-600">
            {s.statusHistory.map((h: any) => (
              <li key={h.id} className="flex justify-between">
                <span>{h.fromStatus ?? "—"} → <b>{h.toStatus}</b>{h.reason ? ` · ${h.reason}` : ""}</span>
                <span className="text-slate-400">{new Date(h.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No history" />}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3><div className="space-y-1">{children}</div></Card>;
}
function KV({ k, v }: { k: string; v?: string | null }) {
  return <p className="flex justify-between text-sm"><span className="text-slate-400">{k}</span><span className="text-slate-700">{v || "—"}</span></p>;
}
