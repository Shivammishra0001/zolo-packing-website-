import { useMemo, useState } from "react";
import { IndianRupee, Building2, Users, UserPlus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, Panel, QueryState } from "../components/Panel";
import {
  Badge,
  Button,
  Dialog,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Toolbar,
} from "../components/ui";
import { inr } from "../format";
import { useAdminCustomers, asMockQuery } from "../dashboard-api";
import { SEGMENT_LABEL } from "../statuses";
import type { Customer, CustomerSegment } from "../types";

const SEGMENT_TONE: Record<CustomerSegment, "primary" | "info" | "success"> = {
  small_seller: "info",
  d2c_brand: "primary",
  enterprise: "success",
};

const PAGE_SIZE = 8;

// ---------- New customer dialog ----------

function NewCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ company: "", name: "", email: "", segment: "small_seller" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save() {
    toast.success("Customer created", `${form.company || "New customer"} has been added.`);
    setForm({ company: "", name: "", email: "", segment: "small_seller" });
    onClose();
  }

  const field = "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none transition-colors placeholder:erp-text-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Customer"
      description="Create a customer profile. You can add addresses and GST details later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Create customer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Company</span>
          <input
            className={field}
            placeholder="Acme Packaging Co."
            value={form.company}
            onChange={(e) => set("company")(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Contact name</span>
          <input
            className={field}
            placeholder="Full name"
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Email</span>
          <input
            type="email"
            className={field}
            placeholder="name@company.com"
            value={form.email}
            onChange={(e) => set("email")(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Segment</span>
          <Select value={form.segment} onChange={set("segment")} className="w-full" aria-label="Segment">
            <option value="small_seller">Small Seller</option>
            <option value="d2c_brand">D2C Brand</option>
            <option value="enterprise">Enterprise</option>
          </Select>
        </label>
      </div>
    </Dialog>
  );
}

// ---------- Page ----------

export default function Customers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [page, setPage] = useState(1);

  // Real buyers from PostgreSQL, with order totals aggregated server-side.
  // Polls, so a customer who registers now shows up here without a reload.
  const live = useAdminCustomers();
  // Existing panel JSX consumes the MockQuery shape; adapt rather than rewrite.
  const q = asMockQuery(live);

  // Company comes from the buyer's organisation and city from their address
  // book (falling back to the latest order's shipping snapshot). Either can be
  // genuinely absent — that stays null here and renders as an em dash, so an
  // empty field is visibly "not recorded" rather than invented.
  const customers: Customer[] = useMemo(
    () =>
      (live.data?.customers ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company ?? "",
        segment: c.segment,
        email: c.email,
        phone: c.phone ?? "",
        city: c.city ?? "",
        totalOrders: c.totalOrders,
        lifetimeValue: c.lifetimeValueMinor / 100,
      })),
    [live.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (segment !== "all" && c.segment !== segment) return false;
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        c.company.toLowerCase().includes(term) ||
        c.city.toLowerCase().includes(term) ||
        c.phone.toLowerCase().includes(term)
      );
    });
  }, [customers, search, segment]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(pageCount, 1));
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const totalLtv = customers.reduce((s, c) => s + c.lifetimeValue, 0);
  const enterpriseCount = customers.filter((c) => c.segment === "enterprise").length;
  const d2cCount = customers.filter((c) => c.segment === "d2c_brand").length;

  const columns: Column<Customer>[] = [
    {
      // COMPANY / NAME — company leads when we have one, otherwise the person's
      // name is promoted so the row is never headed by a placeholder.
      key: "company",
      header: "Company / Name",
      render: (c) => {
        const primary = c.company || c.name;
        const secondary = c.company ? c.name : c.email;
        return (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg erp-surface-2 text-xs font-bold erp-text-muted">
              {primary.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold erp-text">{primary}</p>
              <p className="truncate text-xs erp-text-muted">{secondary}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "contact",
      header: "Contact",
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate erp-text">{c.phone || <span className="erp-text-faint">—</span>}</p>
          <p className="truncate text-xs erp-text-muted">{c.email}</p>
        </div>
      ),
      hideBelow: "md",
    },
    {
      key: "segment",
      header: "Segment",
      render: (c) => <Badge tone={SEGMENT_TONE[c.segment]}>{SEGMENT_LABEL[c.segment]}</Badge>,
    },
    {
      key: "city",
      header: "City",
      render: (c) =>
        c.city ? <span className="erp-text-muted">{c.city}</span> : <span className="erp-text-faint">—</span>,
      hideBelow: "sm",
    },
    {
      key: "orders",
      header: "Orders",
      className: "text-right",
      render: (c) => <span className="tabular-nums erp-text-muted">{c.totalOrders}</span>,
      hideBelow: "sm",
    },
    {
      key: "ltv",
      header: "Order Value",
      className: "text-right",
      render: (c) => <span className="font-semibold tabular-nums erp-text">{inr(c.lifetimeValue)}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Customers" }]}
        title="Customers"
        subtitle="Every buyer, brand and enterprise account you sell packaging to."
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setDialogOpen(true)}>
            New Customer
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {q.loading ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label="Total Customers" value={customers.length} icon={Users} detail="active accounts" to="/admin/customers" />
            <MetricCard label="Enterprise" value={enterpriseCount} icon={Building2} detail={`${d2cCount} D2C brands`} to="/admin/customers" />
            <MetricCard label="Total Lifetime Value" value={inr(totalLtv)} icon={IndianRupee} detail="across all accounts" to="/admin/customers" />
            <MetricCard label="Avg. LTV" value={inr(customers.length ? totalLtv / customers.length : 0)} icon={IndianRupee} detail="per customer" to="/admin/customers" />
          </>
        )}
      </div>

      <Panel bodyClassName="p-0">
        <div className="border-b erp-border-soft p-4 sm:p-5">
          <Toolbar>
            <SearchInput
              className="w-full sm:max-w-xs"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search company, name, email, phone or city…"
            />
            <Select
              value={segment}
              onChange={(v) => {
                setSegment(v);
                setPage(1);
              }}
              aria-label="Filter by segment"
            >
              <option value="all">All segments</option>
              <option value="small_seller">Small Seller</option>
              <option value="d2c_brand">D2C Brand</option>
              <option value="enterprise">Enterprise</option>
            </Select>
            <span className="ml-auto text-xs erp-text-muted">
              {filtered.length} of {customers.length}
            </span>
          </Toolbar>
        </div>

        <div className="p-4 sm:p-5">
          <QueryState
            query={q}
            skeleton={<TableSkeleton rows={6} cols={5} />}
            isEmpty={() => filtered.length === 0}
            empty={<EmptyState title="No customers match" message="Try a different search term or segment." />}
          >
            {() => (
              <DataTable
                caption="Customer accounts"
                columns={columns}
                rows={pageRows}
                rowKey={(c) => c.id}
                rowHref={(c) => `/admin/customers/${c.id}`}
              />
            )}
          </QueryState>
        </div>

        {filtered.length > PAGE_SIZE && (
          <Pagination
            page={safePage}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </Panel>

      <NewCustomerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
