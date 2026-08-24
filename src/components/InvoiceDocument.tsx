// Shared, printable invoice document. Rendered by both the buyer and admin
// invoice pages from a server-issued invoice (totals are authoritative).
import { Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import type { Order } from "@/lib/api/commerce";

const inr = (m: number) => "₹" + (m / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const fmt = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function InvoiceDocument({ invoiceNumber, issuedAt, order, backTo }: {
  invoiceNumber: string;
  issuedAt: string;
  order: Order;
  backTo: string;
}) {
  const o = order;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">
          <Printer className="h-4 w-4" /> Download / Print
        </button>
      </div>

      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-slate-800 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-slate-200 pb-5">
          <div>
            <div className="text-2xl font-black tracking-tight">ZOLO <span className="text-primary-600">Packaging</span></div>
            <p className="mt-1 text-xs text-slate-500">Premium packaging solutions<br />Bengaluru, Karnataka, India</p>
          </div>
          <div className="text-right">
            <div className="text-lg font-extrabold">TAX INVOICE</div>
            <p className="mt-1 font-mono text-sm">{invoiceNumber}</p>
            <p className="text-xs text-slate-500">Issued {fmt(issuedAt)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 py-5 text-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Billed to</p>
            <p className="font-semibold">{o.billingAddress.name}</p>
            <p className="text-slate-600">{o.billingAddress.line1}{o.billingAddress.line2 ? `, ${o.billingAddress.line2}` : ""}</p>
            <p className="text-slate-600">{o.billingAddress.city}, {o.billingAddress.state} — {o.billingAddress.postalCode}</p>
            <p className="text-slate-500">☎ {o.billingAddress.phone}</p>
            {o.customer?.email && <p className="text-slate-500">{o.customer.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Order</p>
            <p className="font-mono font-semibold">{o.orderNumber}</p>
            <p className="text-slate-500">Placed {fmt(o.placedAt)}</p>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Payment</p>
            <p className="text-slate-600">{o.paymentMethod.toUpperCase()} · {o.paymentStatus}</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <th className="py-2">Item</th><th className="py-2">SKU</th><th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th><th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="py-2 font-medium">{it.productName}{it.variant ? <span className="text-slate-400"> · {it.variant}</span> : null}</td>
                <td className="py-2 font-mono text-xs text-slate-500">{it.sku ?? "—"}</td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{inr(it.unitPriceMinor)}</td>
                <td className="py-2 text-right font-semibold">{inr(it.lineTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-64 space-y-1.5 text-sm">
            <Row label="Subtotal" value={inr(o.subtotalMinor)} />
            {o.discountMinor > 0 && <Row label="Discount" value={`− ${inr(o.discountMinor)}`} />}
            <Row label="GST (18%)" value={inr(o.taxMinor)} />
            <Row label="Shipping" value={o.shippingMinor > 0 ? inr(o.shippingMinor) : "Free"} />
            <div className="border-t border-slate-200 pt-1.5"><Row label={<b>Grand Total</b>} value={<b>{inr(o.grandTotalMinor)}</b>} /></div>
          </dl>
        </div>

        <p className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          This is a computer-generated invoice. Thank you for choosing Zolo Packaging.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><dt className="text-slate-500">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}
