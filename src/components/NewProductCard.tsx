import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, Loader2, Minus, Plus, Quote, ShoppingCart } from "lucide-react";
import type { Product } from "../data/products";
import { useWishlist } from "../App";
import { Heart, Zap } from "lucide-react";
import PackagingMockup from "./PackagingMockup";
import { useState } from "react";
import { useAuthGuard } from "./auth/AuthGuard";
import { useNavigate } from "react-router-dom";
import { addToCart } from "../lib/cart-store";
import { useToast } from "./ui/Toast";
import { summarizeOptions } from "../lib/product-options";

const typeToMockup: Record<string, "mailer" | "shipping" | "pizza" | "cosmetic" | "pouch" | "jar" | "tube" | "rigid" | "tuck" | "bag"> = {
  mailer: "mailer",
  shipping: "shipping",
  corrugated: "shipping",
  cosmetic: "tuck",
  gift: "rigid",
  bottle: "jar",
  pouch: "pouch",
  food: "pizza",
  apparel: "bag",
  device: "rigid",
  print: "mailer",
  paper: "tuck",
};

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { toggle, has } = useWishlist();
  const guard = useAuthGuard();
  const nav = useNavigate();
  const wishlisted = has(product.id);
  const [hovered, setHovered] = useState(false);
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);

  // A product with no fixed price is quotation-based — Zolo never sells those
  // through the cart, so the card offers "Request Quote" instead of a button
  // that would fail server-side.
  const priceMinor = (product as { priceMinor?: number }).priceMinor ?? 0;
  const quoteOnly = priceMinor <= 0;
  const sizesSummary = summarizeOptions(product.sizes ?? [], 3);
  const colorsSummary = summarizeOptions(product.colors ?? [], 3);
  const inStock = product.inStock !== false;

  /**
   * Add to cart. Guests get the auth modal and the action resumes afterwards.
   * `adding` also guards against double-clicks creating duplicate cart calls.
   */
  const handleAddToCart = (e: React.MouseEvent, thenGoToCart = false) => {
    e.preventDefault();
    e.stopPropagation();
    if (adding) return;
    guard(
      async () => {
        setAdding(true);
        try {
          await addToCart({ productId: product.id, variant: null, quantity: qty });
          if (thenGoToCart) nav("/cart");
          else toast.success("Added to cart", `${qty} × ${product.name}`);
        } catch (err) {
          toast.error("Couldn't add to cart", err instanceof Error ? err.message : "Please try again.");
        } finally {
          setAdding(false);
        }
      },
      { label: thenGoToCart ? "buy this product now" : "add this product to your cart" },
    );
  };

  const mockupType = typeToMockup[product.category] || "mailer";
  const hasRealImage = /^(blob:|\/|https?:|data:)/.test(product.image) || /\.(png|jpg|jpeg|webp|svg)$/i.test(product.image);

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.2) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group @container card card-hover flex h-full flex-col overflow-hidden"
      data-product-card
    >
      {/* Fixed 4:3 image stage: every card has the same image area, images
          are contained (never cropped or stretched) on a mint surface. */}
      <Link to={`/product/${product.slug}`} className="relative block aspect-[4/3] overflow-hidden bg-green-50">
        <div className={`absolute inset-0 flex items-center justify-center p-4 transition-transform duration-300 ease-out ${hovered ? "scale-[1.04]" : "scale-100"}`}>
          {hasRealImage ? (
            <img src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain" />
          ) : (
            <PackagingMockup type={mockupType} color={product.accent} className="h-full w-full" />
          )}
        </div>

        <div className="absolute left-3 top-3 flex flex-col gap-1">
          {product.bestseller && <span className="badge bg-primary-500 text-white shadow-sm"><Zap className="h-2.5 w-2.5" aria-hidden /> Bestseller</span>}
          {product.newArrival && <span className="badge bg-green-500 text-white shadow-sm">New</span>}
          {quoteOnly && <span className="badge bg-white/90 text-green-700 shadow-sm">Quote based</span>}
        </div>

        <button
          onClick={(e) => { e.preventDefault(); guard(() => toggle(product.id), { label: "save to wishlist" }); }}
          aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-dark-500 shadow-sm transition-colors hover:text-primary-500"
        >
          <Heart className={`h-4 w-4 ${wishlisted ? "fill-primary-500 text-primary-500" : ""}`} />
        </button>

        {/* Quick view on hover (desktop only; touch devices tap the card). */}
        <span className={`pointer-events-none absolute inset-x-3 bottom-3 hidden items-center justify-center gap-1.5 rounded-lg bg-navy-900/85 py-2 text-xs font-semibold text-white backdrop-blur-sm transition-opacity duration-200 sm:flex ${hovered ? "opacity-100" : "opacity-0"}`}>
          <Eye className="h-3.5 w-3.5" aria-hidden /> Quick view
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
          {product.specTag && <span className="truncate text-green-600">{product.specTag}</span>}
          {product.specTag && <span className="text-dark-300" aria-hidden>·</span>}
          <span className="shrink-0 text-dark-500">MOQ {product.moq.toLocaleString("en-IN")}</span>
        </div>

        <Link to={`/product/${product.slug}`} className="mt-1.5 block">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[15px] font-bold leading-5 text-dark-900 transition-colors group-hover:text-green-600">
            {product.name}
          </h3>
        </Link>

        {/* Sizes / colours summary — a line renders ONLY when the product has
            values, so a card never shows an empty "Sizes:" label. Reserved
            height keeps CTA rows aligned across the grid. */}
        <dl className="mt-1.5 min-h-[2.25rem] space-y-0.5 text-xs text-dark-600">
          {sizesSummary && (
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 font-semibold text-dark-500">Sizes:</dt>
              <dd className="truncate" title={product.sizes.join(", ")}>{sizesSummary}</dd>
            </div>
          )}
          {colorsSummary && (
            <div className="flex min-w-0 gap-1">
              <dt className="shrink-0 font-semibold text-dark-500">Colors:</dt>
              <dd className="truncate" title={product.colors.join(", ")}>{colorsSummary}</dd>
            </div>
          )}
        </dl>

        {/* Price + CTA row, pinned to the bottom so it aligns across cards. */}
        <div className="mt-auto border-t border-dark-100 pt-3">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-dark-500">{quoteOnly ? "Min. order" : "Price"}</div>
              <div className="font-display text-base font-bold leading-none text-dark-900">
                {quoteOnly
                  ? `${product.moq.toLocaleString("en-IN")} ${product.unit}s`
                  : <>{product.sizes.length > 1 && <span className="text-xs font-semibold text-dark-500">From </span>}₹{(priceMinor / 100).toLocaleString("en-IN")}</>}
              </div>
            </div>
            {!quoteOnly && inStock && (
              <div className="flex h-9 items-center rounded-lg border border-dark-200" aria-label="Quantity">
                <button onClick={(e) => { e.preventDefault(); setQty((q) => Math.max(1, q - 1)); }} aria-label={`Decrease quantity of ${product.name}`} disabled={qty <= 1} className="h-full px-2 text-dark-500 hover:text-dark-900 disabled:opacity-40"><Minus className="h-3 w-3" aria-hidden /></button>
                <span className="min-w-6 text-center text-xs font-bold tabular-nums text-dark-900" aria-live="polite">{qty}</span>
                <button onClick={(e) => { e.preventDefault(); setQty((q) => q + 1); }} aria-label={`Increase quantity of ${product.name}`} className="h-full px-2 text-dark-500 hover:text-dark-900"><Plus className="h-3 w-3" aria-hidden /></button>
              </div>
            )}
          </div>

          <div className="mt-3">
            {quoteOnly ? (
              <Link to={`/product/${product.slug}`} className="btn btn-primary btn-sm w-full">
                <Quote className="h-3.5 w-3.5" aria-hidden /> Request Quote
              </Link>
            ) : !inStock ? (
              <button disabled className="btn btn-sm w-full bg-dark-100 text-dark-400">Out of stock</button>
            ) : (
              <div className="flex gap-1.5">
                <button onClick={(e) => handleAddToCart(e)} disabled={adding} className="btn btn-primary btn-sm min-w-0 flex-1">
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShoppingCart className="h-3.5 w-3.5" aria-hidden />}
                  <span className="truncate">{adding ? "Adding…" : "Add to Cart"}</span>
                </button>
                <button onClick={(e) => handleAddToCart(e, true)} disabled={adding} aria-label={`Buy ${product.name} now`} className="btn btn-navy btn-sm hidden @[13rem]:inline-flex">
                  Buy Now
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export function LargeProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const mockupType = typeToMockup[product.category] || "mailer";
  const hasRealImage = /^(blob:|\/|https?:|data:)/.test(product.image) || /\.(png|jpg|jpeg|webp|svg)$/i.test(product.image);
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.2) }}
      className="group card card-hover overflow-hidden"
    >
      <Link to={`/product/${product.slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-green-50">
          <div className="absolute inset-0 flex items-center justify-center p-6 transition-transform duration-300 group-hover:scale-[1.04]">
            {hasRealImage ? <img src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-contain" /> : <PackagingMockup type={mockupType} color={product.accent} className="h-full w-full" />}
          </div>
          {product.bestseller && <span className="badge absolute left-3 top-3 bg-primary-500 text-white shadow-sm"><Zap className="h-2.5 w-2.5" aria-hidden /> Bestseller</span>}
        </div>
        <div className="p-4">
          {product.specTag && <div className="text-[11px] font-semibold uppercase tracking-wide text-green-600">{product.specTag}</div>}
          <h3 className="h3 mt-1 line-clamp-2 text-dark-900 transition-colors group-hover:text-green-600">{product.name}</h3>
          <div className="mt-3 text-xs text-dark-500">Min. order <span className="font-bold text-dark-900">{product.moq.toLocaleString("en-IN")} {product.unit}s</span></div>
        </div>
      </Link>
    </motion.article>
  );
}
