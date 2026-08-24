import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Star,
  Heart,
  Share2,
  Zap,
  Minus,
  Plus,
  Check,
  Truck,
  ShieldCheck,
  RefreshCw,
  Upload,
  ChevronRight,
  X,
  Quote,
  Info,
  Package,
  ShoppingCart,
} from "lucide-react";
import { useWishlist } from "../App";
import { useAuthGuard } from "../components/auth/AuthGuard";
import { useAuthSession } from "../components/auth/AuthContext";
import { useBuyerProductBySlug, useBuyerProducts } from "../lib/products";
import { addToCart } from "../lib/cart-store";
import { useToast } from "../components/ui/Toast";
import { Button, SectionHeader } from "../components/UI";
import { ProductCard } from "../components/NewProductCard";
import PackagingMockup from "../components/PackagingMockup";

const typeToMockup: Record<string, "mailer" | "shipping" | "pizza" | "cosmetic" | "pouch" | "jar" | "tube" | "rigid" | "tuck" | "bag"> = {
  print: "mailer", food: "pizza", pouches: "pouch", jars: "jar", tubes: "tube",
  cans: "rigid", cups: "tuck", apparel: "bag", device: "rigid", others: "shipping", tapes: "shipping",
};

export default function Details() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { isAuthenticated, openAuthModal } = useAuthSession();

  // Unified product source: the shared catalog store (admin + bulk-imported).
  const storeProduct = useBuyerProductBySlug(slug);
  const [product, setProduct] = useState<any | null>(storeProduct ?? null);
  const [loading, setLoading] = useState(!storeProduct);
  const { toggle, has } = useWishlist();
  const guard = useAuthGuard();
  const toast = useToast();
  const allProducts = useBuyerProducts(); // real catalog — for related products

  // BUSINESS RULE: guests may browse listings but NOT open a product page.
  // On a guest visit we open the ONE shared auth modal and stash a pending
  // action that re-opens THIS product after login — so the customer lands on
  // the product automatically without clicking it again. Then we bounce to the
  // listing so the guarded page never renders for a guest.
  useEffect(() => {
    if (!isAuthenticated && slug) {
      const target = `/product/${slug}`;
      openAuthModal({
        tab: "login",
        pendingAction: { label: "view this product", run: () => nav(target) },
      });
      nav("/products", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, slug]);

  if (!isAuthenticated) return null;

  const [selectedSize, setSelectedSize] = useState(0);
  const [selectedMaterial, setSelectedMaterial] = useState(0);
  const [quantity, setQuantity] = useState(100);
  const [artwork, setArtwork] = useState<string | null>(null);
  const [artworkName, setArtworkName] = useState("");
  const [activeTab, setActiveTab] = useState<"specs" | "features" | "shipping">("specs");

  useEffect(() => {
    // Resolve from the unified catalog store (admin + bulk-imported products,
    // backed by the live :5001 API via useBuyerProducts). Single source of truth.
    setProduct(storeProduct ?? null);
    setLoading(false);

    // Reset selection configurations when navigating to a new product
    setSelectedSize(0);
    setSelectedMaterial(0);
    setArtwork(null);
    setArtworkName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, storeProduct]);

  useEffect(() => {
    if (product) {
      setQuantity(product.moq || 100);
    }
  }, [product]);

  if (loading) {
    return (
      <main className="min-h-[60vh] flex items-center justify-center py-20 bg-white">
        <div className="text-center text-dark-500 text-sm">
          Loading product details...
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-[60vh] flex items-center justify-center py-20 bg-white">
        <div className="text-center">
          <div className="text-5xl mb-4">📦</div>
          <h1 className="font-display text-2xl font-bold mb-2 text-dark-900">Product not found</h1>
          <Link to="/products" className="text-primary-500 font-semibold hover:underline">
            ← Back to products
          </Link>
        </div>
      </main>
    );
  }

  const wishlisted = has(product._id || product.id);
  const related = allProducts.filter((p) => p.category === product.category && p.slug !== product.slug).slice(0, 4);
  const mockupType = typeToMockup[product.category] || "mailer";
  const hasRealImage = /^(blob:|\/|https?:|data:)/.test(product.image) || /\.(png|jpg|jpeg|webp|svg)$/i.test(product.image);

  const handleArtwork = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setArtwork(ev.target?.result as string);
      setArtworkName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const outOfStock = product.inStock === false || product.stockStatus === "out_of_stock";
  // Quotation-based product (no fixed price): never show ₹0 / cart buttons —
  // the Request Custom Quote CTA below is the purchase path.
  const quoteOnly = !product.priceMinor;

  const handleAddToCart = () => {
    // Guarded: guests get the auth modal, then this resumes automatically.
    guard(
      async () => {
        // Combine the selected size/material chips into one variant descriptor.
        const parts = [product.sizes?.[selectedSize], product.materials?.[selectedMaterial]].filter(Boolean);
        const variant = parts.length ? parts.join(" / ") : null;
        try {
          await addToCart({ productId: product._id || product.id, variant, quantity });
          toast.success("Added to cart", `${quantity} × ${product.name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Please try again.";
          toast.error("Couldn't add to cart", msg);
        }
      },
      { label: "add this product to your cart" },
    );
  };

  const handleBuyNow = () => {
    guard(
      async () => {
        const parts = [product.sizes?.[selectedSize], product.materials?.[selectedMaterial]].filter(Boolean);
        const variant = parts.length ? parts.join(" / ") : null;
        try {
          await addToCart({ productId: product._id || product.id, variant, quantity });
          nav("/cart");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Please try again.";
          toast.error("Couldn't add to cart", msg);
        }
      },
      { label: "buy this product now" },
    );
  };

  const handleRequestQuote = () => {
    // Protected action: guests are prompted to authenticate first, then this
    // resumes automatically after a successful (future) backend login.
    guard(
      () => {
        const message = `Hi! I would like to get a custom quote for:
- Product: ${product.name}
- Quantity: ${quantity} ${product.unit}s
- Size: ${product.sizes[selectedSize] || "Default"}
- Material: ${product.materials[selectedMaterial] || "Default"}${artworkName ? `\n- Artwork file: ${artworkName}` : ""}`;
        nav("/contact", { state: { message } });
      },
      { label: "request a custom quote" },
    );
  };

  return (
    <main className="py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Breadcrumb */}
        <div className="mb-6 text-xs text-dark-500 flex items-center gap-1.5">
          <Link to="/" className="hover:text-dark-900">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/products" className="hover:text-dark-900">Products</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-dark-700 font-medium line-clamp-1">{product.name}</span>
        </div>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* LEFT: Product Image */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative aspect-square rounded-3xl bg-gradient-to-br from-dark-50 to-dark-100 overflow-hidden flex items-center justify-center card-shadow-lg p-12">
              <motion.div
                key={product.id || product._id}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="w-full h-full"
              >
                {hasRealImage ? (
                  <img src={product.image} alt={product.name} className="h-full w-full object-contain p-4" />
                ) : (
                  <PackagingMockup type={mockupType} color={product.accent} className="w-full h-full drop-shadow-xl" />
                )}
              </motion.div>

              {artwork && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <img src={artwork} alt="artwork" className="max-h-32 max-w-32 rounded-xl object-contain opacity-80 shadow-lg" />
                </div>
              )}

              <div className="absolute top-4 left-4 flex gap-2">
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

              <div className="absolute top-4 right-4 flex gap-2">
                <button onClick={() => guard(() => toggle(product.id), { label: "save to wishlist" })} aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"} className="h-10 w-10 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-all shadow-md">
                  <Heart className={`h-5 w-5 ${wishlisted ? "fill-primary-500 text-primary-500" : "text-dark-500"}`} />
                </button>
                <button className="h-10 w-10 rounded-full bg-white flex items-center justify-center hover:scale-110 transition-all shadow-md">
                  <Share2 className="h-5 w-5 text-dark-500" />
                </button>
              </div>

            </div>
          </motion.div>

          {/* RIGHT: Product Configuration */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div className="text-xs uppercase tracking-wider text-primary-600 font-bold mb-2">
              {product.materials[selectedMaterial]}
            </div>
            <h1 className="font-display text-3xl lg:text-4xl font-extrabold text-dark-900 leading-tight">
              {product.name}
            </h1>

            {/* Rating */}
            <div className="mt-3 flex items-center gap-4">
              <div className="flex items-center gap-1">
                <div className="flex items-center gap-0.5 text-amber-400">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`h-4 w-4 ${i <= Math.round(product.rating) ? "fill-current" : "text-dark-200 fill-dark-200"}`} />
                  ))}
                </div>
                <span className="font-semibold text-sm">{product.rating}</span>
                <span className="text-dark-500 text-sm">({product.reviews.toLocaleString()})</span>
              </div>
              <span className="h-4 w-px bg-dark-200" />
              <span className="text-sm text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> In stock
              </span>
            </div>

            {/* Description */}
            <div className="mt-6 p-4 rounded-2xl bg-dark-50 border border-dark-100">
              <div className="flex items-center gap-3">
                <div className="text-xs text-dark-500 font-semibold bg-white px-2.5 py-1 rounded-full border border-dark-200">
                  Minimum Order (MOQ): {product.moq} {product.unit}s
                </div>
              </div>
              <div className="mt-3 text-sm text-dark-700 leading-relaxed">{product.description}</div>
            </div>

            {/* ===== STEP-BY-STEP SELECTION ===== */}
            <div className="mt-6 space-y-6">

              {/* STEP 1: Choose Size */}
              <div className="p-5 rounded-2xl border border-dark-100 bg-white">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center">1</span>
                  <div className="text-sm font-bold text-dark-900">Choose Size</div>
                  <div className="ml-auto text-xs text-primary-600 font-semibold">{product.sizes[selectedSize]}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((s: string, i: number) => (
                    <button
                      key={s}
                      onClick={() => setSelectedSize(i)}
                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                        selectedSize === i
                          ? "bg-dark-900 text-white border-dark-900 shadow-md"
                          : "bg-white text-dark-700 border-dark-200 hover:border-dark-400"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* STEP 2: Choose Material */}
              <div className="p-5 rounded-2xl border border-dark-100 bg-white">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center">2</span>
                  <div className="text-sm font-bold text-dark-900">Choose Material</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {product.materials.map((m: string, i: number) => (
                    <button
                      key={m}
                      onClick={() => setSelectedMaterial(i)}
                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                        selectedMaterial === i
                          ? "bg-dark-900 text-white border-dark-900 shadow-md"
                          : "bg-white text-dark-700 border-dark-200 hover:border-dark-400"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* STEP 3: Upload Artwork */}
              <div className="p-5 rounded-2xl border border-dark-100 bg-white">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center">3</span>
                  <div className="text-sm font-bold text-dark-900">Upload Artwork</div>
                  <div className="ml-auto text-[10px] text-dark-400 uppercase tracking-wider">Optional</div>
                </div>
                <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-dark-200 hover:border-primary-400 cursor-pointer transition-colors bg-dark-50/50">
                  {artwork ? (
                    <>
                      <img src={artwork} className="h-10 w-10 rounded-lg object-cover" alt="" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{artworkName}</div>
                        <div className="text-xs text-dark-500">Artwork uploaded</div>
                      </div>
                      <button
                        onClick={(e) => { e.preventDefault(); setArtwork(null); setArtworkName(""); }}
                        className="text-dark-400 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="h-10 w-10 rounded-lg bg-white card-shadow flex items-center justify-center">
                        <Upload className="h-5 w-5 text-primary-500" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-dark-800">Drop your logo or artwork</div>
                        <div className="text-xs text-dark-500">PNG, JPG, AI, PDF · Max 10MB</div>
                      </div>
                      <span className="text-xs font-bold text-primary-500">Browse</span>
                    </>
                  )}
                  <input type="file" accept="image/*,.pdf,.ai" className="hidden" onChange={handleArtwork} />
                </label>
              </div>

              {/* STEP 4: Quantity */}
              <div className="p-5 rounded-2xl border border-dark-100 bg-white">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-6 w-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center">4</span>
                  <div className="text-sm font-bold text-dark-900">Select Quantity</div>
                  <div className="ml-auto text-xs text-dark-500 flex items-center gap-1">
                    <Info className="h-3 w-3" /> Min: {product.moq}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="inline-flex items-center rounded-xl border border-dark-200 bg-white">
                    <button onClick={() => setQuantity(Math.max(product.moq, quantity - 50))} className="p-3 hover:bg-dark-50 rounded-l-xl">
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      type="number"
                      min={product.moq}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(product.moq, +e.target.value))}
                      className="w-20 text-center border-x border-dark-200 py-2 font-semibold focus:outline-none"
                    />
                    <button onClick={() => setQuantity(quantity + 50)} className="p-3 hover:bg-dark-50 rounded-r-xl">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {[product.moq, product.moq * 2, product.moq * 5, product.moq * 10].map((q) => (
                      <button
                        key={q}
                        onClick={() => setQuantity(q)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          quantity === q ? "bg-dark-900 text-white border-dark-900" : "border-dark-200 text-dark-600 hover:border-dark-400"
                        }`}
                      >
                        {q >= 1000 ? `${q / 1000}K` : q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ORDER SUMMARY */}
            <div className="mt-6 p-5 rounded-2xl bg-dark-950 text-white">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-dark-300">Your Selection</span>
                <span className="text-xs text-dark-400">{product.sizes[selectedSize]} · {product.materials[selectedMaterial]}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs text-dark-400">Selected Quantity</div>
                  <div className="font-display text-2xl font-extrabold grad-text">{quantity} {product.unit}s</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-dark-400">Ships in</div>
                  <div className="text-sm font-bold text-emerald-400">5-10 days</div>
                </div>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="mt-6 space-y-3">
              {outOfStock ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-700">
                  Out of stock — Add to Cart and Buy Now are unavailable.
                </div>
              ) : quoteOnly ? (
                <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-center text-sm font-semibold text-primary-700">
                  Quotation-based product — request a quote for pricing.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleAddToCart}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-dark-300 bg-white py-3 text-sm font-bold text-dark-900 hover:border-dark-400 hover:bg-dark-50"
                  >
                    <ShoppingCart className="h-4 w-4" /> Add to Cart
                  </button>
                  <button
                    onClick={handleBuyNow}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-dark-900 py-3 text-sm font-bold text-white hover:bg-dark-800"
                  >
                    Buy Now
                  </button>
                </div>
              )}
              <Button onClick={handleRequestQuote} size="lg" className="w-full justify-center">
                <Quote className="h-4 w-4" /> Request Custom Quote
              </Button>
            </div>

            {/* Trust badges */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { icon: Truck, label: "Free shipping", sub: "Orders ₹250+" },
                { icon: ShieldCheck, label: "Quality", sub: "ISO certified" },
                { icon: RefreshCw, label: "30-day", sub: "returns" },
              ].map((f) => (
                <div key={f.label} className="p-3 rounded-xl bg-dark-50 border border-dark-100 text-center">
                  <f.icon className="h-5 w-5 mx-auto text-primary-500 mb-1.5" />
                  <div className="text-xs font-bold text-dark-900">{f.label}</div>
                  <div className="text-[10px] text-dark-500">{f.sub}</div>
                </div>
              ))}
            </div>

            {/* Product Tabs */}
            <div className="mt-6">
              <div className="flex gap-1 p-1 rounded-xl bg-dark-50 border border-dark-100">
                {[
                  { key: "specs", label: "Specifications" },
                  { key: "features", label: "Features" },
                  { key: "shipping", label: "Shipping" },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key as any)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                      activeTab === t.key ? "bg-white text-dark-900 shadow-sm" : "text-dark-500"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 p-4 rounded-xl border border-dark-100 bg-white">
                {activeTab === "specs" && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-dark-50"><span className="text-dark-500">Material</span><span className="font-semibold text-dark-900">{product.materials.join(", ")}</span></div>
                    <div className="flex justify-between py-2 border-b border-dark-50"><span className="text-dark-500">Available Sizes</span><span className="font-semibold text-dark-900">{product.sizes.join(", ")}</span></div>
                    <div className="flex justify-between py-2 border-b border-dark-50"><span className="text-dark-500">MOQ</span><span className="font-semibold text-dark-900">{product.moq} {product.unit}s</span></div>
                    <div className="flex justify-between py-2"><span className="text-dark-500">Rating</span><span className="font-semibold text-dark-900">{product.rating}/5 ({product.reviews} reviews)</span></div>
                  </div>
                )}
                {activeTab === "features" && (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {product.features.map((f: string) => (
                      <div key={f} className="flex items-center gap-2 text-sm text-dark-700">
                        <Check className="h-4 w-4 text-emerald-500 shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === "shipping" && (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                      <Truck className="h-5 w-5 text-primary-500 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-dark-900">Standard Shipping: 5-10 business days</div>
                        <div className="text-dark-500">Free on orders over ₹250. Available worldwide to 180+ countries.</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Package className="h-5 w-5 text-primary-500 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-dark-900">Express Shipping: 2-3 business days</div>
                        <div className="text-dark-500">Available for ₹39.99. Priority manufacturing and air freight.</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <div className="mt-20">
            <SectionHeader eyebrow="You may also like" title="Related products" />
            <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-5">
              {related.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
