// Reset the application to a clean state.
//
// Removes ALL transactional and account data — users, orders, payments,
// invoices, shipments, carts, addresses, suppliers, RFQs, quotations,
// negotiation threads, payouts, stock ledger, coupons, CMS blocks,
// notifications and audit history — while PRESERVING:
//
//   * one admin login, so the app remains reachable after the reset
//   * BY DEFAULT the product catalog (Product + Category + images);
//     pass --include-catalog to wipe that too (a completely empty app)
//
// Test-fixture products (SKU-*/TST-* skus, "test-box-*" slugs created by the
// integration suite) are ALWAYS removed, even when the catalog is kept.
//
// Uploaded files: private uploads (KYC documents, RFQ requirement sheets) are
// removed — their DB rows are gone after the reset. Public uploads that no
// surviving product references are removed as orphans.
//
// Deletion is ordered child-to-parent by foreign key, inside one transaction:
// either the whole reset lands or none of it does. Nothing here truncates a
// table or drops a schema, so migration history stays intact.
//
//   node scripts/reset-app-data.mjs                          # dry run (default)
//   node scripts/reset-app-data.mjs --apply                  # perform the reset
//   node scripts/reset-app-data.mjs --apply --include-catalog
//   node scripts/reset-app-data.mjs --apply --keep-invoice-seq
//
// TAKE A BACKUP FIRST — this cannot be undone:
//   pg_dump "$DATABASE_URL" > backup.sql
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.mjs";
import { UPLOADS_PATH, PRIVATE_UPLOADS_PATH } from "../src/lib/storage.mjs";

const apply = process.argv.includes("--apply");
const includeCatalog = process.argv.includes("--include-catalog");
const resetInvoiceSeq = !process.argv.includes("--keep-invoice-seq");

// The single admin account that survives the reset. Defaults to the account
// the server reseeds on boot (ADMIN_EMAIL), so reset + restart always agree.
const KEEP_ADMIN_EMAIL = (process.env.RESET_KEEP_ADMIN || process.env.ADMIN_EMAIL || "admin@zolo.com").toLowerCase();

// Products the integration suite creates. NOTE: `startsWith` compiles to SQL
// LIKE where `_` is a wildcard — these prefixes deliberately contain none.
const TEST_PRODUCT_WHERE = {
  OR: [
    { sku: { startsWith: "SKU-" } }, // helpers.makeProduct
    { sku: { startsWith: "TST-" } }, // catalog import fixtures
    { slug: { startsWith: "test-box-" } },
  ],
};

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

  const [users, products, testProducts, categories, orders, rfqs, quotations, notifications, audit, suppliers, movements, payouts, cms] =
    await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.product.count({ where: TEST_PRODUCT_WHERE }),
      prisma.category.count(),
      prisma.order.count(),
      prisma.rfq.count(),
      prisma.quotation.count(),
      prisma.notification.count(),
      prisma.auditLog.count(),
      prisma.supplierProfile.count(),
      prisma.stockMovement.count(),
      prisma.payout.count(),
      prisma.cmsBlock.count(),
    ]);

  console.log("PLAN");
  console.log("────────────────────────────────────────────");
  console.log(`  keep admin        ${keeper.email}`);
  if (includeCatalog) {
    console.log(`  delete products   ${products} → 0   (--include-catalog)`);
    console.log(`  delete categories ${categories} → 0`);
  } else {
    console.log(`  keep products     ${products - testProducts} (removing ${testProducts} test fixtures)`);
    console.log(`  keep categories   ${categories}`);
  }
  console.log("");
  console.log(`  delete users      ${users} → 1`);
  console.log(`  delete orders     ${orders} → 0`);
  console.log(`  delete RFQs       ${rfqs} → 0 (quotations: ${quotations})`);
  console.log(`  delete suppliers  ${suppliers} → 0 (payouts: ${payouts})`);
  console.log(`  delete ledger     ${movements} → 0`);
  console.log(`  delete CMS blocks ${cms} → 0`);
  console.log(`  delete notifs     ${notifications} → 0`);
  console.log(`  delete audit log  ${audit} → 0`);
  console.log(`  invoice sequence  ${resetInvoiceSeq ? "reset to 1" : "unchanged"}`);
  console.log(`  private uploads   all removed`);
  console.log(`  public uploads    orphans removed`);
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
      await tx.order.deleteMany({}); // before Rfq/Quotation (order references both)
      await tx.coupon.deleteMany({});

      // --- RFQ / marketplace graph -----------------------------------------
      // Before users: Message.senderId and RfqFile.uploadedById block user
      // deletion. Quotation.rfqId does not cascade, so quotations go first.
      await tx.quoteVersion.deleteMany({});
      await tx.quotationItem.deleteMany({});
      await tx.quotation.deleteMany({});
      await tx.message.deleteMany({});
      await tx.rfqFile.deleteMany({});
      await tx.rfqMatch.deleteMany({});
      await tx.rfqItem.deleteMany({});
      await tx.rfq.deleteMany({});
      await tx.savedRequirement.deleteMany({});

      // --- Shopping state --------------------------------------------------
      await tx.cartItem.deleteMany({});
      await tx.cart.deleteMany({});
      await tx.wishlistItem.deleteMany({});
      await tx.wishlist.deleteMany({});
      await tx.review.deleteMany({});
      await tx.address.deleteMany({});
      await tx.customer.deleteMany({});

      // --- Supplier / organisation graph -----------------------------------
      await tx.payout.deleteMany({}); // references SupplierProfile (no cascade)
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

      // --- Ledger / content / deliveries -----------------------------------
      // The stock ledger references orders and users that no longer exist —
      // a fresh app starts its ledger at the next real movement.
      await tx.stockMovement.deleteMany({});
      await tx.cmsBlock.deleteMany({});
      await tx.notificationDelivery.deleteMany({});

      // --- History / accounts ----------------------------------------------
      await tx.productAiAnalysis.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.session.deleteMany({});
      await tx.user.deleteMany({ where: { id: { not: keeper.id } } });

      // --- Catalog ----------------------------------------------------------
      if (includeCatalog) {
        await tx.product.deleteMany({});
        await tx.category.deleteMany({});
      } else {
        // Test fixtures out; real catalog stays, with reservations released
        // (they belonged to now-deleted carts and orders).
        await tx.product.deleteMany({ where: TEST_PRODUCT_WHERE });
        await tx.product.updateMany({ where: { reservedStock: { not: 0 } }, data: { reservedStock: 0 } });
      }

      if (resetInvoiceSeq) {
        await tx.invoiceCounter.deleteMany({});
      }
    },
    { timeout: 120_000 },
  );

  // --- Uploaded files (outside the DB transaction; DB is already consistent) --
  // Private tree: every owning row (SupplierDocument, RfqFile) is gone.
  let removedPrivate = 0;
  for (const f of readdirSync(PRIVATE_UPLOADS_PATH)) {
    if (f === ".gitkeep") continue;
    rmSync(join(PRIVATE_UPLOADS_PATH, f), { force: true });
    removedPrivate++;
  }

  // Public tree: keep only files a surviving product still references.
  const kept = includeCatalog ? [] : await prisma.product.findMany({ select: { images: true } });
  const referenced = new Set();
  for (const p of kept) {
    for (const url of p.images ?? []) {
      const key = String(url).split("/").pop();
      if (key) referenced.add(key);
    }
  }
  let removedPublic = 0;
  for (const f of readdirSync(UPLOADS_PATH)) {
    if (f === ".gitkeep" || referenced.has(f)) continue;
    rmSync(join(UPLOADS_PATH, f), { force: true });
    removedPublic++;
  }

  console.log(`\nReset complete. Removed ${removedPrivate} private and ${removedPublic} orphaned public upload(s).`);
}

main()
  .catch((err) => {
    console.error("\nReset FAILED — the database was not modified.");
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
