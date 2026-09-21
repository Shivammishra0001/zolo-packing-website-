import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Coins, Copy, Minus, Plus, Ticket } from "lucide-react";
import { Badge, Button, Dialog } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { formatDate, formatDateTime, inrMinor } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { describeApiError } from "@/lib/api/client";
import { ecoCreditsApi, type EcoWallet as Wallet, type RewardCoupon, type RewardCouponStatus } from "@/lib/api/recycling";
import { cn } from "@/utils/cn";

// Eco Credit wallet: balance, redemption, my reward coupons and the full
// transaction history (Date · Description · Credits · Balance).
//
// Redeeming sends the server only HOW MANY rewards; the cost, the coupon value,
// its expiry and who owns it are decided server-side, in one transaction.

const COUPON_TONE: Record<RewardCouponStatus, "success" | "neutral" | "danger" | "warning" | "info"> = {
  active: "success", used: "neutral", expired: "danger", revoked: "danger", scheduled: "info", paused: "warning", draft: "neutral",
};

function CouponCard({ c }: { c: RewardCoupon }) {
  const toast = useToast();
  const live = c.status === "active";
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4", live ? "border-primary-300 bg-primary-50/60 dark:border-primary-500/30 dark:bg-primary-500/10" : "erp-border opacity-70")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-extrabold tracking-wide erp-text">{c.code}</span>
          <Badge tone={COUPON_TONE[c.status]}>{c.status === "active" ? "Ready to use" : c.status.charAt(0).toUpperCase() + c.status.slice(1)}</Badge>
        </div>
        <p className="mt-1 text-sm erp-text"><span className="font-bold">{inrMinor(c.valueMinor)} off</span>{c.minOrderMinor ? <span className="erp-text-muted"> · min. order {inrMinor(c.minOrderMinor)}</span> : null}</p>
        <p className="text-xs erp-text-muted">{c.expiresAt ? `${live ? "Expires" : "Expiry"} ${formatDate(c.expiresAt)}` : ""} · only valid on your account</p>
      </div>
      {live && (
        <div className="flex gap-2">
          <Button size="sm" icon={Copy} onClick={() => navigator.clipboard?.writeText(c.code).then(() => toast.success("Code copied", c.code)).catch(() => toast.error("Couldn't copy", "Select the code and copy it manually."))}>Copy</Button>
          <Link to="/cart"><Button size="sm" variant="primary">Use at checkout</Button></Link>
        </div>
      )}
    </div>
  );
}

export default function EcoWallet({ wallet, onChanged }: { wallet: Wallet; onChanged: () => void }) {
  const toast = useToast();
  const { reward } = wallet;
  const [units, setUnits] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<RewardCoupon | null>(null);

  const maxUnits = Math.max(reward.redeemableUnits, 0);
  const chosen = Math.min(Math.max(units, 1), Math.max(maxUnits, 1));
  const cost = (reward.creditsRequired ?? 0) * chosen;
  const value = (reward.couponValueMinor ?? 0) * chosen;
  const need = Math.max(reward.minCreditsToRedeem ?? 0, reward.creditsRequired ?? 0);

  const redeem = async () => {
    setBusy(true);
    try {
      const res = await ecoCreditsApi.redeem(chosen);
      setIssued(res.coupon); setConfirm(false); setUnits(1);
      toast.success("Coupon created", `${res.coupon.code} — ${inrMinor(res.coupon.valueMinor)} off. ${res.creditsSpent.toLocaleString("en-IN")} Eco Credits used.`);
      onChanged();
    } catch (e) {
      toast.error("Couldn't redeem", describeApiError(e).message);
      setConfirm(false); onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-6 text-white">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-50"><Coins className="h-4 w-4" aria-hidden /> Eco Credits Balance</div>
          <div className="mt-2 font-display text-4xl font-extrabold">{wallet.balance.toLocaleString("en-IN")} <span className="text-lg font-bold text-emerald-100">Eco Credits</span></div>
          <p className="mt-2 text-xs text-emerald-100">Earned from verified recycling. Every change is listed below.</p>
        </div>

        <Panel title="Redeem Eco Credits">
          {!reward.enabled || !reward.creditsRequired || !reward.couponValueMinor ? (
            <EmptyState icon={Ticket} title="Coupon rewards aren't open yet" message="Your Eco Credits stay safe in your wallet until redemption opens." />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border erp-border erp-surface-2 p-4 text-center">
                <span className="font-display text-xl font-extrabold erp-text">{cost.toLocaleString("en-IN")} Eco Credits</span>
                <ArrowRight className="h-5 w-5 erp-text-faint" aria-hidden />
                <span className="font-display text-xl font-extrabold text-primary-600 dark:text-primary-400">{inrMinor(value)} Coupon</span>
              </div>
              {(reward.maxUnitsPerRedemption ?? 1) > 1 && maxUnits > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <Button size="sm" icon={Minus} aria-label="Fewer rewards" disabled={chosen <= 1} onClick={() => setUnits(chosen - 1)} />
                  <span className="text-sm font-semibold erp-text">{chosen} reward{chosen === 1 ? "" : "s"} in one coupon</span>
                  <Button size="sm" icon={Plus} aria-label="More rewards" disabled={chosen >= maxUnits} onClick={() => setUnits(chosen + 1)} />
                </div>
              )}
              <div className="flex flex-col items-center gap-2">
                <Button variant="primary" icon={Ticket} disabled={maxUnits < 1} onClick={() => setConfirm(true)}>Redeem {cost.toLocaleString("en-IN")} Credits</Button>
                {maxUnits < 1 && <p className="text-xs erp-text-muted">You need {need.toLocaleString("en-IN")} Eco Credits to redeem — {Math.max(need - wallet.balance, 0).toLocaleString("en-IN")} more to go.</p>}
                <p className="text-center text-[11px] erp-text-faint">
                  {reward.couponValidityDays ? `Valid ${reward.couponValidityDays} days` : ""}{reward.couponMinOrderMinor ? ` · min. order ${inrMinor(reward.couponMinOrderMinor)}` : ""} · the coupon works only on your account
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {issued && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10" role="status">
          <p className="mb-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">Your new coupon is ready:</p>
          <CouponCard c={issued} />
        </div>
      )}

      <Panel title={`My Eco Reward coupons (${wallet.coupons.length})`}>
        {wallet.coupons.length === 0
          ? <EmptyState icon={Ticket} title="No coupons yet" message="Coupons you redeem with Eco Credits appear here." />
          : <div className="space-y-3">{wallet.coupons.map((c) => <CouponCard key={c.id} c={c} />)}</div>}
      </Panel>

      <Panel title="Transaction history" bodyClassName="p-0">
        {wallet.transactions.length === 0 ? (
          <div className="p-4"><EmptyState icon={Coins} title="No transactions yet" message="Credits appear here when a recycling request is approved." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Eco Credit transactions</caption>
              <thead><tr className="border-b erp-border text-left text-[11px] font-bold uppercase tracking-wide erp-text-faint">
                <th className="px-4 py-3">Date</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Credits</th><th className="px-4 py-3 text-right">Balance</th>
              </tr></thead>
              <tbody className="divide-y erp-border">
                {wallet.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-4 py-3 erp-text-muted">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-3 erp-text">{t.description ?? "—"}</td>
                    <td className={cn("whitespace-nowrap px-4 py-3 text-right font-bold", t.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>{t.amount > 0 ? "+" : "−"}{Math.abs(t.amount).toLocaleString("en-IN")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right erp-text-muted">{t.balanceAfter.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog
        open={confirm} onClose={() => setConfirm(false)} title={`Redeem ${cost.toLocaleString("en-IN")} Eco Credits?`}
        description={`You get a ${inrMinor(value)} coupon for your account. Your balance goes from ${wallet.balance.toLocaleString("en-IN")} to ${(wallet.balance - cost).toLocaleString("en-IN")} Eco Credits.`}
        footer={<><Button onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button><Button variant="primary" icon={Ticket} loading={busy} onClick={redeem}>Redeem {cost.toLocaleString("en-IN")} Credits</Button></>}
      />
    </div>
  );
}
