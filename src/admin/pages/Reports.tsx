import { FileBarChart } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { EmptyState, Panel } from "../components/Panel";

// Report generation has no backend yet. The previous page listed five
// invented "recent reports" with fake timestamps and file sizes, and its
// Generate/Schedule/Download buttons only showed toasts. Until report
// exports exist, this page says so honestly and points at the live views.
export default function Reports() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Reports" }]}
        title="Reports"
        subtitle="Operational and financial report exports."
      />
      <Panel>
        <EmptyState
          icon={FileBarChart}
          title="Report exports are not connected yet"
          message="Downloadable reports have no backend yet. The live numbers are on the Dashboard (sales & analytics), Finance (payments & invoices), and Inventory (stock & ledger)."
          action={
            <div className="flex flex-wrap gap-2">
              <Link to="/admin" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-bold text-white hover:bg-primary-600">Dashboard</Link>
              <Link to="/admin/finance" className="rounded-lg border erp-border px-4 py-2 text-sm font-bold erp-text hover:erp-surface-2">Finance</Link>
              <Link to="/admin/inventory" className="rounded-lg border erp-border px-4 py-2 text-sm font-bold erp-text hover:erp-surface-2">Inventory</Link>
            </div>
          }
        />
      </Panel>
    </div>
  );
}
