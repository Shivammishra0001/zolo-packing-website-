// Checkout + order routes (authenticated buyer): /api/v1/*
//   POST /checkout/quote   — server-priced preview (cart + optional coupon)
//   POST /checkout/place   — place an order from the cart (COD), idempotent
//   GET  /orders           — my orders
//   GET  /orders/:id       — one of my orders
//   POST /orders/:id/cancel
//   GET  /orders/:id/invoice
import { Router } from "express";
import { ok, wrap, notFound } from "../lib/http.mjs";
import { quoteSchema, placeOrderSchema, cancelOrderSchema } from "../lib/validation.mjs";
import * as orders from "../services/orders.mjs";
import * as dashboards from "../services/dashboards.mjs";
import { isAdminRole } from "../middleware/auth.mjs";

export const orderRouter = Router();

orderRouter.post("/checkout/quote", wrap(async (req, res) => {
  const input = quoteSchema.parse(req.body ?? {});
  ok(res, await orders.quote(req.user.id, input));
}));

orderRouter.post("/checkout/place", wrap(async (req, res) => {
  const input = placeOrderSchema.parse(req.body);
  ok(res, await orders.placeOrder(req.user, input), 201);
}));

/**
 * The signed-in customer's dashboard. Scoped to req.user.id — which comes from
 * the verified token, never from a client-supplied id — so a customer can only
 * ever see their own orders, spend and notification count.
 */
orderRouter.get("/me/dashboard", wrap(async (req, res) => {
  ok(res, await dashboards.customerDashboard(req.user.id, {
    recentLimit: Number(req.query.recentLimit) || 5,
  }));
}));

// Buyer payment history. Scoped to the session user — the id is never read
// from the request.
orderRouter.get("/me/payments", wrap(async (req, res) => {
  ok(res, await dashboards.customerPayments(req.user.id, {
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  }));
}));

// All of this buyer's shipments (the Tracking page).
orderRouter.get("/me/shipments", wrap(async (req, res) => {
  ok(res, await dashboards.customerShipments(req.user.id, { limit: Number(req.query.limit) || 50 }));
}));

// Tracking for one order. 404 when the order isn't theirs, so ownership never
// leaks through a status-code difference.
orderRouter.get("/me/orders/:id/tracking", wrap(async (req, res) => {
  const tracking = await dashboards.customerOrderTracking(req.user.id, req.params.id);
  if (!tracking) throw notFound("Order not found");
  ok(res, tracking);
}));

orderRouter.get("/orders", wrap(async (req, res) => ok(res, await orders.listMyOrders(req.user.id))));

orderRouter.get("/orders/:id", wrap(async (req, res) => ok(res, await orders.getMyOrder(req.user.id, req.params.id))));

orderRouter.post("/orders/:id/cancel", wrap(async (req, res) => {
  const { reason } = cancelOrderSchema.parse(req.body ?? {});
  ok(res, await orders.cancelMyOrder(req.user.id, req.params.id, reason));
}));

orderRouter.get("/orders/:id/invoice", wrap(async (req, res) => {
  ok(res, await orders.getInvoice(req.params.id, { userId: req.user.id, isAdmin: isAdminRole(req.user.role) }));
}));
