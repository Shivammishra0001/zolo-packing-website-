// Address routes: /api/v1/addresses/* (authenticated; owner-scoped).
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import { addressSchema, addressUpdateSchema } from "../lib/validation.mjs";
import * as addresses from "../services/addresses.mjs";

export const addressRouter = Router();

addressRouter.get("/", wrap(async (req, res) => ok(res, await addresses.listAddresses(req.user.id))));

addressRouter.post("/", wrap(async (req, res) => {
  const input = addressSchema.parse(req.body);
  ok(res, await addresses.createAddress(req.user.id, input), 201);
}));

addressRouter.patch("/:id", wrap(async (req, res) => {
  const input = addressUpdateSchema.parse(req.body);
  ok(res, await addresses.updateAddress(req.user.id, req.params.id, input));
}));

addressRouter.delete("/:id", wrap(async (req, res) => ok(res, await addresses.deleteAddress(req.user.id, req.params.id))));
