import { Gift, Mail, MessageCircle, Percent, Users } from "lucide-react";
import { useState } from "react";
import { Badge, PageHeader, Tabs } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/Panel";
import { formatDate } from "../format";
import { useAdminMarketing } from "../dashboard-api";
import { COUPON_STATUS } from "../statuses-ext";
import type { Coupon } from "../types";

// Marketing.
//
// The coupons tab is REAL (PostgreSQL via /admin/marketing, live redemption
// counts). Everything that used to surround it was fabricated — an invented
// referral leaderboard with fake company names and payouts, made-up campaign
// open/click rates, offer cards with no backing, and a "New Coupon" dialog
// that only toasted success. Those now state honestly that the feature is not
// built yet.

function CouponsTab() {
  const live = useAdminMarketing();
  const coupons: Coupon[] = (live.data?.coupons ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.discountType === "percent" ? `${c.discountValue / 100}% off` : `Flat discount`,
    discount: c.discountType === "percent" ? `${c.discountValue / 100}%` : `₹${(c.discountValue / 100).toLocaleString("en-IN")}`,
    status: c.state as Coupon["status"],
    used: c.redemptions,
    limit: c.usageLimit ?? 0,
    expiresAt: c.validUntil ?? "",
  }));

  const columns: Column<Coupon>[] = [
    { key: "code", header: "Code", render: (c) => <span className="font-mono font-bold erp-text">{c.code}</span> },
    { key: "description", header: "Description", render: (c) => <span className="erp-text-muted">{c.description}</span>, hideBelow: "md" },
    { key: "discount", header: "Discount", render: (c) => <Badge tone="primary">{c.discount}</Badge> },
    { key: "status", header: "Status", render: (c) => <Badge tone={COUPON_STATUS[c.status].tone}>{COUPON_STATUS[c.status].label}</Badge> },
    {
      key: "usage", header: "Usage", render: (c) => (
        <div className="min-w-[120px]">
          <div className="flex justify-between text-xs erp-text-muted"><span>{c.used}</span><span>{c.limit || "∞"}</span></div>
          {c.limit > 0 && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full erp-surface-2">
              <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min((c.used / c.limit) * 100, 100)}%` }} />
            </div>
          )}
        </div>
      ),
    },
    { key: "expires", header: "Expires", render: (c) => <span className="erp-text-muted">{c.expiresAt ? formatDate(c.expiresAt) : "—"}</span>, hideBelow: "sm" },
  ];

  return (
    <div className="erp-card card-shadow p-4 sm:p-5">
      {coupons.length === 0 && live.status === "success" ? (
        <EmptyState icon={Percent} title="No coupons yet" message="Coupons created for the storefront will appear here with live redemption counts." />
      ) : (
        <DataTable caption="Coupons" columns={columns} rows={coupons} rowKey={(c) => c.id} />
      )}
    </div>
  );
}

const TABS = [
  { key: "coupons", label: "Coupons", icon: Percent },
  { key: "campaigns", label: "Campaigns", icon: Mail },
  { key: "referrals", label: "Referrals", icon: Users },
];

export default function Marketing() {
  const [tab, setTab] = useState("coupons");
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Marketing" }]}
        title="Marketing"
        subtitle="Coupons, campaigns and referral programs."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === "coupons" && <CouponsTab />}
      {tab === "campaigns" && (
        <div className="erp-card card-shadow">
          <EmptyState
            icon={MessageCircle}
            title="Campaigns are not connected yet"
            message="Email and WhatsApp campaign delivery has no backend yet. The previous stats shown here were illustrative, not real sends."
          />
        </div>
      )}
      {tab === "referrals" && (
        <div className="erp-card card-shadow">
          <EmptyState
            icon={Gift}
            title="Referral program is not connected yet"
            message="No referral tracking exists yet. The leaderboard previously shown here was invented sample data, not real customers."
          />
        </div>
      )}
    </div>
  );
}
