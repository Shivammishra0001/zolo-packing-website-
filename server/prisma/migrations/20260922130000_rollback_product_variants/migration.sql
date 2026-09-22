-- Roll back 20260922110000_product_variants: the Product → Variant
-- architecture was withdrawn. Everything removed here was added by that
-- migration and was verified empty / at its default before this ran; the
-- pre-existing "variants" JSON column on Product is untouched.

-- OrderItem: variant snapshot columns
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_variantId_fkey";
DROP INDEX IF EXISTS "OrderItem_variantId_idx";
ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "variantId",
  DROP COLUMN IF EXISTS "variantAttributes",
  DROP COLUMN IF EXISTS "moq";

-- CartItem: variant reference + restore the original unique index
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_variantId_fkey";
DROP INDEX IF EXISTS "CartItem_cartId_productId_variantId_variant_key";
DROP INDEX IF EXISTS "CartItem_variantId_idx";
ALTER TABLE "CartItem" DROP COLUMN IF EXISTS "variantId";
CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_cartId_productId_variant_key" ON "CartItem"("cartId", "productId", "variant");

-- StockMovement: variant tag
ALTER TABLE "StockMovement" DROP COLUMN IF EXISTS "variantId";

-- Product: kind / option axes / brand / manufacturer
ALTER TABLE "Product" DROP COLUMN IF EXISTS "hasVariants",
  DROP COLUMN IF EXISTS "variantOptions",
  DROP COLUMN IF EXISTS "brand",
  DROP COLUMN IF EXISTS "manufacturer";

-- The variant table itself
DROP TABLE IF EXISTS "ProductVariant";
