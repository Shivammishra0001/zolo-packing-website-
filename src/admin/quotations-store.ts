// ============================================================
// Quotations (RFQ) store — backed by the REAL API.
//
// This was previously an in-memory array seeded from mock-data, which is why
// submitted RFQs never appeared in Admin -> Quotations: nothing was ever
// fetched or stored server-side. It now reads /api/v1/admin/rfqs.
//
// The admin table's `Rfq` type is single-product (boxType/quantity as
// scalars), but one RFQ holds MANY items. `toAdminRow` summarises the lines
// for the table while `apiRfqs` keeps the full multi-item records for the
// detail view, so the list stays compatible without flattening the data.
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { adminRfqApi, type Rfq as ApiRfq, type RfqStatus as ApiRfqStatus } from "@/lib/api/rfq";
import type { Rfq } from "./types";

/** Server status -> the four buckets the admin table tabs on. */
function toTableStatus(s: ApiRfqStatus): Rfq["status"] {
  switch (s) {
    case "QUOTED":
      return "quoted";
    case "ACCEPTED":
      return "won";
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
      return "lost";
    default:
      return "pending"; // SUBMITTED / UNDER_REVIEW / DRAFT
  }
}

/**
 * Summarise a multi-item RFQ into the single-row shape the table renders.
 * The first line names the row and the rest are counted, so a three-product
 * RFQ reads "Kraft Mailer Box +2 more" rather than silently showing one item.
 */
export function toAdminRow(r: ApiRfq): Rfq {
  const [first, ...rest] = r.items;
  const label = first ? first.productName : "—";
  return {
    id: r.rfqNumber,
    customerId: r.customer?.id ?? "",
    customerName: r.customer?.name ?? r.customer?.email ?? "Unknown",
    // The API does not classify segment yet; default rather than invent one.
    segment: "small_seller",
    boxType: rest.length ? `${label} +${rest.length} more` : label,
    dimensions: String(first?.specs?.dimensions ?? ""),
    material: String(first?.specs?.material ?? ""),
    gsm: Number(first?.specs?.gsm ?? 0),
    printing: String(first?.specs?.printing ?? ""),
    finishes: [],
    // Total across every line — the figure that matters for a multi-item RFQ.
    quantity: r.totalQuantity,
    submittedAt: r.submittedAt ?? r.createdAt,
    // 4 business hours from submission, matching the existing SLA display.
    slaDueAt: new Date(new Date(r.submittedAt ?? r.createdAt).getTime() + 4 * 3600_000).toISOString(),
    status: toTableStatus(r.status),
  };
}

// Matches MockQuery so <QueryState> and the existing panels work unchanged.
export interface QuotationsQuery {
  data: Rfq[] | null;
  /** Full multi-item records, keyed by rfqNumber, for the detail view. */
  apiRfqs: Map<string, ApiRfq>;
  loading: boolean;
  error: string | null;
  retry: () => void;
  refetch: () => void;
}

/**
 * Live admin RFQ queue. Refetches on demand so a newly submitted RFQ appears
 * without a manual page reload.
 */
export function useQuotations(pollMs = 0): QuotationsQuery {
  const [data, setData] = useState<Rfq[] | null>(null);
  const [apiRfqs, setApiRfqs] = useState<Map<string, ApiRfq>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await adminRfqApi.list({ take: 200 });
      setData(res.rfqs.map(toAdminRow));
      setApiRfqs(new Map(res.rfqs.map((r) => [r.rfqNumber, r])));
    } catch (e) {
      // Surface the failure instead of falling back to fake rows — an empty
      // table that looks like "no RFQs" would hide a broken API.
      setError(e instanceof Error ? e.message : "Could not load quotation requests");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) void load(); };
    run();
    if (pollMs > 0) {
      const t = setInterval(run, pollMs);
      return () => { cancelled = true; clearInterval(t); };
    }
    return () => { cancelled = true; };
  }, [load, pollMs]);

  return { data, apiRfqs, loading, error, retry: load, refetch: load };
}
