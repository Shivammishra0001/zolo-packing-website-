// Cart service. One cart per user; line items snapshot the unit price at add
// time but pricing is always recomputed from the live catalog at checkout.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { effectiveUnitPriceMinor } from "../lib/commerce.mjs";

async function getOrCreateCart(userId, tx = prisma) {
  const existing = await tx.cart.findUnique({ where: { userId } });
  return existing ?? tx.cart.create({ data: { userId } });
}

/**
 * Load the sellable unit: the product (simple) or the chosen variant (variable).
 * Returns { product, variant, unitPriceMinor, available, moq } — the numbers
 * the cart trusts, never the client's.
 */
async function loadPurchasable(productId, variantId) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.deletedAt || product.status !== "active") {
    throw notFound("Product is not available");
  }
  if (product.hasVariants) {
    if (!variantId) throw badRequest("Choose the size / option before adding to the cart", "VARIANT_REQUIRED");
    const variant = await prisma.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null } });
    if (!variant || !variant.isActive) throw notFound("That option is not available");
    if (variant.priceMinor === 0) throw badRequest("This option is quotation-only and can't be added to the cart", "QUOTE_ONLY");
    return { product, variant, unitPriceMinor: variant.priceMinor, available: Math.max(0, variant.stock - variant.reservedStock), moq: variant.moq };
  }
  if (variantId) throw badRequest("This product has no options", "NOT_VARIABLE");
  if (product.basePriceMinor === 0 && !(product.salePriceMinor > 0)) {
    throw badRequest("This product is quotation-only and can't be added to the cart", "QUOTE_ONLY");
  }
  return { product, variant: null, unitPriceMinor: effectiveUnitPriceMinor(product), available: Math.max(0, product.stock - product.reservedStock), moq: product.moq };
}

// Shape a cart with its items joined to current product data (name, image,
// live price, available stock) for the client — without trusting the client.
export async function getCartView(userId) {
  const cart = await getOrCreateCart(userId);
  const items = await prisma.cartItem.findMany({ where: { cartId: cart.id }, orderBy: { createdAt: "asc" } });
  const productIds = [...new Set(items.map((i) => i.productId))];
  const variantIds = items.map((i) => i.variantId).filter(Boolean);
  const [products, variants] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } } }),
    variantIds.length ? prisma.productVariant.findMany({ where: { id: { in: variantIds } } }) : [],
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const vById = new Map(variants.map((v) => [v.id, v]));

  const lines = items.map((it) => {
    const p = byId.get(it.productId);
    const v = it.variantId ? vById.get(it.variantId) : null;
    const variantGone = Boolean(it.variantId) && (!v || v.deletedAt || !v.isActive);
    const unitPriceMinor = v && !variantGone ? v.priceMinor : p && !it.variantId ? effectiveUnitPriceMinor(p) : it.unitPriceMinor;
    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      variant: v?.label ?? it.variant,
      attributes: v?.attributes ?? null,
      quantity: it.quantity,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * it.quantity,
      name: p?.name ?? "Unavailable product",
      sku: v?.sku ?? p?.sku ?? null,
      image: v?.image ?? p?.imageEmoji ?? "📦",
      available: v && !variantGone ? Math.max(0, v.stock - v.reservedStock) : p && !it.variantId ? Math.max(0, p.stock - p.reservedStock) : 0,
      moq: v?.moq ?? p?.moq ?? 1,
      unavailable: !p || p.deletedAt != null || p.status !== "active" || variantGone || (p.hasVariants && !it.variantId),
    };
  });
  return { cartId: cart.id, items: lines };
}

export async function addItem(userId, { productId, variantId, variant, quantity }) {
  const unit = await loadPurchasable(productId, variantId ?? null);
  const cart = await getOrCreateCart(userId);
  // A variant line is keyed by variantId; a simple line by the legacy descriptor.
  const label = unit.variant ? unit.variant.label : variant ?? null;
  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId, variantId: unit.variant?.id ?? null, variant: label },
  });

  const nextQty = (existing?.quantity ?? 0) + quantity;
  if (nextQty > unit.available) {
    throw badRequest(`Only ${unit.available} in stock`, "INSUFFICIENT_STOCK");
  }

  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQty } });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        variantId: unit.variant?.id ?? null,
        variant: label,
        quantity,
        unitPriceMinor: unit.unitPriceMinor,
      },
    });
  }
  return getCartView(userId);
}

export async function updateItem(userId, itemId, quantity) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) throw notFound("Cart item not found");
  const unit = await loadPurchasable(item.productId, item.variantId);
  if (quantity > unit.available) {
    throw badRequest(`Only ${unit.available} in stock`, "INSUFFICIENT_STOCK");
  }
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return getCartView(userId);
}

export async function removeItem(userId, itemId) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
  return getCartView(userId);
}

export async function clearCart(userId) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return getCartView(userId);
}
