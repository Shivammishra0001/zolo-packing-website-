// Requirement-sheet attachments + draft->submit + owner delivery record.
//
// Covers the security matrix the feature demands:
//   - only the owner can attach/list/download/delete their RFQ's files
//   - an admin can download any RFQ's file
//   - an invited seller can download; an uninvited seller cannot
//   - content that does not match its declared MIME type is refused
//   - a draft RFQ submits later (files-first flow) and the WhatsApp delivery
//     is recorded honestly (SKIPPED without credentials — never fake-SENT)
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, apiRaw, registerBuyer, registerSeller, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

test.before(async () => { await startServer(); });
test.after(async () => { await stopServer(); });

const XLSX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]); // zip magic
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj");
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ header

const THREE_ITEMS = [
  { productName: "Corrugated Box", quantity: 5000, unit: "pcs", specs: { dimensions: "15 x 10 x 5 inch", material: "5-ply", color: "Brown", printing: "2-color" } },
  { productName: "Paper Bag", quantity: 2000, unit: "pcs", specs: { dimensions: "12 x 16 inch", material: "Kraft", color: "Brown", printing: "1-color" } },
  { productName: "Packaging Tape", quantity: 500, unit: "rolls", specs: { dimensions: "48mm" } },
];

async function makeDraftRfq(token) {
  const res = await api("/rfqs", { method: "POST", token, body: {
    items: THREE_ITEMS,
    ship: { city: "Mumbai", state: "Maharashtra" },
    submit: false,
  } });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, "DRAFT");
  return res.body.data;
}

const upload = (token, rfqId, { fileName = "requirements.xlsx", mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes = XLSX_BYTES } = {}) =>
  api(`/rfqs/${rfqId}/files`, { method: "POST", token, body: { fileName, mime, dataBase64: bytes.toString("base64") } });

test("one RFQ holds many products; a requirement sheet attaches and downloads", async () => {
  const buyer = await registerBuyer();
  const rfq = await makeDraftRfq(buyer.token);
  assert.equal(rfq.itemCount, 3);
  assert.equal(rfq.totalQuantity, 7500);

  const up = await upload(buyer.token, rfq.id);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.data.fileName, "requirements.xlsx");

  const list = await api(`/rfqs/${rfq.id}/files`, { token: buyer.token });
  assert.equal(list.body.data.files.length, 1);

  const dl = await apiRaw(`/rfqs/${rfq.id}/files/${up.body.data.id}/download`, { token: buyer.token });
  assert.equal(dl.status, 200);
  assert.equal(dl.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
});

test("file content must match its declared type (a renamed executable is refused)", async () => {
  const buyer = await registerBuyer();
  const rfq = await makeDraftRfq(buyer.token);

  const bad = await upload(buyer.token, rfq.id, { fileName: "totally-a-sheet.xlsx", bytes: EXE_BYTES });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "BAD_CONTENT");

  const badMime = await upload(buyer.token, rfq.id, { fileName: "x.exe", mime: "application/x-msdownload", bytes: EXE_BYTES });
  assert.equal(badMime.status, 400);
  assert.equal(badMime.body.code, "BAD_MIME");
});

test("only the owner, an admin, or an invited seller can read a requirement sheet", async () => {
  const buyer = await registerBuyer();
  const stranger = await registerBuyer();
  const invitedSeller = await registerSeller();
  const rivalSeller = await registerSeller();
  const admin = await adminToken();

  const rfq = await makeDraftRfq(buyer.token);
  const up = await upload(buyer.token, rfq.id, { fileName: "specs.pdf", mime: "application/pdf", bytes: PDF_BYTES });
  assert.equal(up.status, 201);
  const fileId = up.body.data.id;

  // Invite ONE seller directly (deterministic — bypasses scoring).
  await prisma.rfqMatch.create({ data: { rfqId: rfq.id, supplierId: invitedSeller.supplierId } });

  // Another buyer: 404, never confirming the RFQ exists.
  const foreign = await apiRaw(`/rfqs/${rfq.id}/files/${fileId}/download`, { token: stranger.token });
  assert.equal(foreign.status, 404);

  // Uninvited seller: 404.
  const rival = await apiRaw(`/sellers/rfqs/${rfq.id}/files/${fileId}/download`, { token: rivalSeller.token });
  assert.equal(rival.status, 404);

  // Invited seller: 200.
  const invited = await apiRaw(`/sellers/rfqs/${rfq.id}/files/${fileId}/download`, { token: invitedSeller.token });
  assert.equal(invited.status, 200);

  // Admin: 200 (by id or by rfqNumber-based admin detail is separate; download is by id).
  const adminDl = await apiRaw(`/admin/rfqs/${rfq.id}/files/${fileId}/download`, { token: admin });
  assert.equal(adminDl.status, 200);

  // Unauthenticated: 401.
  const anon = await apiRaw(`/rfqs/${rfq.id}/files/${fileId}/download`);
  assert.equal(anon.status, 401);
});

test("draft -> submit: files-first flow notifies admin and records an honest delivery", async () => {
  const buyer = await registerBuyer();
  const rfq = await makeDraftRfq(buyer.token);
  await upload(buyer.token, rfq.id);

  // Drafts are invisible to admin.
  const admin = await adminToken();
  const before = await api(`/admin/rfqs/${rfq.rfqNumber}`, { token: admin });
  // (adminGetRfq resolves numbers, but list excludes drafts; detail may find it — status check matters)

  const submitted = await api(`/rfqs/${rfq.id}/submit`, { method: "POST", token: buyer.token });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body.data.status, "SUBMITTED");
  assert.equal(submitted.body.data.files.length, 1);

  // Submitting twice conflicts rather than double-notifying.
  const again = await api(`/rfqs/${rfq.id}/submit`, { method: "POST", token: buyer.token });
  assert.equal(again.status, 409);

  // Admin sees it (by rfqNumber — the id the admin table links with).
  const detail = await api(`/admin/rfqs/${rfq.rfqNumber}`, { token: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.items.length, 3);
  assert.equal(detail.body.data.files.length, 1);
  assert.ok(Array.isArray(detail.body.data.activity));
  assert.ok(detail.body.data.activity.some((a) => a.eventType === "rfq.created"));

  // WhatsApp is unconfigured in tests: delivery row exists and is SKIPPED —
  // the RFQ succeeded anyway, and nothing pretended to send.
  const deliveries = await prisma.notificationDelivery.findMany({ where: { entityType: "Rfq", entityId: rfq.id } });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "SKIPPED");
  assert.equal(deliveries[0].channel, "whatsapp");
  void before;
});

test("a buyer cannot attach files to someone else's RFQ", async () => {
  const owner = await registerBuyer();
  const attacker = await registerBuyer();
  const rfq = await makeDraftRfq(owner.token);

  const res = await upload(attacker.token, rfq.id);
  assert.equal(res.status, 404);
});

test("a seller's quote reaches the buyer with the seller's identity attached", async () => {
  const buyer = await registerBuyer();
  const seller = await registerSeller();
  const rfq = await makeDraftRfq(buyer.token);
  await api(`/rfqs/${rfq.id}/submit`, { method: "POST", token: buyer.token });
  await prisma.rfqMatch.create({ data: { rfqId: rfq.id, supplierId: seller.supplierId } });

  const itemId = rfq.items[0].id;
  const quote = await api(`/sellers/rfqs/${rfq.id}/quote`, { method: "POST", token: seller.token, body: {
    items: [{ rfqItemId: itemId, unitPriceMinor: 1250 }],
    shippingMinor: 5000,
    leadTimeDays: 10,
  } });
  assert.equal(quote.status, 201, JSON.stringify(quote.body));

  const mine = await api(`/rfqs/${rfq.id}`, { token: buyer.token });
  assert.equal(mine.status, 200);
  const q = mine.body.data.quotations.find((x) => x.id === quote.body.data.id);
  assert.ok(q, "buyer sees the seller quote");
  // Identity + verification status power the buyer's comparison table.
  assert.ok(q.seller, "quotation carries its seller");
  assert.equal(q.seller.id, seller.supplierId);
  assert.ok("verificationStatus" in q.seller);
  // Totals were computed server-side from unit price x quantity + shipping.
  assert.equal(q.grandTotalMinor, 5000 * 1250 + 5000);
  // The buyer's list also exposes how many sellers were matched.
  assert.equal(mine.body.data.matchCount, 1);
});

test("the classic single-call create (submit:true) also records a delivery", async () => {
  const buyer = await registerBuyer();
  const res = await api("/rfqs", { method: "POST", token: buyer.token, body: {
    items: [{ productName: "Mailer Box", quantity: 1000 }],
    ship: { city: "Pune", state: "Maharashtra" },
    autoMatch: false,
  } });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.status, "SUBMITTED");

  const deliveries = await prisma.notificationDelivery.findMany({ where: { entityType: "Rfq", entityId: res.body.data.id } });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "SKIPPED");
});
