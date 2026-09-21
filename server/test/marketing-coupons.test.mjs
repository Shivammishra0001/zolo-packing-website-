// Marketing → Coupons. Admin CRUD, the DERIVED status, and the server-side
// validation engine (dates, limits, per-customer, minimum order, product /
// category / sale-item restrictions, percentage cap). The frontend never
// supplies an amount — every figure asserted here is computed by the API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerBuyer, makeProduct, makeAddress } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const DAY = 86_400_000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const createdCodes = [];
const code = (t) => { const c = `TST-${t}-${rnd()}`; createdCodes.push(c); return c; };

let ADMIN;
before(async () => { await startServer(); ADMIN = await adminToken(); });
after(async () => {
  if (createdCodes.length) await prisma.coupon.deleteMany({ where: { code: { in: createdCodes } } });
  await stopServer();
});

const live = (body) => ({ discountType: "percent", discountValue: 1000, startAt: iso(-DAY), endAt: iso(DAY), ...body });
const create = (body) => api("/admin/coupons", { method: "POST", token: ADMIN, body });

async function buyerWithCart(lines) {
  const buyer = await registerBuyer();
  for (const [product, quantity] of lines) {
    const res = await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  return buyer;
}
const validate = (token, c) => api("/coupons/validate", { method: "POST", token, body: { code: c } });

test("the spec workflow: PACK10 saved for a future window is SCHEDULED, and not yet usable", async () => {
  const c = code("PACK10");
  const res = await create({
    code: c.toLowerCase(), name: "Pack 10", discountType: "percent", discountValue: 1000,
    minOrderMinor: 99_900, maxDiscountMinor: 30_000, usageLimit: 500, usageLimitPerCustomer: 1,
    startAt: iso(4 * DAY), endAt: iso(19 * DAY),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const coupon = res.body.data;
  assert.equal(coupon.code, c, "code is normalized to upper case");
  assert.equal(coupon.status, "scheduled");
  assert.equal(coupon.usageCount, 0);
  assert.equal(coupon.usageLimit, 500);

  const product = await makeProduct({ priceMinor: 200_000 });
  const { token } = await buyerWithCart([[product, 1]]);
  const v = await validate(token, c);
  assert.equal(v.body.data.valid, false);
  assert.match(v.body.data.message, /not yet valid/i);
});

test("codes are normalized + unique: welcome10 / WELCOME10 / Welcome10 are one coupon", async () => {
  const c = code("WELCOME");
  assert.equal((await create(live({ code: c }))).status, 201);
  const dup = await create(live({ code: ` ${c.toLowerCase()} ` }));
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "COUPON_CODE_EXISTS");

  const product = await makeProduct({ priceMinor: 100_000 });
  const { token } = await buyerWithCart([[product, 1]]);
  for (const typed of [c.toLowerCase(), c, ` ${c[0]}${c.slice(1).toLowerCase()} `]) {
    const v = await validate(token, typed);
    assert.equal(v.body.data.valid, true, typed);
    assert.equal(v.body.data.code, c);
  }
});

test("status is derived on the server: draft / scheduled / active / paused / expired / usage limit", async () => {
  const mk = async (t, body) => (await create(live({ code: code(t), ...body }))).body.data;
  assert.equal((await mk("ST-ACT", {})).status, "active");
  assert.equal((await mk("ST-SCH", { startAt: iso(DAY), endAt: iso(2 * DAY) })).status, "scheduled");
  assert.equal((await mk("ST-EXP", { startAt: iso(-2 * DAY), endAt: iso(-DAY) })).status, "expired");
  assert.equal((await mk("ST-DRF", { isDraft: true })).status, "draft");
  const paused = await mk("ST-PAU", { isActive: false });
  assert.equal(paused.status, "paused");

  // Activate / pause are plain PATCHes of isActive — the label follows.
  const on = await api(`/admin/coupons/${paused.id}`, { method: "PATCH", token: ADMIN, body: { isActive: true } });
  assert.equal(on.body.data.status, "active");

  const limited = await mk("ST-LIM", { usageLimit: 1 });
  await prisma.coupon.update({ where: { id: limited.id }, data: { usedCount: 1 } });
  assert.equal((await api(`/admin/coupons/${limited.id}`, { token: ADMIN })).body.data.status, "usage_limit_reached");

  // The list filter uses the same derived status, and counts add up.
  const list = await api("/admin/coupons?status=paused", { token: ADMIN });
  assert.ok(list.body.data.coupons.every((c) => c.status === "paused"));
  const all = (await api("/admin/coupons", { token: ADMIN })).body.data;
  const { total, ...byStatus } = all.counts;
  assert.equal(Object.values(byStatus).reduce((a, b) => a + b, 0), total);
});

test("validation: bad percent, end before start, missing targets, bad code are field-level 400s", async () => {
  const bad = async (body, path) => {
    const res = await create(live({ code: code("BAD"), ...body }));
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.issues.some((i) => i.path === path), `${path}: ${JSON.stringify(res.body.issues)}`);
  };
  await bad({ discountValue: 10_001 }, "discountValue");
  await bad({ discountValue: 0 }, "discountValue");
  await bad({ startAt: iso(DAY), endAt: iso(-DAY) }, "endAt");
  await bad({ appliesTo: "products", productIds: [] }, "productIds");
  await bad({ appliesTo: "categories" }, "categoryIds");
  await bad({ usageLimit: 2, usageLimitPerCustomer: 5 }, "usageLimitPerCustomer");
  await bad({ code: "NO SPACES!" }, "code");
  const ghost = await create(live({ code: code("GHOST"), appliesTo: "products", productIds: ["PRD-DOES-NOT-EXIST"] }));
  assert.equal(ghost.status, 400);
  assert.equal(ghost.body.code, "PRODUCT_NOT_FOUND");
});

test("percentage + cap + minimum order are computed server-side and honoured at checkout", async () => {
  const c = code("CAP");
  await create(live({ code: c, discountValue: 1000, minOrderMinor: 99_900, maxDiscountMinor: 30_000 }));
  const product = await makeProduct({ priceMinor: 50_000, stock: 100 });

  // ₹500 cart: below the ₹999 minimum.
  const small = await buyerWithCart([[product, 1]]);
  let v = await validate(small.token, c);
  assert.equal(v.body.data.valid, false);
  assert.match(v.body.data.message, /minimum/i);

  // ₹5,000 cart: 10% = ₹500, capped at ₹300.
  const big = await buyerWithCart([[product, 10]]);
  v = await validate(big.token, c);
  assert.equal(v.body.data.valid, true);
  assert.equal(v.body.data.discountMinor, 30_000);

  // A forged discount in the request body is ignored (schema is strict → 400) —
  // and the placed order carries the SERVER's number.
  const addressId = await makeAddress(big.token);
  const forged = await api("/checkout/place", { method: "POST", token: big.token, body: { shippingAddressId: addressId, couponCode: c, discountMinor: 499_900 } });
  assert.ok(forged.status === 400 || forged.body.data?.discountMinor === 30_000, "a client-sent discount is never trusted");
  if (forged.status === 400) {
    const placed = await api("/checkout/place", { method: "POST", token: big.token, body: { shippingAddressId: addressId, couponCode: c } });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.data.discountMinor, 30_000);
  }
  const row = await prisma.coupon.findUnique({ where: { code: c }, include: { redemptions: true } });
  assert.equal(row.usedCount, 1);
  assert.equal(row.redemptions.length, 1);
  assert.equal(row.redemptions[0].discountMinor, 30_000);
});

test("fixed amount never exceeds what it applies to", async () => {
  const c = code("FLAT");
  await create(live({ code: c, discountType: "flat", discountValue: 50_000, maxDiscountMinor: 100 })); // cap ignored for flat
  const product = await makeProduct({ priceMinor: 20_000 });
  const { token } = await buyerWithCart([[product, 1]]);
  const v = await validate(token, c);
  assert.equal(v.body.data.valid, true);
  assert.equal(v.body.data.discountMinor, 20_000, "₹500 off a ₹200 cart is ₹200");
  assert.equal((await prisma.coupon.findUnique({ where: { code: c } })).maxDiscountMinor, null);
});

test("specific products: only matching lines are discounted; no match → not applicable", async () => {
  const target = await makeProduct({ priceMinor: 100_000, name: "Target" });
  const other = await makeProduct({ priceMinor: 300_000, name: "Other" });
  const c = code("PROD");
  const res = await create(live({ code: c, appliesTo: "products", productIds: [target.id] }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.products.map((p) => p.id), [target.id]);

  const both = await buyerWithCart([[target, 1], [other, 1]]);
  const v = await validate(both.token, c);
  assert.equal(v.body.data.discountMinor, 10_000, "10% of the ₹1,000 target line only");
  const q = await api("/checkout/quote", { method: "POST", token: both.token, body: { couponCode: c } });
  assert.equal(q.body.data.discountMinor, 10_000);

  const none = await buyerWithCart([[other, 1]]);
  const miss = await validate(none.token, c);
  assert.equal(miss.body.data.valid, false);
  assert.match(miss.body.data.message, /does not apply/i);
});

test("specific categories (incl. subcategory products) and switching scope clears old targets", async () => {
  const parent = await prisma.category.create({ data: { name: `TST Cat ${rnd()}`, slug: `tst-cat-${rnd().toLowerCase()}` } });
  const child = await prisma.category.create({ data: { name: `TST Sub ${rnd()}`, slug: `tst-sub-${rnd().toLowerCase()}`, parentId: parent.id } });
  const inCat = await makeProduct({ priceMinor: 100_000 });
  const inSub = await makeProduct({ priceMinor: 100_000 });
  const outside = await makeProduct({ priceMinor: 100_000 });
  await prisma.product.update({ where: { id: inCat.id }, data: { categoryId: parent.id } });
  await prisma.product.update({ where: { id: inSub.id }, data: { categoryId: parent.id, subcategoryId: child.id } });

  const c = code("CAT");
  const made = await create(live({ code: c, appliesTo: "categories", categoryIds: [child.id] }));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const { token } = await buyerWithCart([[inCat, 1], [inSub, 1], [outside, 1]]);
  assert.equal((await validate(token, c)).body.data.discountMinor, 10_000, "subcategory coupon → only the subcategory product");

  await api(`/admin/coupons/${made.body.data.id}`, { method: "PATCH", token: ADMIN, body: { categoryIds: [parent.id] } });
  assert.equal((await validate(token, c)).body.data.discountMinor, 20_000, "parent category covers both");

  const all = await api(`/admin/coupons/${made.body.data.id}`, { method: "PATCH", token: ADMIN, body: { appliesTo: "all" } });
  assert.equal(all.body.data.categories.length, 0);
  assert.equal((await validate(token, c)).body.data.discountMinor, 30_000);

  await prisma.product.updateMany({ where: { id: { in: [inCat.id, inSub.id] } }, data: { categoryId: null, subcategoryId: null } });
  await prisma.category.deleteMany({ where: { id: { in: [child.id, parent.id] } } });
});

test("allowSaleItems=false skips products that are on sale", async () => {
  const sale = await makeProduct({ priceMinor: 100_000 });
  await prisma.product.update({ where: { id: sale.id }, data: { salePriceMinor: 80_000 } });
  const regular = await makeProduct({ priceMinor: 100_000 });
  const c = code("NOSALE");
  await create(live({ code: c, allowSaleItems: false }));
  const { token } = await buyerWithCart([[sale, 1], [regular, 1]]);
  assert.equal((await validate(token, c)).body.data.discountMinor, 10_000, "only the full-price line");
});

test("per-customer limit and total usage limit are enforced at checkout, not just in the UI", async () => {
  const product = await makeProduct({ priceMinor: 100_000, stock: 100 });
  const twice = code("TWICE");
  await create(live({ code: twice, usageLimitPerCustomer: 2, usageLimit: 3 }));

  const a = await buyerWithCart([[product, 1]]);
  const addrA = await makeAddress(a.token);
  const place = (buyer, addressId, c) => api("/checkout/place", { method: "POST", token: buyer.token, body: { shippingAddressId: addressId, couponCode: c } });
  assert.equal((await place(a, addrA, twice)).status, 201);
  await api("/cart/items", { method: "POST", token: a.token, body: { productId: product.id, quantity: 1 } });
  assert.equal((await place(a, addrA, twice)).status, 201, "second use is allowed (limit 2)");
  await api("/cart/items", { method: "POST", token: a.token, body: { productId: product.id, quantity: 1 } });
  const third = await place(a, addrA, twice);
  assert.equal(third.status, 400);
  assert.equal(third.body.code, "COUPON_ALREADY_USED");

  // Buyer B takes the 3rd (last) redemption; buyer C hits the total limit.
  const b = await buyerWithCart([[product, 1]]);
  assert.equal((await place(b, await makeAddress(b.token), twice)).status, 201);
  const c = await buyerWithCart([[product, 1]]);
  const over = await place(c, await makeAddress(c.token), twice);
  assert.equal(over.status, 400);
  assert.match(over.body.error, /usage limit/i);
  assert.equal((await api("/admin/coupons", { token: ADMIN })).body.data.coupons.find((x) => x.code === twice).status, "usage_limit_reached");

  // NULL per-customer limit = unlimited for one customer.
  const open = code("OPEN");
  await create(live({ code: open, usageLimitPerCustomer: null }));
  const d = await buyerWithCart([[product, 1]]);
  const addrD = await makeAddress(d.token);
  for (let i = 0; i < 3; i++) {
    assert.equal((await place(d, addrD, open)).status, 201, `use ${i + 1}`);
    await api("/cart/items", { method: "POST", token: d.token, body: { productId: product.id, quantity: 1 } });
  }
});

test("paused, expired, draft and archived coupons are refused by the server", async () => {
  const product = await makeProduct({ priceMinor: 100_000 });
  const { token } = await buyerWithCart([[product, 1]]);
  const expect = async (body, pattern) => {
    const c = code("DEAD");
    const made = await create(live({ code: c, ...body }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const v = await validate(token, c);
    assert.equal(v.body.data.valid, false);
    assert.match(v.body.data.message, pattern);
    return { c, id: made.body.data.id };
  };
  await expect({ isActive: false }, /not active/i);
  await expect({ isDraft: true }, /not active/i);
  await expect({ startAt: iso(-2 * DAY), endAt: iso(-DAY) }, /expired/i);

  const c = code("ARCH");
  const made = await create(live({ code: c }));
  assert.equal((await validate(token, c)).body.data.valid, true);
  assert.equal((await api(`/admin/coupons/${made.body.data.id}`, { method: "DELETE", token: ADMIN })).status, 200);
  assert.equal((await validate(token, c)).body.data.valid, false);
  assert.equal((await api(`/admin/coupons/${made.body.data.id}`, { token: ADMIN })).status, 404);
  assert.ok(await prisma.coupon.findUnique({ where: { code: c } }), "archived, not deleted");
  assert.equal((await validate(token, "NO-SUCH-CODE")).body.data.valid, false);
});

test("admin coupon APIs are admin-only", async () => {
  const { token } = await registerBuyer();
  for (const [method, path] of [["GET", "/admin/coupons"], ["POST", "/admin/coupons"], ["PATCH", "/admin/coupons/x"], ["DELETE", "/admin/coupons/x"]]) {
    assert.equal((await api(path, { method, token, body: method === "GET" ? undefined : {} })).status, 403, `${method} ${path} as buyer`);
    assert.equal((await api(path, { method, body: method === "GET" ? undefined : {} })).status, 401, `${method} ${path} anonymous`);
  }
  assert.equal((await api("/coupons/validate", { method: "POST", body: { code: "X" } })).status, 401);
});
