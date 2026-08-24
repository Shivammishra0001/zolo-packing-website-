import { useMemo, useState } from "react";
import { Download, LayoutTemplate, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader, SearchInput, Select, Toolbar } from "../components/ui";
import { EmptyState, ListSkeleton, QueryState } from "../components/Panel";
import { formatDate } from "../format";
import { useMockQuery } from "../hooks";
import { packagingTemplates } from "../mock-data-ext";
import type { PackagingTemplate } from "../types";

const TYPE_TONE: Record<string, "primary" | "info" | "success" | "warning" | "neutral"> = {
  "Mailer Box": "primary",
  "Rigid Box": "info",
  "Folding Carton": "success",
  Corrugated: "warning",
  Sleeve: "neutral",
};

function TemplateCard({ t, onUse, onDownload }: { t: PackagingTemplate; onUse: (t: PackagingTemplate) => void; onDownload: (t: PackagingTemplate) => void }) {
  return (
    <div className="flex flex-col gap-3 erp-card card-shadow p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg erp-surface-2 text-primary-500">
          <LayoutTemplate className="h-5 w-5" aria-hidden />
        </div>
        <Badge tone={TYPE_TONE[t.type] ?? "neutral"}>{t.type}</Badge>
      </div>
      <div>
        <h3 className="text-sm font-bold erp-text">{t.name}</h3>
        <p className="mt-0.5 font-mono text-xs erp-text-faint">{t.dielineFile}</p>
      </div>
      <div className="flex items-center gap-3 text-xs erp-text-muted">
        <span>Used <span className="font-bold erp-text">{t.usageCount}×</span></span>
        <span aria-hidden>·</span>
        <span>Updated {formatDate(t.updatedAt)}</span>
      </div>
      <div className="mt-1 flex gap-2">
        <Button size="sm" variant="secondary" icon={Download} className="flex-1" onClick={() => onDownload(t)}>
          Dieline
        </Button>
        <Button size="sm" variant="primary" className="flex-1" onClick={() => onUse(t)}>
          Use Template
        </Button>
      </div>
    </div>
  );
}

export default function PackagingTemplates() {
  const q = useMockQuery(packagingTemplates, 500);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "Mailer Box" });

  const types = useMemo(() => Array.from(new Set(packagingTemplates.map((t) => t.type))), []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return packagingTemplates.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (!s) return true;
      return t.name.toLowerCase().includes(s) || t.dielineFile.toLowerCase().includes(s);
    });
  }, [search, type]);

  function createTemplate() {
    setDialogOpen(false);
    toast.success("Template created", `${form.name || "New template"} added to the library.`);
    setForm({ name: "", type: "Mailer Box" });
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Packaging Templates" }]}
        title="Packaging Templates"
        subtitle="Reusable dielines and box specs your team can drop into any order."
        actions={<Button variant="primary" icon={Plus} onClick={() => setDialogOpen(true)}>New Template</Button>}
      />

      <Toolbar className="mb-5">
        <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" className="w-full sm:w-72" />
        <Select value={type} onChange={setType} aria-label="Filter by type">
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </Toolbar>

      <QueryState
        query={q}
        skeleton={<ListSkeleton rows={5} />}
        isEmpty={() => filtered.length === 0}
        empty={<EmptyState icon={LayoutTemplate} title="No templates found" message="Try a different search or filter." />}
      >
        {() => (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <TemplateCard
                key={t.id}
                t={t}
                onUse={(x) => toast.success("Template applied", `${x.name} is ready to configure on a new order.`)}
                onDownload={(x) => toast.info("Downloading dieline", x.dielineFile)}
              />
            ))}
          </div>
        )}
      </QueryState>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="New Packaging Template"
        description="Create a reusable dieline template."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={createTemplate}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Template name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Standard Mailer Dieline"
              className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Box type</span>
            <Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} className="mt-1 w-full">
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </label>
        </div>
      </Dialog>
    </div>
  );
}
