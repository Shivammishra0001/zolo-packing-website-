import { Palette } from "lucide-react";
import { EmptyState, Panel } from "../components/Panel";
import { PageHeader } from "../components/ui";

// Artwork approval has no backend yet. The previous page rendered an
// empty mock array with Approve/Reject buttons that only showed success
// toasts — actions that did nothing while claiming they had. Until the
// module is built, it says so honestly.
export default function Artwork() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Artwork" }]}
        title="Artwork"
        subtitle="Customer artwork review and press approval."
      />
      <Panel>
        <EmptyState
          icon={Palette}
          title="Artwork approvals are not connected yet"
          message="This module has no backend yet. Customer artwork currently arrives as requirement-sheet attachments on RFQs — open a request in Quotations to view its files."
        />
      </Panel>
    </div>
  );
}
