import { useState } from "react";
import { Boxes, CalendarDays, Download, Factory, FileDown, FileText, Package, TrendingUp, Users, Wallet, type LucideIcon } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader, Select } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";

interface ReportDef {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  tone: "primary" | "info" | "success" | "warning" | "neutral";
}

const REPORTS: ReportDef[] = [
  { key: "sales", name: "Sales Report", description: "Revenue, order value and trends across any date range.", icon: TrendingUp, tone: "primary" },
  { key: "orders", name: "Orders Report", description: "Order volumes by status, type and customer segment.", icon: Package, tone: "info" },
  { key: "inventory", name: "Inventory Report", description: "Stock levels, movements and reorder recommendations.", icon: Boxes, tone: "warning" },
  { key: "production", name: "Production Report", description: "Job throughput, machine utilization and wastage.", icon: Factory, tone: "success" },
  { key: "finance", name: "Finance Report", description: "Invoicing, collections, GST liability and margins.", icon: Wallet, tone: "primary" },
  { key: "customers", name: "Customers Report", description: "Acquisition, retention and lifetime value by cohort.", icon: Users, tone: "info" },
];

interface RecentReport {
  id: string;
  name: string;
  type: string;
  generatedAt: string;
  size: string;
}

const RECENT: RecentReport[] = [
  { id: "R-1", name: "Sales · Jul 2026", type: "Sales", generatedAt: "28 Jul, 9:10 am", size: "412 KB" },
  { id: "R-2", name: "GST Filing · Q1", type: "Finance", generatedAt: "26 Jul, 6:02 pm", size: "1.2 MB" },
  { id: "R-3", name: "Inventory Snapshot", type: "Inventory", generatedAt: "25 Jul, 11:44 am", size: "88 KB" },
  { id: "R-4", name: "Production Wastage", type: "Production", generatedAt: "22 Jul, 4:20 pm", size: "203 KB" },
  { id: "R-5", name: "Top Customers", type: "Customers", generatedAt: "20 Jul, 8:15 am", size: "156 KB" },
];

export default function Reports() {
  const toast = useToast();
  const [schedule, setSchedule] = useState<ReportDef | null>(null);
  const [freq, setFreq] = useState("weekly");

  const columns: Column<RecentReport>[] = [
    { key: "name", header: "Report", render: (r) => <span className="font-semibold erp-text">{r.name}</span> },
    { key: "type", header: "Type", render: (r) => <Badge tone="neutral">{r.type}</Badge> },
    { key: "generatedAt", header: "Generated", render: (r) => <span className="erp-text-muted">{r.generatedAt}</span>, hideBelow: "sm" },
    { key: "size", header: "Size", render: (r) => <span className="tabular-nums erp-text-faint">{r.size}</span>, hideBelow: "md" },
    {
      key: "download", header: "", render: (r) => (
        <Button size="sm" variant="ghost" icon={Download} onClick={() => toast.info("Downloading", `${r.name} (${r.size})`)} aria-label={`Download ${r.name}`}>Download</Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Reports" }]}
        title="Reports"
        subtitle="Generate and schedule operational and financial reports."
      />

      <h2 className="mb-3 text-sm font-bold erp-text">Report catalog</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <div key={r.key} className="flex flex-col gap-3 erp-card card-shadow p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg erp-surface-2 text-primary-500">
                <r.icon className="h-5 w-5" aria-hidden />
              </div>
              <Badge tone={r.tone}>{r.name.replace(" Report", "")}</Badge>
            </div>
            <div>
              <h3 className="text-sm font-bold erp-text">{r.name}</h3>
              <p className="mt-0.5 text-xs erp-text-muted">{r.description}</p>
            </div>
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="primary" icon={FileDown} className="flex-1" onClick={() => toast.success("Generating report", `${r.name} is being prepared.`)}>Generate</Button>
              <Button size="sm" variant="secondary" icon={CalendarDays} onClick={() => setSchedule(r)}>Schedule</Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-bold erp-text">Recent reports</h2>
      <div className="erp-card card-shadow p-4 sm:p-5">
        <DataTable caption="Recently generated reports" columns={columns} rows={RECENT} rowKey={(r) => r.id} />
      </div>

      <Dialog
        open={!!schedule}
        onClose={() => setSchedule(null)}
        title={`Schedule · ${schedule?.name ?? ""}`}
        description="Deliver this report to your inbox automatically."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSchedule(null)}>Cancel</Button>
            <Button variant="primary" icon={FileText} onClick={() => { toast.success("Report scheduled", `${schedule?.name} will run ${freq}.`); setSchedule(null); }}>Schedule</Button>
          </>
        }
      >
        <label className="block">
          <span className="text-xs font-semibold erp-text-muted">Frequency</span>
          <Select value={freq} onChange={setFreq} className="mt-1 w-full">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </label>
      </Dialog>
    </div>
  );
}
