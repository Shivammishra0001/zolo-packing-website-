import { useMemo, useState } from "react";
import { Ban, Download, Eye, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  KeyValue,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Toolbar,
} from "@/admin/components/ui";
import { Panel, EmptyState } from "@/admin/components/Panel";
import { DataTable, type Column } from "@/admin/components/DataTable";
import { formatDate } from "@/admin/format";
import { inr } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { useBuyerQuotations } from "@/buyer/data";
import type { Rfq } from "@/buyer/types";

// ============================================================
// Buyer quotations — the customer's own RFQs. Pattern: table → view → action.
// Buyers can apply for a new quote, inspect the requested config, download a
// PDF stub, or cancel. All data is scoped to the logged-in customer.
// ============================================================

const STATUS_TONE = {
  pending: "warning",
  quoted: "info",
  won: "success",
  lost: "neutral",
} as const;

const STATUS_LABEL: Record<Rfq["status"], string> = {
  pending: "Pending",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

// Indicative per-unit rate (₹) by box type — a rough estimate shown to the
// buyer before an official quote lands. Not a committed price.
const NOMINAL_RATE: Record<string, number> = {
  "Mailer Box": 22,
  "Shipping Box": 18,
  "Rigid Box": 48,
  "Corrugated Box": 14,
  "Folding Carton": 12,
  "Product Box": 26,
};

function indicativeAmount(r: Rfq): number {
  const rate = NOMINAL_RATE[r.boxType] ?? 20;
  return r.quantity * rate;
}

const PAGE_SIZE = 10;

const BOX_TYPES = ["Mailer Box", "Shipping Box", "Rigid Box", "Corrugated Box", "Folding Carton", "Product Box"];

export default function Quotations() {
  const toast = useToast();
  const quotations = useBuyerQuotations();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBoxType, setApplyBoxType] = useState(BOX_TYPES[0]);
  const [applyQty, setApplyQty] = useState("500");
  const [applyNotes, setApplyNotes] = useState("");

  const [viewing, setViewing] = useState<Rfq | null>(null);
  const [cancelling, setCancelling] = useState<Rfq | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotations
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter(
        (r) =>
          !q ||
          r.id.toLowerCase().includes(q) ||
          r.boxType.toLowerCase().includes(q),
      )
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [quotations, search, status]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const clampedPage = Math.min(page, Math.max(pageCount, 1));
  const paged = useMemo(
    () => filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [filtered, clampedPage],
  );

  function resetFilterPage(fn: () => void) {
    fn();
    setPage(1);
  }

  function submitApplication() {
    setApplyOpen(false);
    toast.success("Quotation request submitted", "Our team will respond within 4 business hours.");
    setApplyBoxType(BOX_TYPES[0]);
    setApplyQty("500");
    setApplyNotes("");
  }

  function confirmCancel() {
    setCancelling(null);
    toast.success("Quotation cancelled");
  }

  const columns: Column<Rfq>[] = [
    {
      key: "id",
      header: "Quotation ID",
      render: (r) => <span className="font-semibold erp-text">{r.id}</span>,
    },
    {
      key: "date",
      header: "Date",
      hideBelow: "sm",
      render: (r) => <span className="erp-text-muted whitespace-nowrap">{formatDate(r.submittedAt)}</span>,
    },
    {
      key: "product",
      header: "Products",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate erp-text">{r.boxType}</p>
          {r.finishes.length > 0 && (
            <p className="truncate text-xs erp-text-faint">{r.finishes.join(", ")}</p>
          )}
        </div>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      className: "text-right",
      hideBelow: "md",
      render: (r) => <span className="tabular-nums erp-text-muted">{r.quantity.toLocaleString("en-IN")}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      render: (r) =>
        r.status === "pending" ? (
          <span className="text-xs erp-text-faint">On quote</span>
        ) : (
          <span className="font-semibold tabular-nums erp-text whitespace-nowrap">~{inr(indicativeAmount(r))}</span>
        ),
    },
    {
      key: "valid",
      header: "Valid Until",
      hideBelow: "lg",
      render: (r) => (
        <span className="erp-text-muted whitespace-nowrap">{r.slaDueAt ? formatDate(r.slaDueAt) : "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={Eye}
            aria-label={`View ${r.id}`}
            onClick={() => setViewing(r)}
          >
            <span className="sr-only sm:not-sr-only">View</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Download}
            aria-label={`Download ${r.id}`}
            onClick={() => toast.info("Quotation PDF downloading", `${r.id}.pdf`)}
          />
          {r.status !== "lost" && r.status !== "won" && (
            <Button
              size="sm"
              variant="ghost"
              icon={Ban}
              aria-label={`Cancel ${r.id}`}
              onClick={() => setCancelling(r)}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Quotations" }]}
        title="Quotations"
        subtitle="Your quotation requests and their status."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setApplyOpen(true)}>
            Apply for Quotation
          </Button>
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(v) => resetFilterPage(() => setSearch(v))}
          placeholder="Search by ID or box type…"
          className="w-full sm:max-w-xs"
          aria-label="Search quotations"
        />
        <Select
          value={status}
          onChange={(v) => resetFilterPage(() => setStatus(v))}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="quoted">Quoted</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </Select>
      </Toolbar>

      <Panel bodyClassName="p-0">
        {paged.length === 0 ? (
          <EmptyState
            title="No quotations found"
            message={
              quotations.length === 0
                ? "You haven't requested any quotations yet."
                : "No quotations match your filters."
            }
            action={
              quotations.length === 0 ? (
                <Button variant="primary" icon={Plus} onClick={() => setApplyOpen(true)}>
                  Apply for Quotation
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="px-4 sm:px-5">
            <DataTable
              columns={columns}
              rows={paged}
              rowKey={(r) => r.id}
              caption="Your quotation requests"
            />
          </div>
        )}
        {filtered.length > PAGE_SIZE && (
          <Pagination
            page={clampedPage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </Panel>

      {/* Apply for a new quotation */}
      <Dialog
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="Apply for Quotation"
        description="Tell us what you need and we'll get back with a quote within 4 business hours."
        footer={
          <>
            <Button variant="secondary" onClick={() => setApplyOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitApplication}
              disabled={!applyBoxType || Number(applyQty) <= 0}
            >
              Submit request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Box type</span>
            <Select value={applyBoxType} onChange={setApplyBoxType} className="w-full" aria-label="Box type">
              {BOX_TYPES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Quantity</span>
            <input
              type="number"
              min={1}
              value={applyQty}
              onChange={(e) => setApplyQty(e.target.value)}
              className="h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none transition-colors focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Notes (optional)</span>
            <textarea
              rows={3}
              value={applyNotes}
              onChange={(e) => setApplyNotes(e.target.value)}
              placeholder="Dimensions, material, printing, finishes, artwork…"
              className="w-full rounded-lg border erp-border erp-surface px-3 py-2 text-sm erp-text outline-none transition-colors placeholder:erp-text-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
            />
          </label>
        </div>
      </Dialog>

      {/* View a quotation's full requested config */}
      <Drawer
        open={viewing != null}
        onClose={() => setViewing(null)}
        title={viewing ? `Quotation ${viewing.id}` : "Quotation"}
        footer={
          viewing && (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                icon={Download}
                onClick={() => toast.info("Quotation PDF downloading", `${viewing.id}.pdf`)}
              >
                Download
              </Button>
            </div>
          )
        }
      >
        {viewing && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[viewing.status]}>{STATUS_LABEL[viewing.status]}</Badge>
              <span className="text-xs erp-text-faint">Submitted {formatDate(viewing.submittedAt)}</span>
            </div>
            <KeyValue
              items={[
                { label: "Box type", value: viewing.boxType },
                { label: "Dimensions", value: viewing.dimensions },
                { label: "Material", value: viewing.material },
                { label: "GSM", value: `${viewing.gsm}` },
                { label: "Printing", value: viewing.printing },
                { label: "Finishes", value: viewing.finishes.length ? viewing.finishes.join(", ") : "—" },
                { label: "Quantity", value: viewing.quantity.toLocaleString("en-IN") },
                { label: "Artwork file", value: viewing.artworkFile ?? "Not provided" },
                {
                  label: "Valid until",
                  value: viewing.slaDueAt ? formatDate(viewing.slaDueAt) : "—",
                },
                {
                  label: "Indicative amount",
                  value:
                    viewing.status === "pending"
                      ? "On quote"
                      : `~${inr(indicativeAmount(viewing))}`,
                },
              ]}
            />
          </div>
        )}
      </Drawer>

      {/* Cancel confirmation */}
      <Dialog
        open={cancelling != null}
        onClose={() => setCancelling(null)}
        title="Cancel quotation?"
        description={
          cancelling
            ? `Quotation ${cancelling.id} will be withdrawn. This cannot be undone.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button variant="danger" icon={Ban} onClick={confirmCancel}>
              Cancel quotation
            </Button>
          </>
        }
      />
    </div>
  );
}
