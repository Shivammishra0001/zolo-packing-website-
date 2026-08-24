// Reset the application to a clean state.
//
// Removes all transactional and account data — users, orders, payments,
// invoices, shipments, carts, addresses, suppliers, coupons, notifications and
// audit history — while PRESERVING:
//
//   * the product catalog (Product + Category), including imported images
//   * one admin login, so the app remains reachable after the reset
//
// Deletion is ordered child-to-parent by foreign key, inside one transaction:
// either the whole reset lands or none of it does. Nothing here truncates a
// table or drops a schema, so migration history stays intact.
//
//   node scripts/reset-app-data.mjs              # dry run (default)
//   node scripts/reset-app-data.mjs --apply      # perform the reset
//   node scripts/reset-app-data.mjs --apply --keep-invoice-seq
//
// TAKE A BACKUP FIRST — this cannot be undone:
//   pg_dump "$DATABASE_URL" > backup.sql
import { prisma } from "../src/lib/prisma.mjs";

const apply = process.argv.includes("--apply");
const resetInvoiceSeq = !process.argv.includes("--keep-invoice-seq");

// The single admin account that survives the reset.
const KEEP_ADMIN_EMAIL = (process.env.RESET_KEEP_ADMIN || "admin@zolo.com").toLowerCase();

async function main() {
  const keeper = await prisma.user.findUnique({
    where: { email: KEEP_ADMIN_EMAIL },
    select: { id: true, email: true, role: true },
  });

  if (!keeper) {
    throw new Error(
      `Admin account "${KEEP_ADMIN_EMAIL}" was not found. Refusing to wipe the ` +
        `database without a surviving login. Set RESET_KEEP_ADMIN to an existing admin email.`,
    );
  }
  if (!["admin", "verification_admin", "finance_admin", "operations_admin"].includes(keeper.role)) {
    throw new Error(`"${keeper.email}" is not an admin (role: ${keeper.role}). Refusing to proceed.`);
  }

  const [users, products, categories, orders, notifications, audit, suppliers] = await Promise.all([
    prisma.user.count(),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.category.count(),
    prisma.order.count(),
    prisma.notification.count(),
    prisma.auditLog.count(),
    prisma.supplierProfile.count(),
  ]);

  console.log("PLAN");
  console.log("────────────────────────────────────────────");
  console.log(`  keep admin        ${keeper.email}`);
  console.log(`  keep products     ${products}`);
  console.log(`  keep categories   ${categories}`);
  console.log("");
  console.log(`  delete users      ${users} → 1`);
  console.log(`  delete orders     ${orders} → 0`);
  console.log(`  delete suppliers  ${suppliers} → 0`);
  console.log(`  delete notifs     ${notifications} → 0`);
  console.log(`  delete audit log  ${audit} → 0`);
  console.log(`  invoice sequence  ${resetInvoiceSeq ? "reset to 1" : "unchanged"}`);
  console.log("────────────────────────────────────────────");

  if (!apply) {
    console.log("\nDry run — nothing was deleted. Re-run with --apply to perform the reset.");
    return;
  }

  // One transaction: a failure part-way leaves the database untouched rather
  // than half-wiped. Children are deleted before their parents throughout.
  await prisma.$transaction(
    async (tx) => {
      // --- Commerce -------------------------------------------------------
      await tx.shipmentEvent.deleteMany({});
      await tx.shipment.deleteMany({});
      await tx.refund.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.invoice.deleteMany({});
      await tx.orderStatusHistory.deleteMany({});
      await tx.couponRedemption.deleteMany({});
      await tx.orderItem.deleteMany({});
      await tx.order.deleteMany({});
      await tx.coupon.deleteMany({});

      // --- Shopping state --------------------------------------------------
      await tx.cartItem.deleteMany({});
      await tx.cart.deleteMany({});
      await tx.wishlistItem.deleteMany({});
      await tx.wishlist.deleteMany({});
      await tx.review.deleteMany({});
      await tx.address.deleteMany({});
      await tx.customer.deleteMany({});

      // --- Supplier / organisation graph -----------------------------------
      await tx.supplierChangeRequest.deleteMany({});
      await tx.supplierStatusHistory.deleteMany({});
      await tx.supplierLogistics.deleteMany({});
      await tx.supplierQuality.deleteMany({});
      await tx.supplierBankAccount.deleteMany({});
      await tx.supplierDocument.deleteMany({});
      await tx.supplierCertification.deleteMany({});
      await tx.supplierMaterial.deleteMany({});
      await tx.supplierMachine.deleteMany({});
      await tx.supplierCapacity.deleteMany({});
      await tx.supplierCapability.deleteMany({});
      await tx.supplierLocation.deleteMany({});
      await tx.supplierProfile.deleteMany({});
      await tx.organizationMember.deleteMany({});
      await tx.organization.deleteMany({});

      // --- History / accounts ----------------------------------------------
      // Product AI analyses reference products (kept) but carry review history
      // tied to deleted users, so they go too.
      await tx.productAiAnalysis.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.session.deleteMany({});
      await tx.user.deleteMany({ where: { id: { not: keeper.id } } });

      // --- Catalog hygiene ---------------------------------------------------
      // Products survive, but their stock reservations belonged to now-deleted
      // carts and orders. Leaving them would permanently hide sellable stock.
      await tx.product.updateMany({ where: { reservedStock: { not: 0 } }, data: { reservedStock: 0 } });

      if (resetInvoiceSeq) {
        await tx.invoiceCounter.deleteMany({});
      }
    },
    { timeout: 120_000 },
  );

  console.log("\nReset complete.");
}

main()
  .catch((err) => {
    console.error("\nReset FAILED — the database was not modified.");
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
