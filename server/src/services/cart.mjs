// Cart service. One cart per user; line items snapshot the unit price at add
// time but pricing is always recomputed from the live catalog at checkout.
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { effectiveUnitPriceMinor } from "../lib/commerce.mjs";

async function getOrCreateCart(userId, tx = prisma) {
  const existing = await tx.cart.findUnique({ where: { userId } });
  return existing ?? tx.cart.create({ data: { userId } });
}

// Load an active product or throw a clear customer-facing error.
async function loadPurchasableProduct(productId) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.deletedAt || product.status !== "active") {
    throw notFound("Product is not available");
  }
  if (product.basePriceMinor === 0 && !(product.salePriceMinor > 0)) {
    throw badRequest("This product is quotation-only and can't be added to the cart", "QUOTE_ONLY");
  }
  return product;
}

const availableStock = (p) => Math.max(0, p.stock - p.reservedStock);

// Shape a cart with its items joined to current product data (name, image,
// live price, available stock) for the client — without trusting the client.
export async function getCartView(userId) {
  const cart = await getOrCreateCart(userId);
  const items = await prisma.cartItem.findMany({ where: { cartId: cart.id }, orderBy: { createdAt: "asc" } });
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = items.map((it) => {
    const p = byId.get(it.productId);
    const unitPriceMinor = p ? effectiveUnitPriceMinor(p) : it.unitPriceMinor;
    return {
      id: it.id,
      productId: it.productId,
      variant: it.variant,
      quantity: it.quantity,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * it.quantity,
      name: p?.name ?? "Unavailable product",
      sku: p?.sku ?? null,
      image: p?.imageEmoji ?? "📦",
      available: p ? availableStock(p) : 0,
      moq: p?.moq ?? 1,
      unavailable: !p || p.deletedAt != null || p.status !== "active",
    };
  });
  return { cartId: cart.id, items: lines };
}

export async function addItem(userId, { productId, variant, quantity }) {
  const product = await loadPurchasableProduct(productId);
  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId_variant: { cartId: cart.id, productId, variant: variant ?? null } },
  }).catch(() => null);

  const nextQty = (existing?.quantity ?? 0) + quantity;
  if (nextQty > availableStock(product)) {
    throw badRequest(`Only ${availableStock(product)} in stock`, "INSUFFICIENT_STOCK");
  }

  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQty } });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId,
        variant: variant ?? null,
        quantity,
        unitPriceMinor: effectiveUnitPriceMinor(product),
      },
    });
  }
  return getCartView(userId);
}

export async function updateItem(userId, itemId, quantity) {
  const cart = await getOrCreateCart(userId);
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) throw notFound("Cart item not found");
  const product = await loadPurchasableProduct(item.productId);
  if (quantity > availableStock(product)) {
    throw badRequest(`Only ${availableStock(product)} in stock`, "INSUFFICIENT_STOCK");
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
