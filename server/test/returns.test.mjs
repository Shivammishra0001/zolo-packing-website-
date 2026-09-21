// Returns / recycling / points — the corrected customer-initiated workflow.
//
// The old flow let ADMIN drive DELIVERED -> RETURN_REQUESTED -> RETURNED from
// the order-status dropdown, with no customer request anywhere. These tests
// pin the corrected process: only the customer creates a request; admin
// reviews, picks ONE resolution, and processes it; points are credited only
// after recycling completes, on the accepted quantity, through the ledger.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, apiRaw, registerBuyer, registerSeller, adminToken, makeProduct, makeAddress } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Place a real COD order, then mark it delivered with a captured payment. */
async function deliveredOrder(buyer, { quantity = 1000, priceMinor = 1000 } = {}) {
  const product = await makeProduct({ priceMinor, stock: quantity * 2 });
  const addressId = await makeAddress(buyer.token);
  await api("/cart/items", { method: "POST", token: buyer.token, body: { productId: product.id, quantity } });
  const placed = await api("/checkout/place", { method: "POST", token: buyer.token, body: {
    shippingAddressId: addressId, paymentMethod: "cod", idempotencyKey: `ret-${Date.now()}-${Math.random()}`,
  } });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = placed.body.data;
  await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED", paymentStatus: "PAID", paidMinor: order.grandTotalMinor } });
  await prisma.payment.updateMany({ where: { orderId: order.id }, data: { status: "PAID", paidAt: new Date() } });
  const item = order.items[0];
  return { order, item, addressId, product };
}

const createReq = (buyer, item, addressId, over = {}) =>
  api("/returns", { method: "POST", token: buyer.token, body: {
    orderItemId: item.id, type: "RETURN", quantity: 200, reason: "damaged", condition: "damaged",
    description: "Boxes crushed in transit", pickupAddressId: addressId, ...over,
  } });

test("TEST 1 — customer creates the request; admin only receives it", async () => {
  const buyer = await registerBuyer();
  const { item, addressId, order } = await deliveredOrder(buyer);

  const res = await createReq(buyer, item, addressId);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const r = res.body.data;
  assert.match(r.requestNumber, /^RET-\d{4}-\d{6}$/);
  assert.equal(r.status, "SUBMITTED");
  assert.equal(r.quantity, 200);
  assert.equal(r.order.orderNumber, order.orderNumber);
  assert.equal(r.timeline[0].status, "SUBMITTED");

  // Photo evidence attaches (magic-byte checked).
  const up = await api(`/returns/${r.id}/files`, { method: "POST", token: buyer.token, body: {
    fileName: "damage.png", mime: "image/png", dataBase64: PNG.toString("base64"),
  } });
  assert.equal(up.status, 201);

  // Order flips to RETURN_REQUESTED automatically.
  const o = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
  assert.equal(o.status, "RETURN_REQUESTED");

  // Admin sees it in the queue…
  const admin = await adminToken();
  const list = await api("/admin/returns?status=SUBMITTED", { token: admin });
  assert.ok(list.body.data.requests.some((x) => x.requestNumber === r.requestNumber));

  // …but has NO creation endpoint, and can no longer drive return statuses
  // from the order dropdown.
  const adminCreate = await api("/admin/returns", { method: "POST", token: admin, body: {} });
  assert.equal(adminCreate.status, 404, "no admin creation route exists");
  const fresh = await deliveredOrder(await registerBuyer());
  const drive = await api(`/admin/orders/${fresh.order.id}/status`, { method: "PATCH", token: admin, body: { status: "RETURN_REQUESTED" } });
  assert.equal(drive.status, 400);
  assert.equal(drive.body.code, "USE_RETURNS_WORKFLOW");
});

test("eligibility is enforced server-side (status, ownership, quantity, window)", async () => {
  const buyer = await registerBuyer();
  const stranger = await registerBuyer();
  const { item, addressId, order } = await deliveredOrder(buyer, { quantity: 100 });

  // Foreign item -> 404 (never confirms the order exists).
  const strangerAddr = await makeAddress(stranger.token);
  assert.equal((await createReq(stranger, item, strangerAddr)).status, 404);

  // Over-quantity -> 400.
  const over = await createReq(buyer, item, addressId, { quantity: 101 });
  assert.equal(over.status, 400);
  assert.equal(over.body.code, "QUANTITY_EXCEEDED");

  // Foreign pickup address -> 404.
  assert.equal((await createReq(buyer, item, "addr-nope", { quantity: 10 })).status, 404);

  // Undelivered order -> 409.
  await prisma.order.update({ where: { id: order.id }, data: { status: "SHIPPED" } });
  const early = await createReq(buyer, item, addressId, { quantity: 10 });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, "NOT_DELIVERED");
  await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });

  // Expired window -> 409.
  await prisma.order.update({ where: { id: order.id }, data: { updatedAt: new Date(Date.now() - 40 * 86400_000) } });
  const late = await createReq(buyer, item, addressId, { quantity: 10 });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "WINDOW_CLOSED");
});

test("TEST 2 — refund path: reference required, amount bounded, statuses enforced", async () => {
  const buyer = await registerBuyer();
  const admin = await adminToken();
  const { item, addressId } = await deliveredOrder(buyer, { quantity: 1000, priceMinor: 1000 }); // line ₹10,000
  const r = (await createReq(buyer, item, addressId, { quantity: 200 })).body.data;

  // Jumping SUBMITTED -> REFUNDED is refused at every step.
  assert.equal((await api(`/admin/returns/${r.id}/refund`, { method: "POST", token: admin, body: { amountMinor: 1, reference: "X" } })).status, 409);

  await api(`/admin/returns/${r.id}/review`, { method: "POST", token: admin });
  await api(`/admin/returns/${r.id}/approve`, { method: "POST", token: admin, body: { notes: "ok" } });
  const branch = await api(`/admin/returns/${r.id}/resolution`, { method: "POST", token: admin, body: { resolution: "REFUND" } });
  assert.equal(branch.body.data.status, "REFUND_PROCESSING");

  // No reference -> refused; over item-quantity value -> refused.
  const noRef = await api(`/admin/returns/${r.id}/refund`, { method: "POST", token: admin, body: { amountMinor: 1000 } });
  assert.equal(noRef.status, 400);
  assert.equal(noRef.body.code, "REFERENCE_REQUIRED");
  const tooBig = await api(`/admin/returns/${r.id}/refund`, { method: "POST", token: admin, body: { amountMinor: 200 * 1000 + 1, reference: "UTR1" } });
  assert.equal(tooBig.status, 400);

  // Valid: 200 units × ₹10 = ₹2,000.
  const done = await api(`/admin/returns/${r.id}/refund`, { method: "POST", token: admin, body: { amountMinor: 200_000, reference: "UTR-778899" } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.status, "REFUNDED");
  assert.equal(done.body.data.refund.amountMinor, 200_000);
  assert.equal(done.body.data.refund.reference, "UTR-778899");

  // Customer sees the full timeline.
  const mine = await api(`/returns/${r.id}`, { token: buyer.token });
  const seq = mine.body.data.timeline.map((t) => t.status);
  assert.deepEqual(seq, ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REFUND_PROCESSING", "REFUNDED"]);
});

test("TEST 3 — replacement path shows only its own workflow", async () => {
  const buyer = await registerBuyer();
  const admin = await adminToken();
  const { item, addressId } = await deliveredOrder(buyer, { quantity: 500 });
  const r = (await createReq(buyer, item, addressId, { quantity: 100, reason: "defective" })).body.data;

  await api(`/admin/returns/${r.id}/review`, { method: "POST", token: admin });
  await api(`/admin/returns/${r.id}/approve`, { method: "POST", token: admin });
  const set = await api(`/admin/returns/${r.id}/resolution`, { method: "POST", token: admin, body: { resolution: "REPLACEMENT", replacementQuantity: 100 } });
  assert.equal(set.body.data.status, "REPLACEMENT_PROCESSING");

  // Refund endpoint is off-limits on this branch.
  assert.equal((await api(`/admin/returns/${r.id}/refund`, { method: "POST", token: admin, body: { amountMinor: 1, reference: "X" } })).status, 409);

  const ship = await api(`/admin/returns/${r.id}/replacement/ship`, { method: "POST", token: admin, body: { courier: "BlueDart", trackingNumber: "BD123" } });
  assert.equal(ship.body.data.status, "REPLACEMENT_SHIPPED");
  assert.equal(ship.body.data.replacement.tracking, "BD123");
  const del = await api(`/admin/returns/${r.id}/replacement/deliver`, { method: "POST", token: admin });
  assert.equal(del.body.data.status, "REPLACEMENT_DELIVERED");
});

test("TEST 4 — a product return is NOT recycling: no recycle type, no recycle resolution, no Eco Credits", async () => {
  const buyer = await registerBuyer();
  const admin = await adminToken();
  const { item, addressId } = await deliveredOrder(buyer, { quantity: 500 });

  // The old order-item "recycle" request is gone — recycling has its own workflow.
  const legacy = await createReq(buyer, item, addressId, { type: "RECYCLE", quantity: 500, reason: "recycle", condition: "used" });
  assert.equal(legacy.status, 400);
  assert.equal(legacy.body.code, "USE_RECYCLING_REQUEST");
  assert.equal((await api(`/returns/estimate?orderItemId=${item.id}&quantity=500`, { token: buyer.token })).status, 404, "no points estimate on returns");

  const r = (await createReq(buyer, item, addressId, { quantity: 10 })).body.data;
  assert.match(r.requestNumber, /^RET-\d{4}-\d{6}$/);
  await api(`/admin/returns/${r.id}/review`, { method: "POST", token: admin });
  await api(`/admin/returns/${r.id}/approve`, { method: "POST", token: admin });

  const recycleRes = await api(`/admin/returns/${r.id}/resolution`, { method: "POST", token: admin, body: { resolution: "RECYCLE" } });
  assert.equal(recycleRes.status, 400);
  assert.equal(recycleRes.body.code, "USE_RECYCLING_REQUEST");
  assert.equal((await api(`/admin/returns/${r.id}/recycle/credit-points`, { method: "POST", token: admin })).status, 404, "the credit-points endpoint no longer exists");

  // Physical flow: approved -> pickup scheduled -> received -> inspected -> refund.
  const pickup = await api(`/admin/returns/${r.id}/pickup`, { method: "POST", token: admin, body: { date: new Date(Date.now() + 86400000).toISOString() } });
  assert.equal(pickup.status, 200, JSON.stringify(pickup.body));
  assert.equal(pickup.body.data.status, "PICKUP_SCHEDULED");
  assert.equal((await api(`/admin/returns/${r.id}/received`, { method: "POST", token: admin })).body.data.status, "RECEIVED");
  const insp = await api(`/admin/returns/${r.id}/inspection`, { method: "POST", token: admin, body: { receivedQuantity: 10, acceptedQuantity: 8, rejectedQuantity: 2, notes: "2 units used" } });
  assert.equal(insp.body.data.status, "INSPECTED");
  const branch = await api(`/admin/returns/${r.id}/resolution`, { method: "POST", token: admin, body: { resolution: "REFUND" } });
  assert.equal(branch.body.data.status, "REFUND_PROCESSING");

  // Through the whole return the customer's Eco Credit wallet never moved.
  const walletAfter = await api("/eco-credits", { token: buyer.token });
  assert.equal(walletAfter.status, 200);
  assert.equal(walletAfter.body.data.balance, 0);
  assert.equal(walletAfter.body.data.transactions.length, 0);
});

test("TEST 5 — authorization matrix", async () => {
  const buyer = await registerBuyer();
  const other = await registerBuyer();
  const seller = await registerSeller();
  const { item, addressId } = await deliveredOrder(buyer);
  const r = (await createReq(buyer, item, addressId, { quantity: 10 })).body.data;

  // Customer B cannot see or act on A's request.
  assert.equal((await api(`/returns/${r.id}`, { token: other.token })).status, 404);
  assert.equal((await api(`/returns/${r.id}/cancel`, { method: "POST", token: other.token })).status, 404);

  // Customers and sellers cannot reach admin processing.
  for (const tok of [buyer.token, seller.token]) {
    assert.equal((await api(`/admin/returns/${r.id}/approve`, { method: "POST", token: tok })).status, 403);
    assert.equal((await api(`/admin/returns/${r.id}/pickup`, { method: "POST", token: tok })).status, 403);
  }
  // Anonymous: 401.
  assert.equal((await api("/returns")).status, 401);
  // Evidence files are private to owner + admin.
  const admin = await adminToken();
  const up = await api(`/returns/${r.id}/files`, { method: "POST", token: buyer.token, body: { fileName: "p.png", mime: "image/png", dataBase64: PNG.toString("base64") } });
  const fileId = up.body.data.id;
  assert.equal((await apiRaw(`/returns/${r.id}/files/${fileId}/download`, { token: other.token })).status, 404);
  assert.equal((await apiRaw(`/returns/${r.id}/files/${fileId}/download`, { token: buyer.token })).status, 200);
  assert.equal((await apiRaw(`/admin/returns/${r.id}/files/${fileId}/download`, { token: admin })).status, 200);
});

test("TEST 6 — partial returns: totals never exceed the purchase; cancel releases quantity", async () => {
  const buyer = await registerBuyer();
  const { item, addressId } = await deliveredOrder(buyer, { quantity: 1000 });

  assert.equal((await createReq(buyer, item, addressId, { quantity: 200 })).status, 201);
  const second = await createReq(buyer, item, addressId, { quantity: 800 });
  assert.equal(second.status, 201);
  // 1001st unit -> refused.
  const over = await createReq(buyer, item, addressId, { quantity: 1 });
  assert.equal(over.status, 400);
  assert.equal(over.body.code, "QUANTITY_EXCEEDED");

  // Cancelling releases the quantity again.
  await api(`/returns/${second.body.data.id}/cancel`, { method: "POST", token: buyer.token });
  assert.equal((await createReq(buyer, item, addressId, { quantity: 800 })).status, 201);
});

test("TEST 7 — resubmitting the same form twice does not double-book quantity beyond the purchase", async () => {
  const buyer = await registerBuyer();
  const { item, addressId } = await deliveredOrder(buyer, { quantity: 100 });
  const a = await createReq(buyer, item, addressId, { quantity: 100 });
  assert.equal(a.status, 201);
  // A refresh/back/forward resubmit is a SECOND request — refused because the
  // full quantity is already booked; no duplicate refunds or points can follow.
  const b = await createReq(buyer, item, addressId, { quantity: 100 });
  assert.equal(b.status, 400);
  assert.equal(b.body.code, "QUANTITY_EXCEEDED");
});
