import { CalendarClock, CheckCircle2, Coins, Gift, LayoutDashboard, Leaf, ListChecks, Recycle, RotateCcw, Scale, XCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader, Tabs } from "../../components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "../../components/Panel";
import { useAdminQuery } from "../../dashboard-api";
import { formatDate } from "../../format";
import { fmtQty, RECYCLING_STATUS_LABEL, type ReturnsRecyclingOverview } from "@/lib/api/recycling";
import { SummaryCards } from "../marketing/shared";
import ProductReturnsSection from "./ProductReturnsSection";
import RecyclingRequestsSection, { RecyclingStatusBadge } from "./RecyclingRequestsSection";
import RecyclingRulesSection from "./RecyclingRulesSection";
import EcoCreditsSection from "./EcoCreditsSection";
import EcoRewardSettingsSection from "./EcoRewardSettingsSection";

// Returns & Recycling = TWO separate workflows that share a menu, never a table:
//
//   Product Returns     refund / replacement of an order item. Never awards credits.
//   Recycling Requests  material + verified quantity × an admin rule = Eco Credits
//
//   material → verified quantity → active rule → credits/unit → Eco Credits
//   → wallet → redemption → customer-specific coupon → checkout

export type ReturnsSection = "overview" | "product" | "recycling" | "rules" | "eco-credits" | "eco-settings";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "product", label: "Product Returns", icon: RotateCcw },
  { key: "recycling", label: "Recycling Requests", icon: Recycle },
  { key: "rules", label: "Recycling Rules", icon: Scale },
  { key: "eco-credits", label: "Eco Credits", icon: Coins },
  { key: "eco-settings", label: "Eco Reward Settings", icon: Gift },
];
const pathFor = (key: string) => (key === "overview" ? "/admin/returns" : `/admin/returns/${key}`);

function Overview() {
  const q = useAdminQuery<ReturnsRecyclingOverview>("/admin/recycling/overview", 60_000);
  if (q.status === "loading") return <div className="erp-card card-shadow p-5"><ListSkeleton rows={6} /></div>;
  if (q.status === "error" || !q.data) return <div className="erp-card card-shadow"><ErrorState message={q.error ?? "Could not load the overview."} onRetry={q.refetch} /></div>;
  const { productReturns, recycling, rules, recentRecycling } = q.data;
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="ov-returns">
        <h2 id="ov-returns" className="text-xs font-bold uppercase tracking-wide erp-text-faint">Product returns</h2>
        <SummaryCards items={[
          { label: "Total returns", value: productReturns.total, icon: RotateCcw },
          { label: "Open", value: productReturns.open, icon: CalendarClock, tone: "info" },
          { label: "Refunded", value: productReturns.refunded, icon: CheckCircle2, tone: "success" },
          { label: "Rejected", value: productReturns.rejected, icon: XCircle, tone: "danger" },
        ]} />
      </section>
      <section className="space-y-3" aria-labelledby="ov-recycling">
        <h2 id="ov-recycling" className="text-xs font-bold uppercase tracking-wide erp-text-faint">Recycling</h2>
        <SummaryCards items={[
          { label: "Recycling requests", value: recycling.total, icon: Recycle },
          { label: "Awaiting action", value: recycling.open, icon: ListChecks, tone: "info" },
          { label: "Approved", value: recycling.approved, icon: CheckCircle2, tone: "success" },
          { label: "Active rules", value: rules.active, icon: Scale, tone: rules.active ? "default" : "danger" },
        ]} />
        {rules.active === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            No recycling rule is active, so customers cannot submit recycling requests yet. <Link to="/admin/returns/rules" className="font-bold underline">Add a recycling rule</Link> to tell the system how many Eco Credits each material earns.
          </p>
        )}
      </section>

      <Panel title="How credits are decided">
        <ol className="grid gap-3 text-sm erp-text sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["1", "Recycling rule", "You set credits per unit for each material."],
            ["2", "Verified quantity", "You enter what actually arrived."],
            ["3", "Automatic calculation", "quantity × credits per unit, rounded down."],
            ["4", "Approve", "Credits land in the customer's wallet and ledger."],
          ].map(([n, title, text]) => (
            <li key={n} className="flex gap-3 rounded-lg border erp-border p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white">{n}</span>
              <span><span className="block font-semibold">{title}</span><span className="block text-xs erp-text-muted">{text}</span></span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Recent recycling requests" action={<Link to="/admin/returns/recycling" className="text-xs font-bold text-primary-600 hover:underline dark:text-primary-400">View all</Link>}>
        {recentRecycling.length === 0 ? (
          <EmptyState icon={Leaf} title="No recycling requests yet" message="Requests appear here once customers submit recyclable packaging." />
        ) : (
          <ul className="divide-y erp-border">
            {recentRecycling.map((r) => (
              <li key={r.id}>
                <Link to={`/admin/returns/recycling/${r.requestNumber}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm font-bold erp-text">{r.requestNumber}</span>
                    <span className="block truncate text-xs erp-text-muted">{r.customer?.name ?? "—"} · {r.material} · est. {fmtQty(r.estimatedQuantity)} {r.unit} · {formatDate(r.createdAt)}</span>
                  </span>
                  <RecyclingStatusBadge status={r.status} label={RECYCLING_STATUS_LABEL[r.status]} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function ReturnsRecycling({ section }: { section: ReturnsSection }) {
  const navigate = useNavigate();
  const current = TABS.find((t) => t.key === section)!;
  return (
    <div className="shell-admin">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Returns & Recycling", to: section === "overview" ? undefined : "/admin/returns" }, ...(section === "overview" ? [] : [{ label: current.label }])]}
        title="Returns & Recycling"
        subtitle="Product returns and recycling are separate workflows. Recycling earns Eco Credits — only after you verify the quantity."
      />
      <div className="mb-5"><Tabs tabs={TABS} active={section} onChange={(k) => navigate(pathFor(k))} /></div>
      {section === "overview" && <Overview />}
      {section === "product" && <ProductReturnsSection />}
      {section === "recycling" && <RecyclingRequestsSection />}
      {section === "rules" && <RecyclingRulesSection />}
      {section === "eco-credits" && <EcoCreditsSection />}
      {section === "eco-settings" && <EcoRewardSettingsSection />}
    </div>
  );
}
