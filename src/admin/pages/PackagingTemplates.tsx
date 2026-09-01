import { Ruler } from "lucide-react";
import { EmptyState, Panel } from "../components/Panel";
import { PageHeader } from "../components/ui";

// Packaging templates (dielines) have no backend yet. The previous page
// rendered an empty mock template list. Until the module is built, it says
// so honestly.
export default function PackagingTemplates() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Templates" }]}
        title="Packaging Templates"
        subtitle="Dielines and size presets for common box styles."
      />
      <Panel>
        <EmptyState
          icon={Ruler}
          title="Templates are not connected yet"
          message="This module has no backend yet. Product dimensions live on each catalog product; customer size requirements arrive on their RFQs."
        />
      </Panel>
    </div>
  );
}
