import { Link } from "react-router-dom";
import { FileBarChart } from "lucide-react";
import { PageHeader } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";

// ============================================================
// Buyer reports.
//
// The previous page assembled GST/spend "reports" from the admin mock stores —
// permanently-empty arrays — and offered download buttons that only showed a
// toast. Until a real reporting endpoint exists, this page says so honestly
// instead of rendering zero-filled tables and fake exports.
//
// Real, working views of the same data live in Orders (live order history with
// invoices) and Payment History.
// ============================================================

export default function Reports() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Reports"
        subtitle="Downloadable GST and spend summaries for your account."
      />
      <Panel>
        <EmptyState
          icon={FileBarChart}
          title="Reports are not available yet"
          message="Exportable summaries are coming soon. Until then, your live order history and invoices are in Orders, and every payment is listed in Payment History."
          action={
            <div className="flex gap-2">
              <Link to="/account/orders" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-bold text-white hover:bg-primary-600">
                View orders
              </Link>
              <Link to="/account/payments" className="rounded-lg border erp-border px-4 py-2 text-sm font-bold erp-text hover:erp-surface-2">
                Payment history
              </Link>
            </div>
          }
        />
      </Panel>
    </div>
  );
}
