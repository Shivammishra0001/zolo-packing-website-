import { useMemo } from "react";
import { useAuthSession } from "@/components/auth/AuthContext";

// ============================================================
// Buyer data layer.
//
// Everything here derives from the VERIFIED session (AuthContext) or real
// APIs. The previous version joined the admin mock stores (empty arrays with a
// hardcoded "CUST-003" fallback) — every hook built on them could only ever
// return nothing, while looking like a data layer. Real buyer data comes from
// the ownership-scoped endpoints (`/orders`, `/me/*`, `/rfqs`) used by the
// routed pages (OrdersReal, Tracking, Payments, MyQuotations).
// ============================================================

/** All fields the buyer UI needs about themselves — from the real session. */
export function useBuyerProfile() {
  const { user } = useAuthSession();
  return useMemo(
    () => ({
      firstName: user?.firstName ?? "there",
      lastName: user?.lastName ?? "",
      name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || (user?.email ?? "Customer"),
      email: user?.email ?? "",
      phone: user?.phone ?? "",
      company: "", // no organisation data for buyers yet — never invented
      gstin: "",
      city: "",
      state: "",
    }),
    [user],
  );
}

// ---------- Recycle / eco pickups ----------

export interface RecycleEntry {
  id: string;
  orderId: string;
  date: string;
  weightKg: number;
  orderAmount: number;
  status: "pickup" | "coupon" | "processing";
}

/**
 * Recycle pickups. The programme has no backend yet, so this is honestly
 * empty — the page shows its empty state instead of entries synthesised from
 * invented weights.
 */
export function useBuyerRecycle(): RecycleEntry[] {
  return useMemo(() => [], []);
}
