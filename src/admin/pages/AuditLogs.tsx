import { useMemo, useState } from "react";
import { Activity, History } from "lucide-react";
import { Badge, PageHeader, SearchInput, Select, Timeline, Toolbar, type TimelineEntry } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { MetricCard } from "../components/MetricCard";
import { EmptyState, QueryState } from "../components/Panel";
import { TableSkeleton } from "../components/DataTable";
import { formatDateTime, relativeTime } from "../format";
import { useAdminActivity, asMockQuery } from "../dashboard-api";
import type { AuditEvent } from "../types";

const MODULE_TONE: Record<string, "primary" | "info" | "success" | "warning" | "danger" | "neutral"> = {
  Artwork: "primary",
  Quotations: "info",
  Procurement: "warning",
  Production: "success",
  Finance: "danger",
  Shipping: "info",
  Catalog: "neutral",
};

export default function AuditLogs() {
  // Real events from the AuditLog table (GET /admin/activity).
  const live = useAdminActivity(200);
  const q = asMockQuery(live);
  const auditEvents: AuditEvent[] = useMemo(
    () =>
      (live.data?.activity ?? []).map((a) => ({
        id: a.id,
        user: a.actor,
        action: a.title,
        // "order.status_changed" → module "order"; the feed groups by this.
        module: a.eventType.split(".")[0] ?? "system",
        entity: a.body || `${a.entityType ?? ""} ${a.entityId ?? ""}`.trim(),
        at: a.createdAt,
      })),
    [live.data],
  );
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("all");
  const [range, setRange] = useState("7d");

  const modules = useMemo(() => Array.from(new Set(auditEvents.map((e) => e.module))), []);

  const moduleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of auditEvents) c[e.module] = (c[e.module] ?? 0) + 1;
    return c;
  }, []);

  const eventsToday = useMemo(() => {
    const now = Date.now();
    return auditEvents.filter((e) => now - new Date(e.at).getTime() < 86400000).length;
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const now = Date.now();
    const rangeMs = range === "1d" ? 86400000 : range === "7d" ? 7 * 86400000 : 30 * 86400000;
    return auditEvents.filter((e) => {
      if (module !== "all" && e.module !== module) return false;
      if (now - new Date(e.at).getTime() > rangeMs) return false;
      if (!s) return true;
      return [e.user, e.action, e.entity, e.module].some((f) => f.toLowerCase().includes(s));
    });
  }, [search, module, range]);

  const columns: Column<AuditEvent>[] = [
    { key: "user", header: "User", render: (e) => <span className="font-semibold erp-text">{e.user}</span> },
    { key: "action", header: "Action", render: (e) => <span className="erp-text-muted">{e.action}</span> },
    { key: "module", header: "Module", render: (e) => <Badge tone={MODULE_TONE[e.module] ?? "neutral"}>{e.module}</Badge> },
    { key: "entity", header: "Entity", render: (e) => <span className="font-mono text-xs erp-text-muted">{e.entity}</span>, hideBelow: "md" },
    { key: "at", header: "When", render: (e) => <span className="erp-text-faint" title={formatDateTime(e.at)}>{relativeTime(e.at)}</span> },
  ];

  const timelineEntries: TimelineEntry[] = filtered.slice(0, 6).map((e) => ({
    id: e.id,
    title: <span><span className="font-semibold">{e.user}</span> {e.action}</span>,
    meta: <span>{e.entity}</span>,
    time: relativeTime(e.at),
    tone: MODULE_TONE[e.module] ?? "neutral",
  }));

  const topModules = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Audit Logs" }]}
        title="Audit Logs"
        subtitle="A tamper-evident trail of every action across the workspace."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Events Today" value={eventsToday} icon={Activity} to="/admin/audit-logs" detail="last 24 hours" />
        {topModules.map(([m, count]) => (
          <MetricCard key={m} label={`${m} events`} value={count} icon={History} to="/admin/audit-logs" detail="in period" />
        ))}
      </div>

      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search user, action, entity…" className="w-full sm:w-80" />
        <Select value={module} onChange={setModule} aria-label="Filter by module">
          <option value="all">All modules</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={range} onChange={setRange} aria-label="Date range">
          <option value="1d">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </Select>
      </Toolbar>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="erp-card card-shadow p-4 sm:p-5">
            <QueryState
              query={q}
              skeleton={<TableSkeleton rows={6} cols={5} />}
              isEmpty={() => filtered.length === 0}
              empty={<EmptyState icon={History} title="No events" message="No activity matches the current filters." />}
            >
              {() => <DataTable caption="Audit events" columns={columns} rows={filtered} rowKey={(e) => e.id} />}
            </QueryState>
          </div>
        </div>
        <div>
          <div className="erp-card card-shadow p-4 sm:p-5">
            <h3 className="mb-4 text-sm font-bold erp-text">Recent activity</h3>
            {timelineEntries.length === 0 ? (
              <p className="text-sm erp-text-muted">Nothing in this period.</p>
            ) : (
              <Timeline entries={timelineEntries} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
