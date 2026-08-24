// Buyer invoice page — fetches the server-issued invoice and renders the
// shared printable document.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { orderApi, type InvoiceView as InvoiceData } from "@/lib/api/commerce";

export default function InvoiceView() {
  const { id } = useParams();
  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => { if (id) orderApi.invoice(id).then(setData).catch(() => setError(true)); }, [id]);

  if (error) return <div className="p-10 text-center text-sm text-slate-500">Invoice not available.</div>;
  if (!data) return <div className="p-10 text-center text-sm text-slate-400">Loading invoice…</div>;

  return <InvoiceDocument invoiceNumber={data.invoiceNumber} issuedAt={data.issuedAt} order={data.order} backTo={`/account/orders/${data.order.id}`} />;
}
