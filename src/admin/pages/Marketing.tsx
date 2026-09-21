import { CalendarClock, CheckCircle2, LayoutDashboard, Megaphone, Plus, Tag, TimerOff } from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Button, PageHeader, Tabs } from "../components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "../components/Panel";
import { useAdminQuery } from "../dashboard-api";
import type { MarketingOverview } from "@/lib/api/marketing";
import { formatStoreDate } from "@/lib/store-time";
import CouponsPage, { discountLabel } from "./marketing/CouponsPage";
import CampaignsPage, { CONTENT_TYPE_LABEL } from "./marketing/CampaignsPage";
import { PLACEMENT_LABEL } from "./marketing/CampaignPreview";
import { StatusBadge, SummaryCards } from "./marketing/shared";

// Marketing = two independent, database-backed systems:
//   Coupons    discount rules, validated and priced by the server at checkout
//   Campaigns  structured promotional content the storefront fetches and renders
// Everything here is live data from /admin/marketing, /admin/coupons and
// /admin/campaigns — there is no sample data and nothing is hard-coded.

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "coupons", label: "Coupons", icon: Tag },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
];

function Overview() {
  const q = useAdminQuery<MarketingOverview>("/admin/marketing", 60_000);
  if (q.status === "loading") return <div className="erp-card card-shadow p-5"><ListSkeleton rows={6} /></div>;
  if (q.status === "error" || !q.data) return <div className="erp-card card-shadow"><ErrorState message={q.error ?? "Could not load marketing data."} onRetry={q.refetch} /></div>;
  const { coupons, campaigns } = q.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/marketing/coupons?new=1"><Button variant="primary" icon={Plus}>Create Coupon</Button></Link>
        <Link to="/admin/marketing/campaigns?new=1"><Button variant="primary" icon={Plus}>Create Campaign</Button></Link>
      </div>

      <section className="space-y-3" aria-labelledby="mk-coupons">
        <h2 id="mk-coupons" className="text-xs font-bold uppercase tracking-wide erp-text-faint">Coupons</h2>
        <SummaryCards
          items={[
            { label: "Total coupons", value: coupons.counts.total, icon: Tag },
            { label: "Active", value: coupons.counts.active, icon: CheckCircle2, tone: "success" },
            { label: "Scheduled", value: coupons.counts.scheduled, icon: CalendarClock, tone: "info" },
            { label: "Expired", value: coupons.counts.expired + coupons.counts.usage_limit_reached, icon: TimerOff, tone: "danger" },
          ]}
        />
      </section>

      <section className="space-y-3" aria-labelledby="mk-campaigns">
        <h2 id="mk-campaigns" className="text-xs font-bold uppercase tracking-wide erp-text-faint">Campaigns</h2>
        <SummaryCards
          items={[
            { label: "Total campaigns", value: campaigns.counts.total, icon: Megaphone },
            { label: "Active", value: campaigns.counts.active, icon: CheckCircle2, tone: "success" },
            { label: "Scheduled", value: campaigns.counts.scheduled, icon: CalendarClock, tone: "info" },
            { label: "Expired", value: campaigns.counts.expired, icon: TimerOff, tone: "danger" },
          ]}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Recent coupons" action={<Link to="/admin/marketing/coupons" className="text-xs font-bold text-primary-600 hover:underline dark:text-primary-400">View all</Link>}>
          {coupons.recent.length === 0 ? (
            <EmptyState icon={Tag} title="No coupons yet" message="Create a coupon and it will be redeemable at checkout as soon as its schedule starts." />
          ) : (
            <ul className="divide-y erp-border">
              {coupons.recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-bold erp-text">{c.code}</div>
                    <div className="truncate text-xs erp-text-muted">{discountLabel(c)} · {c.usageCount}/{c.usageLimit ?? "∞"} used · ends {formatStoreDate(c.endAt)}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent campaigns" action={<Link to="/admin/marketing/campaigns" className="text-xs font-bold text-primary-600 hover:underline dark:text-primary-400">View all</Link>}>
          {campaigns.recent.length === 0 ? (
            <EmptyState icon={Megaphone} title="No campaigns yet" message="Create a campaign to publish a banner, card, popup or announcement to the storefront." />
          ) : (
            <ul className="divide-y erp-border">
              {campaigns.recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold erp-text">{c.name}</div>
                    <div className="truncate text-xs erp-text-muted">
                      {CONTENT_TYPE_LABEL[c.contentType]} · {c.placements.map((p) => PLACEMENT_LABEL[p]).join(", ") || "No placement"} · priority {c.priority}
                    </div>
                  </div>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default function Marketing() {
  const { tab = "overview" } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  if (!TABS.some((t) => t.key === tab)) return <Navigate to="/admin/marketing" replace />;

  return (
    <div className="shell-admin">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Marketing", to: tab === "overview" ? undefined : "/admin/marketing" }, ...(tab === "overview" ? [] : [{ label: tab === "coupons" ? "Coupons" : "Campaigns" }])]}
        title="Marketing"
        subtitle="Coupons and campaigns — created, scheduled and published from here, no code changes."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={(k) => navigate(k === "overview" ? "/admin/marketing" : `/admin/marketing/${k}`)} />
      </div>
      {tab === "overview" && <Overview />}
      {tab === "coupons" && <CouponsPage />}
      {tab === "campaigns" && <CampaignsPage />}
    </div>
  );
}
