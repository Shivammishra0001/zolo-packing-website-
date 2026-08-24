import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleCheck,
  CircleX,
  Cpu,
  Factory,
  Gauge,
  ListChecks,
  Play,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { MetricCard } from "../components/MetricCard";
import { TableSkeleton } from "../components/DataTable";
import { EmptyState, Panel, QueryState } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import {
  Badge,
  Button,
  Drawer,
  KeyValue,
  PageHeader,
  Select,
  Tabs,
  Toolbar,
  type TabItem,
} from "../components/ui";
import { dueLabel } from "../format";
import { useMockQuery, useNow } from "../hooks";
import { jobCards, orders } from "../mock-data";
import { machines } from "../mock-data-ext";
import { DELAYED_META, JOB_STAGE } from "../statuses";
import { MACHINE_STATE } from "../statuses-ext";
import type { JobCard, JobStage, Machine } from "../types";

// ---------- Local helpers ----------

const STAGE_OPTIONS: { value: JobStage | "all"; label: string }[] = [
  { value: "all", label: "All stages" },
  { value: "printing", label: "Printing" },
  { value: "lamination", label: "Lamination" },
  { value: "die_cutting", label: "Die Cutting" },
  { value: "pasting", label: "Pasting" },
  { value: "qc", label: "QC" },
];

function ProgressBar({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(Math.round((value / total) * 100), 100) : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full erp-surface-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums erp-text-muted">{pct}%</span>
    </div>
  );
}

// ---------- Job Queue tab ----------

function JobQueue({ onSelect }: { onSelect: (job: JobCard) => void }) {
  const q = useMockQuery(jobCards, 500);
  const now = useNow();
  const [stage, setStage] = useState<JobStage | "all">("all");

  const rows = useMemo(() => {
    const data = q.data ?? [];
    return stage === "all" ? data : data.filter((j) => j.stage === stage);
  }, [q.data, stage]);

  const headCell = "px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0 last:pr-0";
  const bodyCell = "px-3 py-3 first:pl-0 last:pr-0";

  return (
    <div className="space-y-4">
      <Toolbar>
        <Select value={stage} onChange={(v) => setStage(v as JobStage | "all")} aria-label="Filter by stage">
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <span className="text-xs erp-text-faint">{rows.length} job{rows.length === 1 ? "" : "s"}</span>
      </Toolbar>
      <Panel bodyClassName="p-0">
        <QueryState query={q} skeleton={<div className="p-4"><TableSkeleton rows={8} cols={6} /></div>}>
          {() =>
            rows.length === 0 ? (
              <EmptyState icon={Factory} title="No jobs" message="No jobs match this stage filter." />
            ) : (
              <div className="overflow-x-auto px-4 sm:px-5">
                <table className="w-full text-sm">
                  <caption className="sr-only">Job queue — select a row for details</caption>
                  <thead>
                    <tr className="border-b erp-border text-left">
                      <th scope="col" className={headCell}>Job ID</th>
                      <th scope="col" className={cn(headCell, "hidden md:table-cell")}>Order</th>
                      <th scope="col" className={cn(headCell, "hidden sm:table-cell")}>Customer</th>
                      <th scope="col" className={headCell}>Stage</th>
                      <th scope="col" className={cn(headCell, "hidden lg:table-cell")}>Machine</th>
                      <th scope="col" className={cn(headCell, "min-w-[140px]")}>Progress</th>
                      <th scope="col" className={headCell}>Dispatch Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((j) => (
                      <tr
                        key={j.id}
                        tabIndex={0}
                        role="button"
                        aria-label={`Open job ${j.id}`}
                        onClick={() => onSelect(j)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(j);
                          }
                        }}
                        className={cn(
                          "cursor-pointer border-b erp-border-soft transition-colors last:border-0 erp-hover focus-visible:erp-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                          j.delayed && "bg-red-50/50 dark:bg-red-500/5",
                        )}
                      >
                        <td className={cn(bodyCell, "font-semibold erp-text")}>{j.id}</td>
                        <td className={cn(bodyCell, "hidden md:table-cell erp-text-muted")}>{j.orderId}</td>
                        <td className={cn(bodyCell, "hidden sm:table-cell")}>
                          <span className="block max-w-44 truncate erp-text-muted">{j.customerName}</span>
                        </td>
                        <td className={bodyCell}>
                          <StatusBadge meta={j.delayed ? DELAYED_META : JOB_STAGE[j.stage]} />
                        </td>
                        <td className={cn(bodyCell, "hidden lg:table-cell erp-text-muted")}>{j.machine}</td>
                        <td className={cn(bodyCell, "min-w-[140px]")}>
                          <ProgressBar value={j.goodQty} total={j.plannedQty} />
                        </td>
                        <td className={bodyCell}>
                          <span className={cn("font-semibold", new Date(j.dispatchDueAt).getTime() < now ? "text-red-600 dark:text-red-400" : "erp-text")}>
                            {dueLabel(j.dispatchDueAt, now)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryState>
      </Panel>
    </div>
  );
}

function JobDrawer({ job, onClose }: { job: JobCard | null; onClose: () => void }) {
  const toast = useToast();
  if (!job) return null;
  const order = orders.find((o) => o.id === job.orderId);
  const pct = job.plannedQty > 0 ? Math.round((job.goodQty / job.plannedQty) * 100) : 0;

  return (
    <Drawer
      open={!!job}
      onClose={onClose}
      title={job.id}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            icon={Play}
            onClick={() => toast.info("Job started", `${job.id} moved to the active queue.`)}
          >
            Start
          </Button>
          <Button
            variant="primary"
            icon={CircleCheck}
            onClick={() => {
              toast.success("Stage completed", `${job.id} advanced from ${JOB_STAGE[job.stage].label}.`);
              onClose();
            }}
          >
            Complete
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge meta={job.delayed ? DELAYED_META : JOB_STAGE[job.stage]} />
          {job.delayed && <span className="text-xs font-semibold text-red-600 dark:text-red-400">Missed dispatch date</span>}
        </div>
        <KeyValue
          items={[
            { label: "Order", value: job.orderId },
            { label: "Customer", value: order?.customerName ?? job.customerName },
            { label: "Product", value: job.product },
            { label: "Machine", value: job.machine },
            { label: "Planned Qty", value: job.plannedQty.toLocaleString("en-IN") },
            { label: "Good Qty", value: job.goodQty.toLocaleString("en-IN") },
            { label: "Waste Qty", value: job.wasteQty.toLocaleString("en-IN") },
            { label: "Dispatch Due", value: dueLabel(job.dispatchDueAt) },
          ]}
        />
        <div className="rounded-xl border erp-border erp-surface-2 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide erp-text-muted">Production progress</span>
            <span className="text-sm font-bold erp-text">{pct}%</span>
          </div>
          <ProgressBar value={job.goodQty} total={job.plannedQty} />
          <p className="mt-2 text-xs erp-text-faint">
            {job.goodQty.toLocaleString("en-IN")} of {job.plannedQty.toLocaleString("en-IN")} good units ·{" "}
            {job.wasteQty.toLocaleString("en-IN")} waste
          </p>
        </div>
      </div>
    </Drawer>
  );
}

// ---------- Machines tab ----------

function MachineCard({ machine }: { machine: Machine }) {
  const meta = MACHINE_STATE[machine.state];
  return (
    <div className="flex flex-col gap-3 rounded-xl border erp-border erp-surface card-shadow p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg erp-surface-2 erp-text-muted">
            <Cpu className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold erp-text">{machine.name}</p>
            <p className="text-xs erp-text-faint">{machine.type}</p>
          </div>
        </div>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="erp-text-muted">Current job</span>
        <span className="font-semibold erp-text">{machine.currentJob ?? "—"}</span>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="erp-text-muted">Utilization</span>
          <span className="font-semibold erp-text tabular-nums">{machine.utilizationPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full erp-surface-2" role="progressbar" aria-valuenow={machine.utilizationPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${machine.utilizationPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function MachinesGrid() {
  const q = useMockQuery(machines, 500);
  return (
    <QueryState
      query={q}
      skeleton={
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="erp-skeleton h-[168px] rounded-xl" />
          ))}
        </div>
      }
    >
      {(data) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((m) => (
            <MachineCard key={m.id} machine={m} />
          ))}
        </div>
      )}
    </QueryState>
  );
}

// ---------- Quality Check tab ----------

type QcVerdict = "pending" | "pass" | "fail";

function QualityCheck() {
  const toast = useToast();
  const qcJobs = useMemo(() => jobCards.filter((j) => j.stage === "qc"), []);
  const [verdicts, setVerdicts] = useState<Record<string, QcVerdict>>({});

  if (qcJobs.length === 0) {
    return <EmptyState icon={ListChecks} title="Nothing in QC" message="No jobs are at the quality-check stage." />;
  }

  return (
    <div className="space-y-4">
      {qcJobs.map((job) => {
        const verdict = verdicts[job.id] ?? "pending";
        const yieldPct = job.plannedQty > 0 ? Math.round((job.goodQty / (job.goodQty + job.wasteQty || 1)) * 100) : 0;
        return (
          <Panel key={job.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold erp-text">
                  {job.id} · <span className="erp-text-muted">{job.product}</span>
                </p>
                <p className="mt-0.5 text-xs erp-text-faint">
                  {job.customerName} · {job.machine}
                </p>
                <div className="mt-3 flex flex-wrap gap-4 text-xs">
                  <span className="erp-text-muted">
                    Good: <span className="font-bold text-emerald-600 dark:text-emerald-400">{job.goodQty.toLocaleString("en-IN")}</span>
                  </span>
                  <span className="erp-text-muted">
                    Waste: <span className="font-bold text-red-600 dark:text-red-400">{job.wasteQty.toLocaleString("en-IN")}</span>
                  </span>
                  <span className="erp-text-muted">
                    Yield: <span className="font-bold erp-text">{yieldPct}%</span>
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVerdicts((v) => ({ ...v, [job.id]: "pass" }))}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
                      verdict === "pass"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "erp-border erp-text-muted hover:erp-surface-2",
                    )}
                    aria-pressed={verdict === "pass"}
                  >
                    <CircleCheck className="h-4 w-4" aria-hidden /> Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerdicts((v) => ({ ...v, [job.id]: "fail" }))}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
                      verdict === "fail"
                        ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                        : "erp-border erp-text-muted hover:erp-surface-2",
                    )}
                    aria-pressed={verdict === "fail"}
                  >
                    <CircleX className="h-4 w-4" aria-hidden /> Fail
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  icon={CheckCircle2}
                  disabled={verdict === "pending"}
                  onClick={() =>
                    toast.success(
                      "QC completed",
                      `${job.id} marked ${verdict === "pass" ? "passed" : "failed"}.`,
                    )
                  }
                >
                  Complete QC
                </Button>
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

// ---------- Page ----------

export default function Production() {
  const [tab, setTab] = useState("queue");
  const [selected, setSelected] = useState<JobCard | null>(null);

  const running = machines.filter((m) => m.state === "running").length;
  const delayed = jobCards.filter((j) => j.delayed).length;
  const avgUtil = machines.length ? Math.round(machines.reduce((s, m) => s + m.utilizationPct, 0) / machines.length) : 0;
  const qcCount = jobCards.filter((j) => j.stage === "qc").length;

  const tabs: TabItem[] = [
    { key: "queue", label: "Job Queue", count: jobCards.length, icon: Factory },
    { key: "machines", label: "Machines", count: machines.length, icon: Cpu },
    { key: "qc", label: "Quality Check", count: qcCount, icon: ListChecks },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Production" }]}
        title="Production"
        subtitle="Track jobs on the floor, machine utilization and quality checks."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Jobs in Queue" value={jobCards.length} icon={Factory} detail="across all stages" to="/admin/production" />
        <MetricCard label="Running" value={running} icon={Play} detail={`${machines.length} machines total`} to="/admin/production" />
        <MetricCard
          label="Delayed"
          value={delayed}
          icon={TriangleAlert}
          tone={delayed > 0 ? "danger" : "default"}
          detail={delayed > 0 ? <span className="font-bold text-red-600 dark:text-red-400">need attention</span> : "all on schedule"}
          to="/admin/production"
        />
        <MetricCard label="Avg Utilization" value={`${avgUtil}%`} icon={Gauge} detail="fleet-wide" to="/admin/production" />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "queue" && <JobQueue onSelect={setSelected} />}
      {tab === "machines" && <MachinesGrid />}
      {tab === "qc" && <QualityCheck />}

      <JobDrawer job={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
