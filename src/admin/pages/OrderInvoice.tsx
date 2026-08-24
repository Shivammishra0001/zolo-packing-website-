// Admin invoice page — fetches via the admin invoice endpoint and renders the
// shared printable document.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { adminOrdersApi } from "@/lib/api/admin-orders";
import type { Order } from "@/lib/api/commerce";

export default function OrderInvoice() {
  const { id } = useParams();
  const [data, setData] = useState<{ invoiceNumber: string; issuedAt: string; order: Order } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => { if (id) adminOrdersApi.invoice(id).then(setData).catch(() => setError(true)); }, [id]);

  if (error) return <div className="p-10 text-center text-sm text-slate-500">Invoice not available.</div>;
  if (!data) return <div className="p-10 text-center text-sm text-slate-400">Loading invoice…</div>;

  return <InvoiceDocument invoiceNumber={data.invoiceNumber} issuedAt={data.issuedAt} order={data.order} backTo={`/admin/orders/${data.order.id}`} />;
}
