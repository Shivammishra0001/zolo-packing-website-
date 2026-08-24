import { useMemo, useState } from "react";
import { CircleCheckBig, FileText, IndianRupee, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { MetricCard } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, Panel, QueryState } from "../components/Panel";
import { SlaCountdown } from "../components/SlaCountdown";
import {
  Badge,
  Button,
  Dialog,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
  Toolbar,
} from "../components/ui";
import { inr, relativeTime } from "../format";
import { useMockQuery, useNow } from "../hooks";
import { customers, rfqs } from "../mock-data";
import type { Rfq } from "../types";

type RfqStatus = Rfq["status"];

const STATUS_META: Record<RfqStatus, { label: string; tone: "warning" | "info" | "success" | "danger" }> = {
  pending: { label: "Pending", tone: "warning" },
  quoted: { label: "Quoted", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
};

// rough estimated value per RFQ for the metric row (no price on the entity)
function estValue(r: Rfq): number {
  return r.quantity * (r.gsm >= 400 ? 42 : r.gsm >= 350 ? 28 : 18);
}

function NewQuotationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState("");
  const submit = () => {
    toast.success("Quotation started", customer ? `New RFQ opened for ${customer}.` : "New RFQ opened.");
    setCustomer("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Quotation"
      description="Open a blank RFQ and build the quote from a configuration."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Plus} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs font-semibold erp-text-muted">Customer</span>
        <Select value={customer} onChange={setCustomer} aria-label="Customer" className="w-full">
          <option value="">Select customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.company}>
              {c.company}
            </option>
          ))}
        </Select>
      </label>
    </Dialog>
  );
}

export default function Quotations() {
  const q = useMockQuery(rfqs, 500);
  const [tab, setTab] = useState<"all" | RfqStatus>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const now = useNow();

  const all = q.data ?? [];

  const counts = useMemo(
    () => ({
      all: all.length,
      pending: all.filter((r) => r.status === "pending").length,
      quoted: all.filter((r) => r.status === "quoted").length,
      won: all.filter((r) => r.status === "won").length,
      lost: all.filter((r) => r.status === "lost").length,
    }),
    [all],
  );

  const totalValue = useMemo(() => all.reduce((sum, r) => sum + estValue(r), 0), [all]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      if (tab !== "all" && r.status !== tab) return false;
      if (term && !r.id.toLowerCase().includes(term) && !r.customerName.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [all, tab, search]);

  const columns: Column<Rfq>[] = [
    {
      key: "id",
      header: "RFQ ID",
      render: (r) => <span className="font-bold erp-text">{r.id}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      render: (r) => <span className="block max-w-52 truncate erp-text-muted">{r.customerName}</span>,
    },
    {
      key: "product",
      header: "Product",
      render: (r) => (
        <span className="block max-w-64 truncate erp-text-muted">
          {r.boxType} · {r.quantity.toLocaleString("en-IN")} pcs
          {r.finishes.length > 0 && ` · ${r.finishes.join(", ")}`}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "submitted",
      header: "Submitted",
      render: (r) => <span className="erp-text-muted">{relativeTime(r.submittedAt, now)}</span>,
      hideBelow: "sm",
    },
    {
      key: "sla",
      header: "SLA",
      render: (r) =>
        r.status === "pending" ? <SlaCountdown dueAt={r.slaDueAt} /> : <span className="erp-text-faint">—</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Quotations" }]}
        title="Quotations"
        subtitle="RFQ requests, live quote SLAs, and conversion tracking."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setDialogOpen(true)}>
            New Quotation
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pending RFQs"
          value={counts.pending}
          icon={FileText}
          tone={counts.pending > 0 ? "warn" : "default"}
          to="/admin/quotes"
        />
        <MetricCard label="Quoted" value={counts.quoted} icon={FileText} to="/admin/quotes" />
        <MetricCard label="Won" value={counts.won} icon={CircleCheckBig} to="/admin/quotes" />
        <MetricCard label="Pipeline Value" value={inr(totalValue)} icon={IndianRupee} to="/admin/quotes" />
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            { key: "all", label: "All", count: counts.all },
            { key: "pending", label: "Pending", count: counts.pending },
            { key: "quoted", label: "Quoted", count: counts.quoted },
            { key: "won", label: "Won", count: counts.won },
            { key: "lost", label: "Lost", count: counts.lost },
          ]}
          active={tab}
          onChange={(k) => setTab(k as "all" | RfqStatus)}
        />
      </div>

      <div className="space-y-4">
        <Toolbar>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search RFQ ID or customer…"
            className="w-full sm:w-72"
          />
        </Toolbar>

        <QueryState
          query={q}
          skeleton={
            <Panel>
              <TableSkeleton rows={7} cols={6} />
            </Panel>
          }
        >
          {() => (
            <Panel bodyClassName="p-0">
              {filtered.length === 0 ? (
                <EmptyState title="No quotations" message="No RFQs match this view. Try another tab or search." />
              ) : (
                <div className="px-4 py-4 sm:px-5">
                  <DataTable
                    caption="RFQ list"
                    columns={columns}
                    rows={filtered}
                    rowKey={(r) => r.id}
                    rowHref={(r) => `/admin/quotes/${r.id}`}
                  />
                </div>
              )}
            </Panel>
          )}
        </QueryState>
      </div>

      <NewQuotationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
