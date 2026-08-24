// Shared presentation helpers for order/payment statuses. Maps the backend
// enums to the admin UI's Badge tones and human labels, plus the canonical
// order lifecycle used to render a progress timeline.

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "DELIVERED":
      return "success";
    case "CONFIRMED":
    case "PROCESSING":
    case "PACKED":
    case "SHIPPED":
      return "info";
    case "OUT_FOR_DELIVERY":
    case "PENDING":
    case "RETURN_REQUESTED":
      return "warning";
    case "CANCELLED":
    case "RETURNED":
      return "danger";
    default:
      return "neutral";
  }
}

export function paymentTone(status: string): BadgeTone {
  if (status === "PAID" || status === "SUCCESS") return "success";
  if (status === "FAILED") return "danger";
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "info";
  return "warning";
}

export const prettyStatus = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// The happy-path lifecycle for a progress bar. CANCELLED/RETURN states are
// terminal detours rendered from history rather than this flow.
export const ORDER_FLOW = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

// The valid next statuses an admin may set, given the current one.
export const ORDER_NEXT: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED"],
  RETURNED: [],
  CANCELLED: [],
};
