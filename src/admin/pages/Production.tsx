import { Factory } from "lucide-react";
import { EmptyState, Panel } from "../components/Panel";
import { PageHeader } from "../components/ui";

// Production planning has no backend yet. The previous page rendered empty
// mock job cards with "Job started" / "Stage completed" toasts that persisted
// nothing. Until the module is built, it says so honestly.
export default function Production() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Production" }]}
        title="Production"
        subtitle="Job cards, machine scheduling and QC."
      />
      <Panel>
        <EmptyState
          icon={Factory}
          title="Production planning is not connected yet"
          message="This module has no backend yet. Order fulfilment status is tracked on each order in Orders; stock changes are recorded in the Inventory ledger."
        />
      </Panel>
    </div>
  );
}
