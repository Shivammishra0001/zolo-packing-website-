// Typed storefront commerce API — cart, addresses, checkout, orders, invoice.
// All money fields are integer minor units (paise), matching the backend.
import { request } from "./client";

// ---------- Types ----------
export interface CartLine {
  id: string;
  productId: string;
  variant: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  name: string;
  sku: string | null;
  image: string;
  available: number;
  moq: number;
  unavailable: boolean;
}
export interface CartView { cartId: string; items: CartLine[] }

export interface Address {
  id: string;
  kind: "billing" | "shipping";
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}
export type AddressInput = Omit<Address, "id">;

export interface Quote {
  items: Array<{ productId: string; productName: string; sku: string | null; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  grandTotalMinor: number;
  couponCode: string | null;
  couponError: string | null;
}

export interface OrderAddress { name: string; phone: string; line1: string; line2?: string | null; city: string; state: string; postalCode: string; country: string }
export interface OrderItem { id: string; productId: string | null; productName: string; sku: string | null; variant: string | null; specs: unknown; quantity: number; unitPriceMinor: number; discountMinor: number; taxMinor: number; lineTotalMinor: number }
export interface OrderPayment { paymentNumber: string; method: string; amountMinor: number; status: string; reference: string | null; paidAt: string | null }
export interface OrderShipmentEvent { status: string; location: string | null; note: string | null; at: string }
export interface OrderShipment { shipmentNumber: string; courier: string | null; trackingNumber: string | null; status: string; shippedAt: string | null; deliveredAt: string | null; expectedAt: string | null; events: OrderShipmentEvent[] }
export interface OrderStatusEntry { status: string; note: string | null; at: string }
export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  grandTotalMinor: number;
  paidMinor: number;
  couponCode: string | null;
  notes: string | null;
  cancelReason: string | null;
  placedAt: string;
  updatedAt: string;
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  items: OrderItem[];
  statusHistory: OrderStatusEntry[];
  payments: OrderPayment[];
  shipments: OrderShipment[];
  invoice: { invoiceNumber: string; status: string; issuedAt: string } | null;
  customer?: { id: string; name: string; email: string; phone: string | null };
}

export interface PlaceOrderInput {
  shippingAddressId: string;
  billingAddressId?: string | null;
  couponCode?: string | null;
  paymentMethod?: "cod";
  notes?: string | null;
  idempotencyKey?: string | null;
}

export interface InvoiceView { invoiceNumber: string; issuedAt: string; status: string; order: Order }

// ---------- Cart ----------
export const cartApi = {
  get: () => request<CartView>("/cart"),
  add: (input: { productId: string; variant?: string | null; quantity: number }) =>
    request<CartView>("/cart/items", { method: "POST", body: input }),
  update: (itemId: string, quantity: number) =>
    request<CartView>(`/cart/items/${itemId}`, { method: "PATCH", body: { quantity } }),
  remove: (itemId: string) => request<CartView>(`/cart/items/${itemId}`, { method: "DELETE" }),
  clear: () => request<CartView>("/cart", { method: "DELETE" }),
};

// ---------- Addresses ----------
export const addressApi = {
  list: () => request<Address[]>("/addresses"),
  create: (input: AddressInput) => request<Address>("/addresses", { method: "POST", body: input }),
  update: (id: string, input: Partial<AddressInput>) => request<Address>(`/addresses/${id}`, { method: "PATCH", body: input }),
  remove: (id: string) => request<{ deleted: boolean }>(`/addresses/${id}`, { method: "DELETE" }),
};

// ---------- Checkout + Orders ----------
export const orderApi = {
  quote: (couponCode?: string | null) => request<Quote>("/checkout/quote", { method: "POST", body: { couponCode: couponCode ?? null } }),
  place: (input: PlaceOrderInput) => request<Order>("/checkout/place", { method: "POST", body: input }),
  list: () => request<Order[]>("/orders"),
  get: (id: string) => request<Order>(`/orders/${id}`),
  cancel: (id: string, reason?: string) => request<Order>(`/orders/${id}/cancel`, { method: "POST", body: { reason } }),
  invoice: (id: string) => request<InvoiceView>(`/orders/${id}/invoice`),
};

// ---------------------------------------------------------------------------
// Buyer portal reads (GET /me/*)
//
// Every one of these is scoped server-side to the authenticated buyer; the
// frontend never sends a user id. See server/src/services/dashboards.mjs.
// ---------------------------------------------------------------------------

export interface BuyerDashboard {
  orders: { total: number; active: number; delivered: number; cancelled: number };
  totalSpendMinor: number;
  unreadNotifications: number;
  addresses: number;
  recentOrders: {
    id: string; orderNumber: string; status: string; paymentStatus: string;
    grandTotalMinor: number; itemCount: number; createdAt: string;
  }[];
  generatedAt: string;
}

export interface BuyerRefund {
  id: string; refundNumber: string; amountMinor: number; status: string; processedAt: string | null;
}

export interface BuyerPayment {
  id: string; paymentNumber: string; method: string | null; amountMinor: number;
  status: string; reference: string | null; paidAt: string | null; createdAt: string;
  orderId: string | null; orderNumber: string | null;
  refundedMinor: number; refunds: BuyerRefund[];
}

export interface BuyerPayments {
  summary: { paidMinor: number; pendingMinor: number; refundedMinor: number; outstandingMinor: number };
  payments: BuyerPayment[];
  total: number;
}

export interface BuyerShipmentEvent { status: string; location: string | null; note: string | null; at: string }

export interface BuyerShipment {
  id: string; shipmentNumber: string; courier: string | null; trackingNumber: string | null;
  status: string; shippedAt: string | null; deliveredAt: string | null; expectedAt: string | null;
  createdAt: string; orderId: string | null; orderNumber: string | null; orderStatus: string | null;
  events: BuyerShipmentEvent[];
}

export interface BuyerShipments { shipments: BuyerShipment[]; inTransit: number; total: number }

export interface OrderTracking {
  order: { id: string; orderNumber: string; status: string; placedAt: string; destination: string | null; recipient: string | null };
  statusHistory: { status: string; note: string | null; at: string }[];
  shipments: Omit<BuyerShipment, "orderId" | "orderNumber" | "orderStatus" | "createdAt">[];
}

export const buyerApi = {
  dashboard: () => request<BuyerDashboard>("/me/dashboard"),
  payments: (limit = 50) => request<BuyerPayments>(`/me/payments?limit=${limit}`),
  shipments: (limit = 50) => request<BuyerShipments>(`/me/shipments?limit=${limit}`),
  tracking: (orderId: string) => request<OrderTracking>(`/me/orders/${orderId}/tracking`),
};
