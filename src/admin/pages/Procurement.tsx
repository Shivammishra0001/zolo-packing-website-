import { ShoppingBag } from "lucide-react";
import { EmptyState, Panel } from "../components/Panel";
import { PageHeader } from "../components/ui";

// Procurement has no backend yet. The previous page crashed on render
// (it indexed into an empty mock supplier array) and its "Purchase order
// raised" / "Goods received" actions were toasts that persisted nothing.
export default function Procurement() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Procurement" }]}
        title="Procurement"
        subtitle="Purchase orders and goods receipt."
      />
      <Panel>
        <EmptyState
          icon={ShoppingBag}
          title="Procurement is not connected yet"
          message="This module has no backend yet. Approved suppliers are managed under Sellers; incoming stock is recorded through the Inventory ledger."
        />
      </Panel>
    </div>
  );
}
