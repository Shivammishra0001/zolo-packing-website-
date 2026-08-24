// Notification routes — /api/v1/notifications/*. Behind authenticate.
import { Router } from "express";
import { ok, wrap } from "../lib/http.mjs";
import * as notifications from "../services/notifications.mjs";

export const notificationsRouter = Router();

notificationsRouter.get("/", wrap(async (req, res) => {
  ok(res, await notifications.list(req.user.id, { unreadOnly: req.query.unread === "true" }));
}));

notificationsRouter.post("/:id/read", wrap(async (req, res) => {
  ok(res, await notifications.markRead(req.user.id, req.params.id));
}));

notificationsRouter.post("/read-all", wrap(async (req, res) => {
  ok(res, await notifications.markAllRead(req.user.id));
}));
