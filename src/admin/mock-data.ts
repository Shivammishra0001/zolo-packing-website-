// ============================================================
// Core data source (formerly mock data).
//
// All demo/seed business records have been permanently removed. These exports
// are now EMPTY and typed — the app reads real data through the stores/services
// (which hydrate from the API when available) and shows proper empty states
// when there is none. No fake products, orders, customers, or statistics.
//
// TODO(backend): the stores that import these seeds should instead hydrate from
// the API (GET /api/orders, /api/customers, …). Until then the app is empty.
// ============================================================

import type {
  AppNotification,
  Customer,
  Dispatch,
  InventoryItem,
  JobCard,
  KpiSnapshot,
  Order,
  Rfq,
} from "./types";

export const customers: Customer[] = [];

export const orders: Order[] = [];

export const rfqs: Rfq[] = [];

export const jobCards: JobCard[] = [];

export const dispatchesToday: Dispatch[] = [];

export const inventory: InventoryItem[] = [];

/** Items below reorder level / low days-of-cover. Empty until real stock exists. */
export function lowStockAlerts(items: InventoryItem[] = inventory) {
  return items
    .map((item) => {
      const daysLeft =
        item.dailyConsumption > 0 ? item.inStock / item.dailyConsumption : Infinity;
      const belowReorder = item.inStock < item.reorderLevel;
      return { item, daysLeft, belowReorder };
    })
    .filter((x) => x.belowReorder || x.daysLeft <= 3)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export const notifications: AppNotification[] = [];

/** Zeroed KPI snapshot — real figures come from the API/stores. */
export const kpis: KpiSnapshot = {
  revenueToday: 0,
  revenueYesterday: 0,
  ordersToday: { readyMade: 0, custom: 0 },
};

export const pendingRfqs = rfqs.filter((r) => r.status === "pending");
