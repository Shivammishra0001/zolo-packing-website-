// Product Catalog → Categories.
//
//   GET  /categories, /categories/tree      PUBLIC: active tree, in sortOrder
//                                          (?scope=admin → everything, admin only)
//   the rest                                admin only
//
// Subcategories are rows of the same table with a parentId, so the
// /subcategories/* routes are thin aliases that enforce "has a parent".
import { Router } from "express";
import { ok, wrap, badRequest, notFound } from "../lib/http.mjs";
import { authenticate, requireAdmin, isAdminRole } from "../middleware/auth.mjs";
import * as categories from "../services/categories.mjs";

const adminOnly = [authenticate, requireAdmin];
export const categoriesRouter = Router();

// Public read. The admin scope is only honoured for an authenticated admin;
// anybody else silently gets the public tree.
async function readTree(req, res) {
  let scope = "public";
  if (req.query.scope === "admin") {
    await new Promise((resolve) => authenticate(req, res, (err) => resolve(err)));
    if (req.user && isAdminRole(req.user.role)) scope = "admin";
  }
  res.setHeader("Cache-Control", "no-store");
  ok(res, await categories.tree({ scope, includeEmpty: req.query.includeEmpty !== "0" }));
}
categoriesRouter.get("/categories", wrap(readTree));
categoriesRouter.get("/categories/tree", wrap(readTree));

categoriesRouter.get("/subcategories", ...adminOnly, wrap(async (_req, res) => {
  const { categories: all } = await categories.tree({ scope: "admin" });
  ok(res, { subcategories: all.filter((c) => c.parentId) });
}));
categoriesRouter.get("/categories/:id/subcategories", ...adminOnly, wrap(async (req, res) => {
  ok(res, { subcategories: (await categories.get(req.params.id)).subcategories });
}));
categoriesRouter.get("/categories/:id", ...adminOnly, wrap(async (req, res) => ok(res, await categories.get(req.params.id))));

// Create: {name, slug?, parentId?} — the importer sends {name, parentId}.
categoriesRouter.post("/categories", ...adminOnly, wrap(async (req, res) => {
  const category = await categories.create(req.user.id, req.body ?? {});
  ok(res, { category }, 201);
}));
categoriesRouter.post("/subcategories", ...adminOnly, wrap(async (req, res) => {
  if (!req.body?.parentId) throw badRequest("Choose the parent category", "PARENT_REQUIRED");
  ok(res, { category: await categories.create(req.user.id, req.body) }, 201);
}));

// Reorder a whole sibling list (drag & drop) — MUST precede the /:id routes.
/** Multi-select toolbar: { ids, action: activate | deactivate | archive | delete }. */
categoriesRouter.post("/categories/bulk", ...adminOnly, wrap(async (req, res) => ok(res, await categories.bulk(req.user.id, req.body ?? {}))));
/** Reassign every product of :id to another category/subcategory (never deletes). */
categoriesRouter.post("/categories/:id/move-products", ...adminOnly, wrap(async (req, res) => ok(res, await categories.moveProducts(req.user.id, req.params.id, req.body ?? {}))));
categoriesRouter.post("/categories/reorder", ...adminOnly, wrap(async (req, res) => ok(res, await categories.reorder(req.user.id, req.body ?? {}))));
categoriesRouter.post("/subcategories/reorder", ...adminOnly, wrap(async (req, res) => {
  if (!req.body?.parentId) throw badRequest("Choose the parent category", "PARENT_REQUIRED");
  ok(res, await categories.reorder(req.user.id, req.body));
}));

for (const base of ["/categories", "/subcategories"]) {
  const sub = base === "/subcategories";
  const load = async (id) => {
    const row = await categories.get(id);
    if (sub && !row.parentId) throw notFound("Subcategory not found");
    if (!sub && row.parentId && base === "/categories") return row; // categories/:id also serves subs
    return row;
  };
  categoriesRouter.patch(`${base}/:id`, ...adminOnly, wrap(async (req, res) => {
    await load(req.params.id);
    ok(res, { category: await categories.update(req.user.id, req.params.id, req.body ?? {}) });
  }));
  categoriesRouter.patch(`${base}/:id/status`, ...adminOnly, wrap(async (req, res) => {
    await load(req.params.id);
    if (typeof req.body?.isActive !== "boolean") throw badRequest("Send isActive: true | false", "STATUS_REQUIRED");
    ok(res, { category: await categories.setStatus(req.user.id, req.params.id, req.body.isActive) });
  }));
  categoriesRouter.patch(`${base}/:id/order`, ...adminOnly, wrap(async (req, res) => {
    await load(req.params.id);
    ok(res, await categories.setPosition(req.user.id, req.params.id, req.body?.position ?? req.body?.sortOrder));
  }));
  // Archive (soft). Refused while products reference the row.
  categoriesRouter.delete(`${base}/:id`, ...adminOnly, wrap(async (req, res) => {
    await load(req.params.id);
    ok(res, await categories.archive(req.user.id, req.params.id));
  }));
}
