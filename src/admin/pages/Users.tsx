import { useCallback, useEffect, useState } from "react";
import { UserRound, Briefcase, Factory, Plus, Search, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { request, describeApiError } from "@/lib/api/client";
import { adminSalesApi } from "@/lib/api/sales";
import { CustomerFormDialog } from "../crm/CustomerFormDialog";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { Panel, EmptyState } from "../components/Panel";
import { Dialog } from "../components/ui";

// One directory for everyone: an admin asks "who?" before "which module?".
// Customers, sales staff and sellers are all Users differing only by the
// profile attached to them, so they belong on one screen with tabs rather than
// three sidebar entries.

type UserType = "customer" | "sales" | "seller" | "admin";

interface DirectoryUser {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  type: UserType | "other";
  role: string;
  isActive: boolean;
  createdAt: string;
  employeeId: string | null;
  territory: string | null;
}

interface Directory {
  users: DirectoryUser[];
  counts: { all: number; customer: number; sales: number; seller: number; admin: number };
}

const TYPE_LABEL: Record<string, string> = {
  customer: "Customer",
  sales: "Sales Team",
  seller: "Seller",
  admin: "Admin",
  other: "Other",
};

const TABS = [
  { key: "", label: "All" },
  { key: "customer", label: "Customers" },
  { key: "sales", label: "Sales Team" },
  { key: "seller", label: "Sellers" },
] as const;

export default function Users() {
  const [tab, setTab] = useState<string>("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const qs = new URLSearchParams();
      if (tab) qs.set("type", tab);
      if (q.trim()) qs.set("q", q.trim());
      const s = qs.toString();
      setData(await request<Directory>(`/admin/sales/users${s ? `?${s}` : ""}`));
    } catch (e) {
      // Surface the failure rather than rendering an empty table, which would
      // read as "no users" and hide a broken API.
      setError(describeApiError(e).message);
      setData(null);
    }
  }, [tab, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const columns: Column<DirectoryUser>[] = [
    {
      key: "name",
      header: "User",
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate font-bold erp-text">{u.company || u.name}</p>
          <p className="truncate text-xs erp-text-muted">{u.company ? u.name : u.email}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (u) => (
        <span className="inline-flex rounded-full bg-dark-50 px-2.5 py-1 text-xs font-bold text-dark-700">
          {TYPE_LABEL[u.type] ?? u.type}
        </span>
      ),
    },
    { key: "contact", header: "Contact", render: (u) => <span className="erp-text-muted">{u.phone ?? u.email}</span>, hideBelow: "md" },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <span className={`text-xs font-bold ${u.isActive ? "text-green-700" : "text-dark-400"}`}>
          {u.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (u) => <span className="erp-text-muted">{new Date(u.createdAt).toLocaleDateString("en-IN")}</span>,
      hideBelow: "lg",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold erp-text">Users</h1>
        <button type="button" onClick={() => setAdding(true)}
          className="btn btn-primary btn-sm">
          <Plus className="h-4 w-4" aria-hidden /> Add user
        </button>
      </div>

      {/* Counts double as the tab control — the number is the useful part. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.map((t) => {
          const count = data ? (t.key ? data.counts[t.key as UserType] : data.counts.all) : null;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`rounded-xl border-2 p-3 text-left transition ${
                tab === t.key ? "border-green-500 bg-green-50" : "border-dark-200 bg-white hover:bg-dark-50"
              }`}>
              <p className="text-xs font-bold erp-text-muted">{t.label}</p>
              <p className="text-xl font-bold erp-text">{count ?? "—"}</p>
            </button>
          );
        })}
      </div>

      <Panel>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email or business"
            className="input w-full pl-9" />
        </div>

        {error ? (
          <p className="py-6 text-center text-sm text-red-600">{error}</p>
        ) : data === null ? (
          <TableSkeleton rows={5} cols={5} />
        ) : data.users.length === 0 ? (
          <EmptyState title="No users found" message="Try a different search or tab." />
        ) : (
          <DataTable columns={columns} rows={data.users} rowKey={(u) => u.id} />
        )}
      </Panel>

      <AddUserDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={() => { setAdding(false); void load(); }}
        onPickCustomer={() => { setAdding(false); setAddingCustomer(true); }}
      />
      <CustomerFormDialog
        open={addingCustomer}
        onClose={() => setAddingCustomer(false)}
        mode={{ kind: "create" }}
        onSaved={() => { setAddingCustomer(false); void load(); }}
      />
    </div>
  );
}

// ---- Add user -------------------------------------------------------------

const USER_TYPES = [
  { key: "customer", icon: UserRound, title: "Customer", sub: "Buys packaging from Zolo" },
  { key: "sales", icon: Briefcase, title: "Sales Team", sub: "Creates orders for customers" },
  { key: "seller", icon: Factory, title: "Seller", sub: "Supplies products" },
] as const;

/**
 * Asks WHAT KIND of user first, then shows only that type's fields.
 *
 * The alternative — one universal form with a role dropdown — makes an admin
 * choose between values like "seller_owner" and leaves most fields irrelevant
 * to whoever they are actually creating.
 */
function AddUserDialog({
  open,
  onClose,
  onCreated,
  onPickCustomer,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onPickCustomer: () => void;
}) {
  const [type, setType] = useState<(typeof USER_TYPES)[number]["key"] | null>(null);

  return (
    <Dialog
      open={open}
      onClose={() => { setType(null); onClose(); }}
      title={type ? `New ${USER_TYPES.find((t) => t.key === type)!.title.toLowerCase()}` : "Add user"}
      description={type ? undefined : "What type of user is this?"}
      size={type ? "lg" : "md"}
    >
      {!type ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {USER_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              // "Customer" hands off to the canonical CustomerFormDialog — the
              // same form the Customers page uses — rather than a second
              // hand-rolled one that collected different fields.
              onClick={() => (t.key === "customer" ? onPickCustomer() : setType(t.key))}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-dark-200 p-5 text-center transition hover:border-green-500 hover:bg-green-50">
              <t.icon className="h-7 w-7 text-green-600" aria-hidden />
              <span className="font-bold erp-text">{t.title}</span>
              <span className="text-xs erp-text-muted">{t.sub}</span>
            </button>
          ))}
        </div>
      ) : type === "sales" ? (
        <SalespersonForm onBack={() => setType(null)} onCreated={onCreated} />
      ) : (
        <SellerNotice onBack={() => setType(null)} />
      )}
    </Dialog>
  );
}

function FormRow({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold erp-text">
        {label}{required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function SalespersonForm({ onBack, onCreated }: { onBack: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", employeeId: "", phone: "", email: "", password: "", territory: "", branch: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true);
    try {
      await adminSalesApi.create(f);
      toast.success("Salesperson created", "They can sign in with the email and password you set.");
      onCreated();
    } catch (e) {
      toast.error("Couldn't create salesperson", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label="Name" required><input className="input w-full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></FormRow>
        <FormRow label="Employee ID" required><input className="input w-full" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value.toUpperCase() })} /></FormRow>
        <FormRow label="Email (login)" required><input className="input w-full" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormRow>
        <FormRow label="Password" required><input className="input w-full" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></FormRow>
        <FormRow label="Phone"><input className="input w-full" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormRow>
        <FormRow label="Territory"><input className="input w-full" value={f.territory} onChange={(e) => setF({ ...f, territory: e.target.value })} /></FormRow>
      </div>
      <p className="text-xs erp-text-muted">
        Access is set by the user type: a salesperson reaches the sales portal only — never product masters,
        settings or another rep&apos;s records.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary btn-sm"
          disabled={busy || !f.name.trim() || !f.employeeId.trim() || !f.email.trim() || f.password.length < 8}
          onClick={save}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create salesperson
        </button>
      </div>
    </div>
  );
}

/**
 * Sellers are created by the suppliers themselves through onboarding, which
 * collects KYC an admin cannot fill in on their behalf. Admin approves, not
 * creates — so this points at the real path rather than offering a form that
 * would produce an unverifiable record.
 */
function SellerNotice({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm erp-text">
        Sellers register themselves through supplier onboarding, which collects GST, PAN and bank
        verification. An admin reviews and approves that application rather than creating the account.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={onBack}>Back</button>
        <a href="/admin/sellers" className="btn btn-primary btn-sm">Review seller applications</a>
      </div>
    </div>
  );
}
