import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, XCircle } from "lucide-react";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, ErrorState, Panel } from "../components/Panel";
import { Badge, Button, PageHeader } from "../components/ui";
import { formatDateTime } from "../format";
import { useCatalogImports, useCatalogImport, type CatalogImportRow } from "../dashboard-api";

// ============================================================
// Admin → Catalog → Import History (Phase 14).
// Read-only audit of every bulk-import run, with a per-import error report the
// admin can download. Backed by GET /admin/catalog/imports[/:id].
// ============================================================

const fmtBytes = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(0)} KB` : `${b} B`;

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info"> = {
  COMPLETED: "success",
  COMPLETED_WITH_ERRORS: "warning",
  FAILED: "danger",
  PROCESSING: "info",
};

function downloadErrorReport(detail: NonNullable<ReturnType<typeof useCatalogImport>["data"]>) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = detail.errors.map((e) =>
    [String(e.rowNumber ?? ""), e.sku ?? "", e.level.toUpperCase(), e.field ?? "", e.message].map(esc).join(","),
  );
  const csv = ["Row,SKU,Level,Field,Message", ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `import-${detail.id}-errors.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function ImportDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useCatalogImport(id);
  if (q.status === "loading") return <Panel><TableSkeleton rows={4} cols={4} /></Panel>;
  if (q.status === "error" || !q.data) return <Panel><ErrorState message={q.error ?? "Could not load import"} onRetry={q.refetch} /></Panel>;
  const d = q.data;

  return (
    <Panel
      title={d.fileName ?? "Import"}
      action={
        <div className="flex gap-2">
          {d.errors.length > 0 && (
            <Button size="sm" variant="secondary" icon={Download} onClick={() => downloadErrorReport(d)}>Error report</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Created", d.created], ["Updated", d.updated], ["Skipped", d.skipped], ["Failed", d.failed],
        ].map(([label, n]) => (
          <div key={label} className="rounded-lg border erp-border-soft p-3">
            <div className="text-xs erp-text-faint">{label}</div>
            <div className="text-lg font-bold erp-text">{n as number}</div>
          </div>
        ))}
      </div>
      <p className="mb-3 text-xs erp-text-muted">
        {d.mode} · {d.totalRows} rows · {d.imagesMatched} images · by {d.actor} · {formatDateTime(d.startedAt)}
      </p>
      {d.errors.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No issues" message="Every row imported cleanly." />
      ) : (
        <div className="overflow-x-auto rounded-lg border erp-border">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead>
              <tr className="border-b erp-border-soft erp-text-muted">
                <th className="px-3 py-2 font-bold">Row</th>
                <th className="px-3 py-2 font-bold">SKU</th>
                <th className="px-3 py-2 font-bold">Level</th>
                <th className="px-3 py-2 font-bold">Field</th>
                <th className="px-3 py-2 font-bold">Message</th>
              </tr>
            </thead>
            <tbody>
              {d.errors.map((e) => (
                <tr key={e.id} className="border-b erp-border-soft last:border-0">
                  <td className="px-3 py-2 erp-text-muted">{e.rowNumber ?? "—"}</td>
                  <td className="px-3 py-2 font-mono erp-text">{e.sku ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={e.level === "error" ? "danger" : "warning"}>{e.level}</Badge>
                  </td>
                  <td className="px-3 py-2 erp-text-muted">{e.field ?? "—"}</td>
                  <td className="px-3 py-2 erp-text-muted">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function ImportHistory() {
  const q = useCatalogImports();
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<CatalogImportRow>[] = [
    { key: "file", header: "File", render: (r) => (
      <span className="inline-flex items-center gap-1.5 font-semibold erp-text">
        <FileSpreadsheet className="h-4 w-4 text-primary-500" aria-hidden /> {r.fileName ?? "—"}
      </span>
    ) },
    { key: "size", header: "Size", render: (r) => <span className="erp-text-muted">{r.fileSizeBytes ? fmtBytes(r.fileSizeBytes) : "—"}</span>, hideBelow: "md" },
    { key: "mode", header: "Mode", render: (r) => <span className="uppercase erp-text-muted">{r.mode}</span>, hideBelow: "sm" },
    { key: "counts", header: "Result", render: (r) => (
      <span className="erp-text-muted">
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{r.created}</span>
        {" / "}<span className="font-semibold text-sky-600 dark:text-sky-400">~{r.updated}</span>
        {r.failed > 0 && <> / <span className="font-semibold text-red-600 dark:text-red-400">✗{r.failed}</span></>}
      </span>
    ) },
    { key: "actor", header: "By", render: (r) => <span className="erp-text-muted">{r.actor}</span>, hideBelow: "md" },
    { key: "status", header: "Status", render: (r) => (
      <Badge tone={STATUS_TONE[r.status] ?? "info"}>
        {r.status === "COMPLETED" ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : r.status === "FAILED" ? <XCircle className="mr-1 inline h-3 w-3" /> : r.status === "COMPLETED_WITH_ERRORS" ? <AlertTriangle className="mr-1 inline h-3 w-3" /> : null}
        {r.status.replace(/_/g, " ").toLowerCase()}
      </Badge>
    ) },
    { key: "when", header: "When", render: (r) => <span className="erp-text-faint">{formatDateTime(r.startedAt)}</span>, hideBelow: "sm" },
    { key: "view", header: "", render: (r) => (
      <Button size="sm" variant="ghost" onClick={() => setOpenId(r.id)}>View</Button>
    ) },
  ];

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Catalog", to: "/admin/catalog" }, { label: "Import History" }]}
        title="Import History"
        subtitle="Every bulk catalog import, its outcome and error report."
        actions={<Link to="/admin/catalog"><Button variant="secondary">Bulk Import</Button></Link>}
      />

      {openId && <div className="mb-5"><ImportDetail id={openId} onClose={() => setOpenId(null)} /></div>}

      {q.status === "loading" && <Panel><TableSkeleton rows={6} cols={6} /></Panel>}
      {q.status === "error" && <Panel><ErrorState message={q.error} onRetry={q.refetch} /></Panel>}
      {q.status === "success" && (
        <Panel bodyClassName="p-0">
          {q.data.imports.length === 0 ? (
            <EmptyState title="No imports yet" message="Bulk catalog imports will be listed here with full audit detail." />
          ) : (
            <div className="px-4 py-4 sm:px-5">
              <DataTable
                caption="Import history"
                columns={columns}
                rows={q.data.imports}
                rowKey={(r) => r.id}
              />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
