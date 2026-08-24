// Cart routes: /api/v1/cart/* (authenticated buyer).
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import { addToCartSchema, updateCartItemSchema } from "../lib/validation.mjs";
import * as cart from "../services/cart.mjs";

export const cartRouter = Router();

cartRouter.get("/", wrap(async (req, res) => ok(res, await cart.getCartView(req.user.id))));

cartRouter.post("/items", wrap(async (req, res) => {
  const input = addToCartSchema.parse(req.body);
  ok(res, await cart.addItem(req.user.id, input), 201);
}));

cartRouter.patch("/items/:id", wrap(async (req, res) => {
  const { quantity } = updateCartItemSchema.parse(req.body);
  ok(res, await cart.updateItem(req.user.id, req.params.id, quantity));
}));

cartRouter.delete("/items/:id", wrap(async (req, res) => ok(res, await cart.removeItem(req.user.id, req.params.id))));

cartRouter.delete("/", wrap(async (req, res) => ok(res, await cart.clearCart(req.user.id))));
