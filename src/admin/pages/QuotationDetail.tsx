import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileDown, FileText, Image, Send } from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, Panel } from "../components/Panel";
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  KeyValue,
  PageHeader,
} from "../components/ui";
import { formatDate, inr, relativeTime } from "../format";
import { rfqs } from "../mock-data";
import type { Rfq } from "../types";

const QTY_SLABS = [500, 1000, 3000, 5000];

interface CostLines {
  paper: number;
  printing: number;
  lamination: number;
  die: number;
  conversion: number;
  freight: number;
}

const COST_FIELDS: { key: keyof CostLines; label: string }[] = [
  { key: "paper", label: "Paper / Board" },
  { key: "printing", label: "Printing" },
  { key: "lamination", label: "Lamination / Coating" },
  { key: "die", label: "Die & Tooling" },
  { key: "conversion", label: "Conversion" },
  { key: "freight", label: "Freight" },
];

/** Per-unit cost at a given quantity. Die is a one-time cost spread over qty;
 *  everything else scales per unit with mild volume efficiency. */
function unitCostAt(lines: CostLines, qty: number): number {
  const efficiency = qty >= 5000 ? 0.9 : qty >= 3000 ? 0.94 : qty >= 1000 ? 0.98 : 1;
  const perUnit = (lines.paper + lines.printing + lines.lamination + lines.conversion + lines.freight) * efficiency;
  const diePerUnit = qty > 0 ? lines.die / qty : 0;
  return perUnit + diePerUnit;
}

function priceWithMargin(cost: number, marginPct: number): number {
  return cost / (1 - Math.min(marginPct, 99) / 100);
}

function statusBadge(status: Rfq["status"]) {
  const map = {
    pending: { label: "Awaiting Quote", tone: "warning" as const },
    quoted: { label: "Quoted", tone: "info" as const },
    won: { label: "Approved · Won", tone: "success" as const },
    lost: { label: "Lost", tone: "danger" as const },
  };
  return map[status];
}

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const rfq = useMemo(() => rfqs.find((r) => r.id === id), [id]);

  const [lines, setLines] = useState<CostLines>({
    paper: 8,
    printing: 4,
    lamination: 2,
    die: 6000,
    conversion: 3,
    freight: 1.5,
  });
  const [margin, setMargin] = useState(22);
  const [validity, setValidity] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().slice(0, 10);
  });
  const [convertOpen, setConvertOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  if (!rfq) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader
          breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Quotations", to: "/admin/quotes" }, { label: "Not found" }]}
          title="Quotation not found"
        />
        <Panel>
          <EmptyState
            icon={FileText}
            title="We couldn't find that RFQ"
            message="It may have been removed or the link is incorrect."
            action={
              <Link to="/admin/quotes" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-600 hover:text-primary-700">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to quotations
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const primaryQty = rfq.quantity;
  const unitCost = unitCostAt(lines, primaryQty);
  const unitPrice = priceWithMargin(unitCost, margin);
  const totalPrice = unitPrice * primaryQty;
  const lowMargin = margin < 15;
  const badge = statusBadge(rfq.status);

  const setLine = (key: keyof CostLines, raw: string) => {
    const v = Number(raw);
    setLines((prev) => ({ ...prev, [key]: Number.isFinite(v) ? v : 0 }));
  };

  const numberInput =
    "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm tabular-nums erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[
          { label: "Home", to: "/admin" },
          { label: "Quotations", to: "/admin/quotes" },
          { label: rfq.id },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {rfq.id}
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
        }
        subtitle={`${rfq.customerName} · received ${relativeTime(rfq.submittedAt)}`}
        actions={
          <Button variant="secondary" icon={FileText} onClick={() => setPdfOpen(true)}>
            PDF Preview
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* LEFT: requested config */}
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Requested Configuration">
            <KeyValue
              items={[
                { label: "Box Type", value: rfq.boxType },
                { label: "Dimensions", value: rfq.dimensions },
                { label: "Material", value: rfq.material },
                { label: "GSM", value: rfq.gsm > 0 ? rfq.gsm : "—" },
                { label: "Printing", value: rfq.printing },
                { label: "Finishes", value: rfq.finishes.length > 0 ? rfq.finishes.join(", ") : "None" },
                { label: "Quantity", value: `${rfq.quantity.toLocaleString("en-IN")} pcs` },
              ]}
            />
          </Panel>

          <Panel title="Artwork">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed erp-border erp-surface-2 p-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl erp-surface text-2xl" aria-hidden>
                📦
              </span>
              <div>
                <p className="text-sm font-semibold erp-text">{rfq.artworkFile ?? "No artwork uploaded"}</p>
                <p className="text-xs erp-text-muted">Customer-supplied dieline / print file</p>
              </div>
              {rfq.artworkFile && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={FileDown}
                  onClick={() => toast.info("Download started", rfq.artworkFile)}
                >
                  Download artwork
                </Button>
              )}
              {!rfq.artworkFile && (
                <span className="inline-flex items-center gap-1.5 text-xs erp-text-faint">
                  <Image className="h-4 w-4" aria-hidden /> Awaiting upload
                </span>
              )}
            </div>
          </Panel>
        </div>

        {/* RIGHT: quotation builder */}
        <div className="space-y-4 lg:col-span-3">
          <Panel title="Quotation Builder">
            <div className="space-y-5">
              {/* cost lines */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {COST_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-xs font-semibold erp-text-muted">
                      {f.label} {f.key === "die" ? "(one-time ₹)" : "(₹/unit)"}
                    </span>
                    <input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      value={lines[f.key]}
                      onChange={(e) => setLine(f.key, e.target.value)}
                      className={numberInput}
                    />
                  </label>
                ))}
              </div>

              {/* margin + validity */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-semibold erp-text-muted">
                    Margin %
                    <span className={cn("font-bold", lowMargin ? "text-red-600" : "text-emerald-600")}>
                      {lowMargin ? "Below target" : "Healthy"}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={margin}
                    onChange={(e) => setMargin(Number(e.target.value) || 0)}
                    className={cn(numberInput, lowMargin && "border-red-400 focus:border-red-500 dark:border-red-500/60")}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold erp-text-muted">Quote valid until</span>
                  <input
                    type="date"
                    value={validity}
                    onChange={(e) => setValidity(e.target.value)}
                    className={numberInput}
                  />
                </label>
              </div>

              {/* live per-unit summary */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Unit Cost", value: inr(unitCost) },
                  { label: "Unit Price", value: inr(unitPrice) },
                  { label: `Total @ ${primaryQty.toLocaleString("en-IN")}`, value: inr(totalPrice) },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border erp-border-soft erp-surface-2 p-3">
                    <p className="text-xs erp-text-muted">{s.label}</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums erp-text">{s.value}</p>
                  </div>
                ))}
              </div>

              {lowMargin && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  Margin is below the 15% floor — review before sending.
                </p>
              )}
            </div>
          </Panel>

          {/* qty slab pricing */}
          <Panel title="Price by Quantity" bodyClassName="p-0">
            <div className="overflow-x-auto px-4 py-4 sm:px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                    <th className="px-3 py-2.5 first:pl-0">Quantity</th>
                    <th className="px-3 py-2.5 text-right">Unit Cost</th>
                    <th className="px-3 py-2.5 text-right">Unit Price</th>
                    <th className="px-3 py-2.5 text-right last:pr-0">Order Total</th>
                  </tr>
                </thead>
                <tbody>
                  {QTY_SLABS.map((qty) => {
                    const c = unitCostAt(lines, qty);
                    const p = priceWithMargin(c, margin);
                    return (
                      <tr key={qty} className="border-b erp-border-soft last:border-0">
                        <td className="px-3 py-3 font-semibold erp-text first:pl-0">
                          {qty.toLocaleString("en-IN")} pcs
                          {qty === primaryQty && <Badge tone="primary" className="ml-2">Requested</Badge>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums erp-text-muted">{inr(c)}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums erp-text">{inr(p)}</td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums erp-text last:pr-0">{inr(p * qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs erp-text-muted">
              Approval Status: <Badge tone={badge.tone}>{badge.label}</Badge>
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={Send}
                disabled={lowMargin}
                onClick={() => toast.success("Quote sent", `Quotation for ${rfq.id} emailed to ${rfq.customerName}.`)}
              >
                Send Quote
              </Button>
              <Button variant="primary" onClick={() => setConvertOpen(true)}>
                Convert to Order
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Convert dialog */}
      <Dialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="Convert to Order"
        description={`Create a firm order from ${rfq.id} at ${inr(unitPrice)}/unit.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const newId = `ORD-${2500 + Math.floor(Math.random() * 500)}`;
                toast.success("Order created", `Order ${newId} created from ${rfq.id}.`);
                setConvertOpen(false);
              }}
            >
              Confirm & create
            </Button>
          </>
        }
      >
        <KeyValue
          items={[
            { label: "Customer", value: rfq.customerName },
            { label: "Quantity", value: `${primaryQty.toLocaleString("en-IN")} pcs` },
            { label: "Unit Price", value: inr(unitPrice) },
            { label: "Order Value", value: inr(totalPrice) },
          ]}
        />
      </Dialog>

      {/* PDF preview drawer */}
      <Drawer open={pdfOpen} onClose={() => setPdfOpen(false)} title="Quotation Preview" width="max-w-xl">
        <div className="rounded-lg border erp-border erp-surface-2 p-6 text-sm">
          <div className="flex items-start justify-between gap-3 border-b erp-border-soft pb-4">
            <div>
              <p className="font-display text-xl font-extrabold erp-text">Zolo Packaging</p>
              <p className="text-xs erp-text-muted">Quotation · {rfq.id}</p>
            </div>
            <div className="text-right text-xs erp-text-muted">
              <p>Date: {formatDate(new Date().toISOString())}</p>
              <p>Valid until: {formatDate(new Date(validity).toISOString())}</p>
            </div>
          </div>

          <div className="py-4">
            <p className="text-xs font-semibold erp-text-faint">Prepared For</p>
            <p className="mt-0.5 font-semibold erp-text">{rfq.customerName}</p>
          </div>

          <div className="rounded-lg border erp-border-soft erp-surface p-3">
            <p className="text-xs font-semibold erp-text-faint">Specification</p>
            <p className="mt-1 erp-text">
              {rfq.boxType} · {rfq.dimensions} · {rfq.material}
              {rfq.gsm > 0 ? ` ${rfq.gsm} GSM` : ""} · {rfq.printing}
              {rfq.finishes.length > 0 ? ` · ${rfq.finishes.join(", ")}` : ""}
            </p>
          </div>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b erp-border text-left text-xs font-bold uppercase erp-text-faint">
                <th className="py-2">Qty</th>
                <th className="py-2 text-right">Unit Price</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {QTY_SLABS.map((qty) => {
                const p = priceWithMargin(unitCostAt(lines, qty), margin);
                return (
                  <tr key={qty} className="border-b erp-border-soft last:border-0">
                    <td className="py-2 erp-text">{qty.toLocaleString("en-IN")} pcs</td>
                    <td className="py-2 text-right tabular-nums erp-text">{inr(p)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums erp-text">{inr(p * qty)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-4 text-xs erp-text-muted">
            Prices exclusive of GST. Lead time 10–14 working days from artwork approval. Terms: 50% advance,
            balance before dispatch.
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            icon={FileDown}
            onClick={() => toast.success("PDF generated", `Quotation ${rfq.id} exported.`)}
          >
            Download PDF
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
