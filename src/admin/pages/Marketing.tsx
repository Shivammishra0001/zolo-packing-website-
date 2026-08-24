import { useMemo, useState } from "react";
import { Gift, Mail, MessageCircle, Percent, Plus, Send, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader, Select, Tabs } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { formatDate } from "../format";
import { useAdminMarketing } from "../dashboard-api";
import { COUPON_STATUS } from "../statuses-ext";
import type { Coupon } from "../types";

function CouponsTab() {
  // Real coupons from PostgreSQL, including live redemption counts.
  const live = useAdminMarketing();
  const coupons: Coupon[] = (live.data?.coupons ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    description: c.discountType === "percent" ? `${c.discountValue}% off` : `Flat discount`,
    discount: c.discountType === "percent" ? `${c.discountValue}%` : `₹${(c.discountValue / 100).toLocaleString("en-IN")}`,
    status: c.state as Coupon["status"],
    used: c.redemptions,
    limit: c.usageLimit ?? 0,
    expiresAt: c.validUntil ?? "",
  }));
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const columns: Column<Coupon>[] = [
    { key: "code", header: "Code", render: (c) => <span className="font-mono font-bold erp-text">{c.code}</span> },
    { key: "description", header: "Description", render: (c) => <span className="erp-text-muted">{c.description}</span>, hideBelow: "md" },
    { key: "discount", header: "Discount", render: (c) => <Badge tone="primary">{c.discount}</Badge> },
    { key: "status", header: "Status", render: (c) => <Badge tone={COUPON_STATUS[c.status].tone}>{COUPON_STATUS[c.status].label}</Badge> },
    {
      key: "usage", header: "Usage", render: (c) => (
        <div className="min-w-[120px]">
          <div className="flex justify-between text-xs erp-text-muted"><span>{c.used}</span><span>{c.limit}</span></div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full erp-surface-2">
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min((c.used / c.limit) * 100, 100)}%` }} />
          </div>
        </div>
      ),
    },
    { key: "expires", header: "Expires", render: (c) => <span className="erp-text-muted">{formatDate(c.expiresAt)}</span>, hideBelow: "sm" },
  ];
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>New Coupon</Button>
      </div>
      <div className="erp-card card-shadow p-4 sm:p-5">
        <DataTable caption="Coupons" columns={columns} rows={coupons} rowKey={(c) => c.id} />
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New Coupon"
        description="Create a discount code for the storefront."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setOpen(false); toast.success("Coupon created", "Discount code is now live."); }}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Code</span>
            <input placeholder="e.g. FESTIVE20" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Discount</span>
            <input placeholder="e.g. 20% or ₹5,000" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
        </div>
      </Dialog>
    </>
  );
}

interface PastCampaign { id: string; name: string; sent: number; openPct: number; clickPct: number; at: string }

function CampaignTab({ channel }: { channel: "email" | "whatsapp" }) {
  const toast = useToast();
  const [audience, setAudience] = useState("all");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const past: PastCampaign[] = channel === "email"
    ? [
        { id: "C1", name: "July new arrivals", sent: 3200, openPct: 42, clickPct: 8, at: "24 Jul" },
        { id: "C2", name: "Rigid box promo", sent: 1800, openPct: 51, clickPct: 12, at: "12 Jul" },
      ]
    : [
        { id: "W1", name: "Order-ready broadcast", sent: 940, openPct: 88, clickPct: 22, at: "22 Jul" },
        { id: "W2", name: "Monsoon offer blast", sent: 1200, openPct: 76, clickPct: 15, at: "08 Jul" },
      ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="erp-card card-shadow p-5 lg:col-span-2">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold erp-text">
          {channel === "email" ? <Mail className="h-4 w-4" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />}
          {channel === "email" ? "Email campaign" : "WhatsApp campaign"} builder
        </h3>
        <div className="space-y-3">
          {channel === "email" && (
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
            </label>
          )}
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} placeholder="Write your message…" className="mt-1 w-full rounded-lg border erp-border erp-surface p-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Audience</span>
            <Select value={audience} onChange={setAudience} className="mt-1 w-full">
              <option value="all">All customers</option>
              <option value="d2c">D2C brands</option>
              <option value="enterprise">Enterprise</option>
              <option value="dormant">Dormant (90+ days)</option>
            </Select>
          </label>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" icon={Send} onClick={() => toast.info("Test sent", "A test message was sent to your inbox.")}>Send Test</Button>
            <Button variant="primary" icon={Send} onClick={() => toast.success("Campaign scheduled", "Your campaign is queued for delivery.")}>Schedule</Button>
          </div>
        </div>
      </div>

      <div className="erp-card card-shadow p-5">
        <h3 className="mb-3 text-sm font-bold erp-text">Past campaigns</h3>
        <ul className="space-y-3">
          {past.map((c) => (
            <li key={c.id} className="border-b erp-border-soft pb-3 last:border-0 last:pb-0">
              <div className="text-sm font-semibold erp-text">{c.name}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs erp-text-muted">
                <span>{c.sent.toLocaleString("en-IN")} sent</span>
                <span>· {c.openPct}% open</span>
                <span>· {c.clickPct}% click</span>
                <span className="erp-text-faint">· {c.at}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface Referrer { id: string; name: string; referrals: number; earned: number }
const LEADERBOARD: Referrer[] = [
  { id: "1", name: "Kama Wellness Pvt Ltd", referrals: 9, earned: 9000 },
  { id: "2", name: "Bloom Naturals", referrals: 6, earned: 6000 },
  { id: "3", name: "Crunch Theory Snacks", referrals: 4, earned: 4000 },
  { id: "4", name: "Verma Handicrafts", referrals: 2, earned: 2000 },
];

function ReferralsTab() {
  const totals = useMemo(() => ({
    referrers: LEADERBOARD.length,
    referrals: LEADERBOARD.reduce((s, r) => s + r.referrals, 0),
    payout: LEADERBOARD.reduce((s, r) => s + r.earned, 0),
  }), []);
  const columns: Column<Referrer>[] = [
    { key: "rank", header: "#", render: (r) => <span className="font-bold erp-text-faint">{LEADERBOARD.indexOf(r) + 1}</span> },
    { key: "name", header: "Customer", render: (r) => <span className="font-semibold erp-text">{r.name}</span> },
    { key: "referrals", header: "Referrals", render: (r) => <Badge tone="primary">{r.referrals}</Badge> },
    { key: "earned", header: "Rewards earned", render: (r) => <span className="tabular-nums erp-text">₹{r.earned.toLocaleString("en-IN")}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="erp-card card-shadow p-5">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary-500" aria-hidden />
          <h3 className="text-sm font-bold erp-text">Refer & Earn</h3>
        </div>
        <p className="mt-1 text-sm erp-text-muted">Customers earn ₹1,000 credit for every referred business that places its first order.</p>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div><div className="font-display text-2xl font-extrabold erp-text">{totals.referrers}</div><div className="text-xs erp-text-muted">Active referrers</div></div>
          <div><div className="font-display text-2xl font-extrabold erp-text">{totals.referrals}</div><div className="text-xs erp-text-muted">Total referrals</div></div>
          <div><div className="font-display text-2xl font-extrabold erp-text">₹{totals.payout.toLocaleString("en-IN")}</div><div className="text-xs erp-text-muted">Rewards paid</div></div>
        </div>
      </div>
      <div className="erp-card card-shadow p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-bold erp-text">Leaderboard</h3>
        <DataTable caption="Referral leaderboard" columns={columns} rows={LEADERBOARD} rowKey={(r) => r.id} />
      </div>
    </div>
  );
}

const TABS = [
  { key: "coupons", label: "Coupons", icon: Percent },
  { key: "offers", label: "Offers" },
  { key: "email", label: "Email Campaign", icon: Mail },
  { key: "whatsapp", label: "WhatsApp Campaign", icon: MessageCircle },
  { key: "referrals", label: "Referrals", icon: Users },
];

export default function Marketing() {
  const toast = useToast();
  const [tab, setTab] = useState("coupons");
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Marketing" }]}
        title="Marketing"
        subtitle="Coupons, offers, campaigns and referral programs."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === "coupons" && <CouponsTab />}
      {tab === "offers" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Buy 2 get 1 free", sub: "On folding cartons · auto-applied", tone: "success" as const },
            { title: "Free shipping over ₹25,000", sub: "Sitewide threshold offer", tone: "info" as const },
            { title: "First-order 10% off", sub: "New customers only", tone: "primary" as const },
          ].map((o) => (
            <div key={o.title} className="erp-card card-shadow p-4">
              <Badge tone={o.tone}>Active</Badge>
              <h3 className="mt-2 text-sm font-bold erp-text">{o.title}</h3>
              <p className="mt-0.5 text-xs erp-text-muted">{o.sub}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => toast.info("Editing offer", o.title)}>Edit offer</Button>
            </div>
          ))}
        </div>
      )}
      {tab === "email" && <CampaignTab channel="email" />}
      {tab === "whatsapp" && <CampaignTab channel="whatsapp" />}
      {tab === "referrals" && <ReferralsTab />}
    </div>
  );
}
