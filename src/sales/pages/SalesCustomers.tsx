import { useEffect, useState } from "react";
import { Search, Users, Loader2 } from "lucide-react";
import { salesApi, type CustomerHit, type CustomerSnapshot } from "@/lib/api/sales";
import { describeApiError } from "@/lib/api/client";
import { Field, TextInput, Card, Empty, inrMinor, GhostButton } from "../ui";

// Customer 360 for the field: find someone, then see the history that answers
// their technical questions without asking them again.
export default function SalesCustomers() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<CustomerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        setHits((await salesApi.searchCustomers(q)).customers);
      } catch (e) {
        setError(describeApiError(e).message);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (open) {
    return (
      <div className="space-y-4 px-4 py-4 pb-24">
        <GhostButton onClick={() => setOpen(null)}>Back to search</GhostButton>
        <Card>
          <p className="font-bold text-dark-900">{open.customer.company || open.customer.name}</p>
          <p className="text-sm text-dark-500">{open.customer.phone ?? open.customer.email}</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-dark-100 pt-3 text-center">
            <div><dt className="text-[11px] text-dark-500">Orders</dt><dd className="font-bold text-dark-900">{open.orderCount}</dd></div>
            <div><dt className="text-[11px] text-dark-500">Business</dt><dd className="font-bold text-dark-900">{inrMinor(open.totalBusinessMinor)}</dd></div>
            <div><dt className="text-[11px] text-dark-500">Outstanding</dt>
              <dd className={`font-bold ${open.outstandingMinor > 0 ? "text-red-600" : "text-dark-900"}`}>{inrMinor(open.outstandingMinor)}</dd></div>
          </dl>
        </Card>

        {open.recentItems.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-dark-500">Previously ordered</p>
            <div className="space-y-2">
              {open.recentItems.map((i, n) => (
                <Card key={n}>
                  <p className="truncate text-sm font-bold text-dark-900">{i.productName}</p>
                  <p className="text-xs text-dark-500">
                    {i.quantity.toLocaleString("en-IN")} × {inrMinor(i.unitPriceMinor)} · {i.orderNumber}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 pb-24">
      <h1 className="text-xl font-bold text-dark-900">Customers</h1>
      <Field label="Find a customer">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-dark-400" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or business" className="pl-12" />
        </div>
      </Field>

      {error && <Card className="text-sm text-red-600">{error}</Card>}
      {busy && <Loader2 className="mx-auto h-5 w-5 animate-spin text-dark-300" />}

      {hits.length === 0 && q.trim().length < 2 ? (
        <Empty icon={<Users className="h-10 w-10" />} title="Search your customers" body="Type a name, phone number or business." />
      ) : (
        <div className="space-y-2">
          {hits.map((c) => (
            <button key={c.id} type="button"
              onClick={async () => { try { setOpen(await salesApi.snapshot(c.id)); } catch (e) { setError(describeApiError(e).message); } }}
              className="w-full rounded-xl border border-dark-200 bg-white p-4 text-left active:bg-dark-50">
              <p className="font-bold text-dark-900">{c.company || c.name}</p>
              <p className="text-sm text-dark-500">{c.name} · {c.phone ?? c.email}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
