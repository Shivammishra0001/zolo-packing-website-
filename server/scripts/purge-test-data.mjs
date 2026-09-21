// Remove data left behind by the automated test suite and browser E2E runs.
//
// The suites register accounts with synthetic addresses, mint fixture
// products/categories/coupons, and drive real orders, RFQs, quotations,
// payment requests and returns as those accounts. Those rows are
// indistinguishable from production data to every dashboard query, so after
// a few runs the KPIs are dominated by test traffic.
//
// This script is OPT-IN and SCOPED: it only ever touches rows that hang off
// synthetic accounts / fixture products / fixture categories. It never
// truncates a table, never touches the canonical admin (ADMIN_EMAIL) and never
// touches an account whose address does not match a generator below.
//
//   node --env-file=.env scripts/purge-test-data.mjs            # report only (default)
//   node --env-file=.env scripts/purge-test-data.mjs --apply    # actually delete
//
// Since the suite now runs against its own database (see test/setup-db.mjs),
// this is only needed once to clean a development database that was polluted
// before that isolation existed.
import { prisma } from "../src/lib/prisma.mjs";
import { remove as removeStored } from "../src/lib/storage.mjs";

// Every identity generator in test/helpers.mjs, the suites and the browser
// E2E harnesses:
//   unique.email()        -> test_<rand>@example.com
//   old adminToken()      -> admin_<rand>@zolo.com
//   buyer/seller fixtures -> buyer_<rand>@x.com / seller_<rand>@x.com
//   E2E harnesses         -> ui_/pay_/vp_/vp3_/pay_dbg…@ex.com
//   onboarding fixtures   -> t@example.com
//
// CAREFUL: Prisma's startsWith compiles to SQL LIKE, where `_` is a
// single-character WILDCARD. `startsWith: "admin_"` also matches
// `admin@zolo.com` and would delete a real admin. Matching is done in JS,
// where `_` is just an underscore.
export const TEST_EMAIL_PATTERNS = [
  /^test_[a-z0-9]+@example\.com$/i,
  /^admin_[a-z0-9]+@zolo\.com$/i,
  /^buyer_[a-z0-9]+@x\.com$/i,
  /^seller_[a-z0-9]+@x\.com$/i,
  /@example\.com$/i, // RFC 2606 reserved — never a real customer
  /@ex\.com$/i, // browser E2E harness accounts
];
export const isTestEmail = (email) => TEST_EMAIL_PATTERNS.some((re) => re.test(email));

// Fixture products: helpers.makeProduct mints SKU-<rand>/test-box-<rand>; the
// catalog suites use TST-*; the product-form suite ZOLO-TEST-*; ad-hoc API
// reproductions ZOLO-REPRO*. (No prefix here ends in "_".)
const TEST_PRODUCT_WHERE = {
  OR: [
    { sku: { startsWith: "SKU-" } },
    { sku: { startsWith: "TST-" } },
    { sku: { startsWith: "ZOLO-TEST-" } },
    { sku: { startsWith: "ZOLO-REPRO" } },
    { sku: { startsWith: "HIST-" } }, // catalog-import-history fixtures
    { slug: { startsWith: "test-box-" } },
    { name: { startsWith: "Test Box" } },
    { name: "Dup attempt" },
  ],
};

// Fixture taxonomy the catalog suites create ("Test Cat 3F9A", "Dupe Cat …",
// "Edit Cat …", "DiagCat", "Test Sub", "Nope"). Only removed when no product
// is left in them after the product purge.
const TEST_CATEGORY_RE = /^(test cat|dupe cat|edit cat|import cat|diagcat|test sub|nope|sub cat|race cat|concurrent)/i;

// helpers.makeCoupon mints SAVE<rand> codes.
const TEST_COUPON_RE = /^SAVE[A-Z0-9]{6,10}$/;

const apply = process.argv.includes("--apply");
const keepAdmin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

const ids = (rows) => rows.map((r) => r.id);
const keyOfUrl = (url) => String(url ?? "").split("/").pop();

async function main() {
  // ---- 1. Identify --------------------------------------------------------
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true, avatarUrl: true } });
  const users = allUsers.filter((u) => isTestEmail(u.email) && u.email.toLowerCase() !== keepAdmin);
  const userIds = ids(users);

  // Organisations whose members are ALL test users (test sellers' companies).
  const orgs = await prisma.organization.findMany({ select: { id: true, members: { select: { userId: true } } } });
  const testOrgIds = orgs.filter((o) => o.members.length > 0 && o.members.every((m) => userIds.includes(m.userId))).map((o) => o.id);
  const supplierIds = ids(await prisma.supplierProfile.findMany({ where: { organizationId: { in: testOrgIds } }, select: { id: true } }));

  const products = await prisma.product.findMany({
    where: { OR: [TEST_PRODUCT_WHERE, { sellerId: { in: userIds } }] },
    select: { id: true, images: true, imageEmoji: true },
  });
  const productIds = ids(products);

  const rfqIds = ids(await prisma.rfq.findMany({ where: { userId: { in: userIds } }, select: { id: true } }));
  const quotationIds = ids(await prisma.quotation.findMany({
    where: { OR: [{ userId: { in: userIds } }, { rfqId: { in: rfqIds } }, { supplierId: { in: supplierIds } }, { createdById: { in: userIds } }] },
    select: { id: true },
  }));
  const orderIds = ids(await prisma.order.findMany({
    where: { OR: [{ userId: { in: userIds } }, { rfqId: { in: rfqIds } }, { quotationId: { in: quotationIds } }] },
    select: { id: true },
  }));
  const paymentIds = ids(await prisma.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }));
  const shipmentIds = ids(await prisma.shipment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }));
  const returnIds = ids(await prisma.returnRequest.findMany({ where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }] }, select: { id: true } }));
  const paymentRequestIds = ids(await prisma.paymentRequest.findMany({
    where: { OR: [{ userId: { in: userIds } }, { createdById: { in: userIds } }, { orderId: { in: orderIds } }, { quotationId: { in: quotationIds } }] },
    select: { id: true },
  }));
  const coupons = await prisma.coupon.findMany({ select: { id: true, code: true } });
  const couponIds = coupons.filter((c) => TEST_COUPON_RE.test(c.code)).map((c) => c.id);
  const importIds = ids(await prisma.catalogImport.findMany({ where: { actorId: { in: userIds } }, select: { id: true } }));

  const entityIds = [...userIds, ...productIds, ...rfqIds, ...quotationIds, ...orderIds, ...paymentIds, ...paymentRequestIds, ...returnIds, ...supplierIds, ...testOrgIds];

  // Stored files that will become orphans.
  const privateKeys = [
    ...(await prisma.rfqFile.findMany({ where: { OR: [{ rfqId: { in: rfqIds } }, { uploadedById: { in: userIds } }] }, select: { storageKey: true } })).map((f) => f.storageKey),
    ...(await prisma.returnFile.findMany({ where: { returnRequestId: { in: returnIds } }, select: { storageKey: true } })).map((f) => f.storageKey),
    ...(await prisma.recyclingFile.findMany({ where: { recyclingRequest: { userId: { in: userIds } } }, select: { storageKey: true } })).map((f) => f.storageKey),
    ...(await prisma.supplierDocument.findMany({ where: { supplierId: { in: supplierIds } }, select: { storageKey: true } })).map((f) => f.storageKey),
    ...(await prisma.paymentRequest.findMany({ where: { id: { in: paymentRequestIds }, proofFileKey: { not: null } }, select: { proofFileKey: true } })).map((p) => p.proofFileKey),
  ].filter(Boolean);
  const candidateImages = new Set([
    ...products.flatMap((p) => [...p.images, p.imageEmoji]).filter((u) => /^https?:\/\/.*\/uploads\//.test(u)).map(keyOfUrl),
    ...users.map((u) => u.avatarUrl).filter((u) => u && /\/uploads\//.test(u)).map(keyOfUrl),
  ]);
  // Never remove a file something surviving still points at.
  const surviving = await prisma.product.findMany({ where: { id: { notIn: productIds } }, select: { images: true, imageEmoji: true } });
  const survivingUsers = await prisma.user.findMany({ where: { id: { notIn: userIds }, avatarUrl: { not: null } }, select: { avatarUrl: true } });
  const settings = await prisma.paymentMethodSetting.findMany({ select: { config: true } });
  const keep = new Set([
    ...surviving.flatMap((p) => [...p.images, p.imageEmoji]).map(keyOfUrl),
    ...survivingUsers.map((u) => keyOfUrl(u.avatarUrl)),
    ...settings.map((s) => keyOfUrl(s.config?.qrUrl)).filter(Boolean),
  ]);
  const publicKeys = [...candidateImages].filter((k) => k && !keep.has(k));

  const report = {
    "test users": userIds.length,
    "test organisations / supplier profiles": `${testOrgIds.length} / ${supplierIds.length}`,
    "fixture products": productIds.length,
    "RFQs": rfqIds.length,
    "quotations": quotationIds.length,
    "orders": orderIds.length,
    "payments": paymentIds.length,
    "shipments": shipmentIds.length,
    "return requests": returnIds.length,
    "payment requests": paymentRequestIds.length,
    "fixture coupons": couponIds.length,
    "catalog imports": importIds.length,
    "stored files to remove (private / public)": `${privateKeys.length} / ${publicKeys.length}`,
  };
  for (const [k, v] of Object.entries(report)) console.log(String(v).padStart(10), " ", k);

  if (userIds.length + productIds.length + couponIds.length === 0) {
    console.log("\nNo test data found — nothing to purge.");
    return;
  }
  if (!apply) {
    console.log("\nDry run — nothing deleted. Re-run with --apply to remove these rows.");
    return;
  }

  // ---- 2. Delete, children before parents, in one transaction -------------
  await prisma.$transaction(async (tx) => {
    const inUsers = { in: userIds };
    await tx.refund.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { returnRequestId: { in: returnIds } }] } });
    await tx.returnRequest.deleteMany({ where: { id: { in: returnIds } } }); // files/history cascade
    await tx.paymentRequest.deleteMany({ where: { id: { in: paymentRequestIds } } });
    await tx.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await tx.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } }); // items/history/invoice/redemptions cascade

    await tx.message.deleteMany({ where: { OR: [{ rfqId: { in: rfqIds } }, { senderId: inUsers }] } });
    await tx.quotation.deleteMany({ where: { id: { in: quotationIds } } }); // items/versions cascade
    await tx.rfqFile.deleteMany({ where: { OR: [{ rfqId: { in: rfqIds } }, { uploadedById: inUsers }] } });
    await tx.rfqItem.deleteMany({ where: { OR: [{ rfqId: { in: rfqIds } }, { productId: { in: productIds } }] } });
    await tx.quotationItem.deleteMany({ where: { productId: { in: productIds } } });
    await tx.rfq.deleteMany({ where: { id: { in: rfqIds } } }); // matches cascade

    await tx.ecoCreditTransaction.deleteMany({ where: { userId: inUsers } });
    await tx.recyclingRequest.deleteMany({ where: { userId: inUsers } }); // files/history cascade
    // Eco Reward coupons generated for the purged users.
    await tx.couponRedemption.deleteMany({ where: { coupon: { assignedUserId: inUsers } } });
    await tx.coupon.deleteMany({ where: { assignedUserId: inUsers } });
    await tx.payout.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await tx.catalogImport.deleteMany({ where: { id: { in: importIds } } }); // errors cascade
    await tx.couponRedemption.deleteMany({ where: { couponId: { in: couponIds } } });
    await tx.coupon.deleteMany({ where: { id: { in: couponIds } } });

    // Noise about the deleted entities (audit rows, deliveries, admin alerts).
    await tx.auditLog.deleteMany({ where: { OR: [{ actorId: inUsers }, { entityId: { in: entityIds } }] } });
    await tx.notificationDelivery.deleteMany({ where: { OR: [{ userId: inUsers }, { entityId: { in: entityIds } }] } });
    await tx.notification.deleteMany({ where: { OR: [{ userId: inUsers }, { entityId: { in: entityIds } }] } });
    await tx.stockMovement.deleteMany({ where: { OR: [{ productId: { in: productIds } }, { actorId: inUsers }] } });

    await tx.organization.deleteMany({ where: { id: { in: testOrgIds } } }); // supplier profile + children cascade
    await tx.user.deleteMany({ where: { id: inUsers } }); // sessions/addresses/carts/customer/notifications/wishlist cascade
    await tx.product.deleteMany({ where: { id: { in: productIds } } }); // reviews/tiers/movements cascade
  }, { timeout: 300_000, maxWait: 30_000 });

  // Fixture categories that are now empty (children before parents).
  const cats = await prisma.category.findMany({ select: { id: true, name: true, parentId: true, _count: { select: { products: true, subProducts: true } } } });
  const emptyTestCats = cats.filter((c) => TEST_CATEGORY_RE.test(c.name) && c._count.products + c._count.subProducts === 0);
  const catIds = ids(emptyTestCats);
  await prisma.category.deleteMany({ where: { id: { in: catIds }, NOT: { parentId: null } } });
  await prisma.category.deleteMany({ where: { id: { in: catIds } } });

  let filesRemoved = 0;
  for (const key of [...privateKeys, ...publicKeys]) {
    try { removeStored(key); filesRemoved++; } catch { /* already gone */ }
  }

  console.log(`\nPurged ${userIds.length} test users, ${orderIds.length} orders, ${rfqIds.length} RFQs, ${quotationIds.length} quotations, ${productIds.length} products, ${catIds.length} categories, ${filesRemoved} stored files.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
