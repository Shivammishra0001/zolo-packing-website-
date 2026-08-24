// Remove data left behind by the automated test suite.
//
// The suite registers buyers as `test_<random>@example.com` and places real
// orders as those users. Those rows are indistinguishable from production data
// to every dashboard query, so after a few runs the KPIs (orders today, new
// customers, revenue) are dominated by test traffic.
//
// This script is OPT-IN and scoped: it only ever touches users whose email
// matches the suite's own generator, and the rows that hang off them. It never
// truncates a table and never touches a real customer.
//
//   node scripts/purge-test-data.mjs --dry-run   # report only (default)
//   node scripts/purge-test-data.mjs --apply     # actually delete
import { prisma } from "../src/lib/prisma.mjs";

// Every identity generator in test/helpers.mjs and the suites:
//   unique.email()   -> test_<rand>@example.com
//   adminToken()     -> admin_<rand>@zolo.com
//   buyer fixtures   -> buyer_<rand>@x.com
//
// CAREFUL: Prisma's startsWith compiles to SQL LIKE, where `_` is a
// single-character WILDCARD. `startsWith: "admin_"` therefore also matches
// `admin@zolo.com` (the `@` satisfies the `_`) and would delete the real admin.
// Matching is done in JS below instead, where `_` is just an underscore.
const TEST_EMAIL_PATTERNS = [
  /^test_[a-z0-9]+@example\.com$/i,
  /^admin_[a-z0-9]+@zolo\.com$/i,
  /^buyer_[a-z0-9]+@x\.com$/i,
  /^seller_[a-z0-9]+@x\.com$/i,
];

const isTestEmail = (email) => TEST_EMAIL_PATTERNS.some((re) => re.test(email));

// makeProduct() mints SKU-<rand>; the per-suite fixtures use TST-* SKUs.
const TEST_PRODUCT_FILTER = {
  OR: [{ sku: { startsWith: "SKU-" } }, { sku: { startsWith: "TST-" } }, { name: { startsWith: "Test Box" } }],
};

// Junk taxonomy the catalog suites create.
const TEST_CATEGORY_FILTER = {
  OR: [{ name: { startsWith: "Test Cat" } }, { name: { startsWith: "DiagCat" } }, { name: "Test Sub" }],
};

const apply = process.argv.includes("--apply");

async function main() {
  // Fetch every account and filter in JS — see the LIKE-wildcard note above.
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const users = allUsers.filter((u) => isTestEmail(u.email));
  const userIds = users.map((u) => u.id);

  const testProducts = await prisma.product.count({ where: TEST_PRODUCT_FILTER });
  const testCategories = await prisma.category.count({ where: TEST_CATEGORY_FILTER });

  if (userIds.length === 0 && testProducts === 0 && testCategories === 0) {
    console.log("No test data found — nothing to purge.");
    return;
  }

  const orders = await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  const payments = await prisma.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const paymentIds = payments.map((p) => p.id);
  const shipments = await prisma.shipment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const shipmentIds = shipments.map((s) => s.id);

  console.log(`test users:      ${userIds.length}`);
  console.log(`their orders:    ${orderIds.length}`);
  console.log(`their payments:  ${paymentIds.length}`);
  console.log(`their shipments: ${shipmentIds.length}`);
  console.log(`test products:   ${testProducts}`);
  console.log(`test categories: ${testCategories}`);

  if (!apply) {
    console.log("\nDry run — nothing deleted. Re-run with --apply to remove these rows.");
    return;
  }

  // Children first: the schema only cascades from Invoice and ShipmentEvent.
  await prisma.$transaction(async (tx) => {
    await tx.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await tx.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await tx.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await tx.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.couponRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });

    await tx.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } });
    await tx.cart.deleteMany({ where: { userId: { in: userIds } } });
    await tx.address.deleteMany({ where: { userId: { in: userIds } } });
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.session.deleteMany({ where: { userId: { in: userIds } } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });

  // Fixture products/categories the suites create. Children before parents so
  // the self-referencing Category.parentId FK doesn't block the delete.
  const products = await prisma.product.deleteMany({ where: TEST_PRODUCT_FILTER });
  await prisma.category.deleteMany({ where: { AND: [TEST_CATEGORY_FILTER, { NOT: { parentId: null } }] } });
  const categories = await prisma.category.deleteMany({ where: TEST_CATEGORY_FILTER });

  console.log(
    `\nPurged ${userIds.length} test users, ${orderIds.length} orders, ` +
      `${products.count} products and ${categories.count} categories.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
