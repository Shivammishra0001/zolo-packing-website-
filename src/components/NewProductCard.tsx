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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      whileHover={{ y: -6 }}
      className="group bg-white rounded-2xl overflow-hidden card-shadow card-shadow-hover transition-all border border-dark-100 flex flex-col"
    >
      <Link to={`/product/${product.slug}`} className="block relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-dark-50 to-dark-100">
        <motion.div
          animate={{ scale: hovered ? 1.08 : 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="absolute inset-0 flex items-center justify-center p-4"
        >
          {hasRealImage ? (
            <img src={product.image} alt={product.name} className="h-full w-full object-contain rounded-xl bg-white/70 p-3" />
          ) : (
            <PackagingMockup type={mockupType} color={product.accent} className="w-full h-full" />
          )}
        </motion.div>

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {product.bestseller && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
              <Zap className="h-2.5 w-2.5" /> Bestseller
            </span>
          )}
          {product.newArrival && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
              New
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={(e) => { e.preventDefault(); guard(() => toggle(product.id), { label: "save to wishlist" }); }}
          aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
          className="absolute top-3 right-3 h-9 w-9 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-all shadow-md"
        >
          <Heart className={`h-4 w-4 transition-colors ${wishlisted ? "fill-primary-500 text-primary-500" : "text-dark-500"}`} />
        </button>

        {/* Hover Overlay with Quick Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: hovered ? 1 : 0 }}
          className="absolute inset-0 bg-dark-950/40 backdrop-blur-[2px] flex items-end justify-center p-4"
        >
          <div className="flex gap-2 w-full">
            <button
              onClick={(e) => { e.preventDefault(); guard(() => nav(`/product/${product.slug}`), { label: "view this product" }); }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white text-dark-900 text-xs font-semibold hover:bg-primary-500 hover:text-white transition-colors"
            >
              <Eye className="h-3.5 w-3.5" /> Quick View
            </button>
            <button
              onClick={(e) => { e.preventDefault(); guard(() => nav(`/product/${product.slug}`), { label: "request a quote" }); }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-colors"
            >
              <Quote className="h-3.5 w-3.5" /> Quote
            </button>
          </div>
        </motion.div>
      </Link>

      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-primary-600 font-bold">{product.materials[0]}</span>
          <span className="text-dark-300 text-xs">·</span>
          <span className="text-[10px] uppercase tracking-wider text-dark-500 font-semibold">MOQ {product.moq}</span>
        </div>

        <Link to={`/product/${product.slug}`} className="flex-1">
          <h3 className="font-display font-bold text-dark-900 leading-snug line-clamp-2 group-hover:text-primary-600 transition-colors text-sm">
            {product.name}
          </h3>
        </Link>

        {/* Ratings render only from real review data — never a fabricated score. */}
        {product.rating != null && (
          <div className="flex items-center gap-1.5 mt-2 text-xs">
            <div className="flex items-center gap-0.5">
              {[...Array(5)].map((_, i) => (
                <svg key={i} className={`h-3 w-3 ${i < Math.round(product.rating!) ? "text-amber-400 fill-current" : "text-dark-200 fill-current"}`} viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.293z" />
                </svg>
              ))}
              <span className="font-semibold text-dark-800 ml-1">{product.rating}</span>
            </div>
            {product.reviews != null && <span className="text-dark-400">({product.reviews})</span>}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-dark-100 space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-dark-500">
                {quoteOnly ? "Min. Order (MOQ)" : "Price"}
              </div>
              <div className="font-display text-sm font-bold text-dark-900 leading-none">
                {quoteOnly
                  ? `${product.moq} ${product.unit}s`
                  : `₹${(priceMinor / 100).toLocaleString("en-IN")}`}
              </div>
            </div>
            {!quoteOnly && inStock && (
              // Quantity stepper. Always visible — never hover-only, so it
              // works on touch devices too.
              <div className="flex items-center rounded-lg border border-dark-200">
                <button
                  onClick={(e) => { e.preventDefault(); setQty((q) => Math.max(1, q - 1)); }}
                  aria-label={`Decrease quantity of ${product.name}`}
                  className="px-2 py-1.5 text-dark-500 hover:text-dark-900 disabled:opacity-40"
                  disabled={qty <= 1}
                >
                  <Minus className="h-3 w-3" aria-hidden />
                </button>
                <span className="min-w-6 text-center text-xs font-bold tabular-nums text-dark-900" aria-live="polite">{qty}</span>
                <button
                  onClick={(e) => { e.preventDefault(); setQty((q) => q + 1); }}
                  aria-label={`Increase quantity of ${product.name}`}
                  className="px-2 py-1.5 text-dark-500 hover:text-dark-900"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                </button>
              </div>
            )}
          </div>

          {quoteOnly ? (
            <Link
              to={`/product/${product.slug}`}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-dark-900 text-white text-xs font-semibold hover:bg-primary-500 transition-colors"
            >
              <Quote className="h-3.5 w-3.5" aria-hidden /> Request Quote
            </Link>
          ) : !inStock ? (
            <button
              disabled
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-dark-100 text-dark-400 text-xs font-semibold cursor-not-allowed"
            >
              Out of stock
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={(e) => handleAddToCart(e)}
                disabled={adding}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 disabled:opacity-60 transition-colors"
              >
                {adding
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  : <ShoppingCart className="h-3.5 w-3.5" aria-hidden />}
                {adding ? "Adding…" : "Add to Cart"}
              </button>
              <button
                onClick={(e) => handleAddToCart(e, true)}
                disabled={adding}
                aria-label={`Buy ${product.name} now`}
                className="px-3 py-2 rounded-lg bg-dark-900 text-white text-xs font-semibold hover:bg-dark-800 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                Buy Now
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function LargeProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const mockupType = typeToMockup[product.category] || "mailer";
  const hasRealImage = /^(blob:|\/|https?:|data:)/.test(product.image) || /\.(png|jpg|jpeg|webp|svg)$/i.test(product.image);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      whileHover={{ y: -8 }}
      className="group relative bg-white rounded-3xl overflow-hidden card-shadow-lg border border-dark-100"
    >
      <Link to={`/product/${product.slug}`} className="block">
        <div className="aspect-square bg-gradient-to-br from-dark-50 to-dark-100 relative overflow-hidden">
          <motion.div
            whileHover={{ scale: 1.1 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 flex items-center justify-center p-6"
          >
            {hasRealImage ? (
              <img src={product.image} alt={product.name} className="h-full w-full object-contain p-3" />
            ) : (
              <PackagingMockup type={mockupType} color={product.accent} className="w-full h-full" />
            )}
          </motion.div>
          {product.bestseller && (
            <div className="absolute top-4 left-4 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
              <Zap className="h-2.5 w-2.5" /> Bestseller
            </div>
          )}
        </div>
        <div className="p-6">
          <div className="text-[10px] uppercase tracking-wider text-primary-600 font-bold mb-1">
            {product.materials[0]}
          </div>
          <h3 className="font-display text-lg font-bold text-dark-900 group-hover:text-primary-600 transition-colors">
            {product.name}
          </h3>
          <div className="flex items-end justify-between mt-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-dark-500">Min. Order (MOQ)</div>
              <div className="font-display text-sm font-bold text-dark-900">
                {product.moq} {product.unit}s
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
