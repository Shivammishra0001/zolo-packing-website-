import { CampaignStrip } from "@/components/marketing/campaigns";
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
import { useCategoryTree } from "../lib/categories";
import { addToRfq } from "../lib/rfq-cart-store";
import { addToCart } from "../lib/cart-store";
import { useToast } from "../components/ui/Toast";
import { Button, SectionHeader } from "../components/UI";
import { ProductGrid } from "../components/ProductGrid";
import PackagingMockup from "../components/PackagingMockup";
import { ProductGallery } from "../components/product/ProductGallery";

const typeToMockup: Record<string, "mailer" | "shipping" | "pizza" | "cosmetic" | "pouch" | "jar" | "tube" | "rigid" | "tuck" | "bag"> = {
  print: "mailer", food: "pizza", pouches: "pouch", jars: "jar", tubes: "tube",
  cans: "rigid", cups: "tuck", apparel: "bag", device: "rigid", others: "shipping", tapes: "shipping",
};

export default function Details() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { isAuthenticated, authReady, openAuthModal } = useAuthSession();

  // Unified product source: the shared catalog store (admin + bulk-imported).
  const storeProduct = useBuyerProductBySlug(slug);
  const [product, setProduct] = useState<any | null>(storeProduct ?? null);
  const [loading, setLoading] = useState(!storeProduct);
  const { toggle, has } = useWishlist();
  const guard = useAuthGuard();
  const toast = useToast();
  const allProducts = useBuyerProducts(); // real catalog — for related products
  const categoryTree = useCategoryTree(allProducts);

  // BUSINESS RULE: guests may browse listings but NOT open a product page.
  // On a guest visit we open the ONE shared auth modal and stash a pending
  // action that re-opens THIS product after login — so the customer lands on
  // the product automatically without clicking it again. Then we bounce to the
  // listing so the guarded page never renders for a guest.
  useEffect(() => {
    // Wait for the session restore: a signed-in customer refreshing or
    // opening a shared product link must not be bounced to the listing (and
    // shown the login modal) while their token is still being refreshed.
    if (!authReady) return;
    if (!isAuthenticated && slug) {
      const target = `/product/${slug}`;
      openAuthModal({
        tab: "login",
        pendingAction: { label: "view this product", run: () => nav(target) },
      });
      nav("/products", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, isAuthenticated, slug]);

  // NOTE: every hook must be declared BEFORE any conditional return. The guest
  // early-return used to sit above the hooks below, so the moment a guest
  // logged in from the modal the hook count changed between renders and React
  // crashed with "Rendered more hooks than during the previous render".
  const [selectedSize, setSelectedSize] = useState(0);
  const [selectedMaterial, setSelectedMaterial] = useState(0);
  // VARIABLE products: the chosen value per option ({ Size: "8x8x6", Color: "White" }).
  const [selection, setSelection] = useState<Record<string, string>>({});
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
    // Default to the first purchasable variant so price/stock show at once.
    const first = storeProduct?.variants?.find((v) => (v.available ?? v.stock) > 0) ?? storeProduct?.variants?.[0];
    setSelection(first ? { ...first.attributes } : {});
    setArtwork(null);
    setArtworkName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, storeProduct]);

  // ---- variants: resolve the selected combination to ONE sellable unit ----
  type Variant = NonNullable<typeof storeProduct>["variants"][number];
  const variants: Variant[] = product?.variants ?? [];
  const isVariable = product?.kind === "variable" && variants.length > 0;
  const options: { name: string; values: string[] }[] = isVariable ? product.variantOptions : [];
  const matches = (v: Variant, sel: Record<string, string>) => options.every((o) => !sel[o.name] || v.attributes[o.name] === sel[o.name]);
  const selectedVariant = isVariable && options.every((o) => selection[o.name]) ? variants.find((v) => matches(v, selection)) ?? null : null;
  const complete = !isVariable || Boolean(selectedVariant);
  /** Is `value` for option `name` purchasable given the OTHER selections? */
  const valueAvailable = (name: string, value: string) => variants.some((v) => v.attributes[name] === value && matches(v, { ...selection, [name]: value }));
  const sellable = selectedVariant
    ? { sku: selectedVariant.sku, priceMinor: selectedVariant.priceMinor, compareAtMinor: selectedVariant.compareAtPriceMinor, moq: selectedVariant.moq, available: selectedVariant.available ?? selectedVariant.stock, image: selectedVariant.image, label: selectedVariant.label, weightGrams: selectedVariant.weightGrams, dims: selectedVariant.length ? `${selectedVariant.length}×${selectedVariant.width}×${selectedVariant.height} ${selectedVariant.dimUnit ?? ""}`.trim() : null, variantId: selectedVariant.id as string | null }
    : { sku: product?.sku ?? "", priceMinor: product?.priceMinor ?? 0, compareAtMinor: null as number | null, moq: product?.moq ?? 1, available: product && (product.inStock === false || product.stockStatus === "out_of_stock") ? 0 : null as number | null, image: null as string | null, label: null as string | null, weightGrams: null as number | null, dims: null as string | null, variantId: null as string | null };
  const outOfStock = product ? (isVariable ? (complete ? sellable.available === 0 : false) : (product.inStock === false || product.stockStatus === "out_of_stock")) : false;
  // Quotation-based (no fixed price): never show ₹0 / cart buttons —
  // the Request Custom Quote CTA below is the purchase path.
  const quoteOnly = complete && !sellable.priceMinor;

  useEffect(() => {
    if (product) {
      setQuantity(sellable.moq || 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, sellable.variantId]);

  // Guest guard — safe to return now that every hook above has run.
  if (!isAuthenticated) return null;

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
  const unitLabel = /s$/i.test(String(product.unit ?? "")) ? product.unit : `${product.unit}s`;
  // Related = same admin-managed category (by Category id, falling back to the
  // legacy name slug for rows without a link).
  const related = allProducts
    .filter((p) => p.slug !== product.slug && (product.categoryId ? p.categoryId === product.categoryId : p.category === product.category))
    .slice(0, 12);
  const mockupType = typeToMockup[product.category] || "mailer";
  const categoryNode = categoryTree.find((c) => c.dbId === product.categoryId);
  const subNode = categoryNode?.subcategories.find((sc) => sc.id === product.subcategoryId);

  // Share via the native share sheet where available; otherwise copy the link.
  const shareProduct = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied", "Product link copied to your clipboard.");
      }
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  };

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


  const handleAddToCart = () => {
    // Guarded: guests get the auth modal, then this resumes automatically.
    guard(
      async () => {
        // Combine the selected size/material chips into one variant descriptor.
        if (isVariable && !selectedVariant) { toast.error("Choose your options", "Select every option to add this product to your cart."); return; }
        const parts = [product.sizes?.[selectedSize], product.materials?.[selectedMaterial]].filter(Boolean);
        const variant = isVariable ? null : parts.length ? parts.join(" / ") : null;
        try {
          await addToCart({ productId: product._id || product.id, variantId: sellable.variantId, variant, quantity });
          toast.success("Added to cart", `${quantity} × ${product.name}${sellable.label ? ` (${sellable.label})` : ""}`);
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
        if (isVariable && !selectedVariant) { toast.error("Choose your options", "Select every option first."); return; }
        const parts = [product.sizes?.[selectedSize], product.materials?.[selectedMaterial]].filter(Boolean);
        const variant = isVariable ? null : parts.length ? parts.join(" / ") : null;
        try {
          await addToCart({ productId: product._id || product.id, variantId: sellable.variantId, variant, quantity });
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
    // resumes automatically after a successful login.
    guard(
      () => {
        // Adds to the RFQ cart rather than submitting immediately, so the buyer
        // can collect several products into ONE quotation request. Previously
        // this navigated to /contact with a prefilled message, which never
        // created an RFQ the admin could see.
        addToRfq({
          productId: product._id || product.id,
          productName: product.name,
          sku: sellable.sku,
          quantity,
          unit: product.unit,
          specs: {
            ...(isVariable ? selection : {}),
            size: isVariable ? sellable.label ?? "Default" : product.sizes[selectedSize] || "Default",
            material: product.materials[selectedMaterial] || "Default",
            ...(artworkName ? { artwork: artworkName } : {}),
          },
        });
        toast.success("Added to your quotation request", "Add more products, or review and send it.");
        nav("/rfq");
      },
      { label: "request a custom quote" },
    );
  };

  return (
    <main className="py-8">
      <div className="shell">
        {/* Admin-managed promotion (Marketing → Campaigns → Product Detail). */}
        <CampaignStrip placement="product_detail" className="mb-6" />
        {/* Breadcrumb */}
        <div className="mb-6 text-xs text-dark-500 flex items-center gap-1.5">
          <Link to="/" className="hover:text-dark-900">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/products" className="hover:text-dark-900">Products</Link>
          {/* Category / subcategory from the admin-managed tree (only while active). */}
          {categoryNode && (
            <>
              <ChevronRight className="h-3 w-3" />
              <Link to={`/category/${categoryNode.slug}`} className="hover:text-dark-900">{categoryNode.name}</Link>
            </>
          )}
          {categoryNode && subNode && (
            <>
              <ChevronRight className="h-3 w-3" />
              <Link to={`/category/${categoryNode.slug}/${subNode.pathSlug}`} className="hover:text-dark-900">{subNode.name}</Link>
            </>
          )}
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
            <ProductGallery
              key={sellable.image ?? "product"}
              images={sellable.image ? [sellable.image, ...(product.images ?? []).filter((u: string) => u !== sellable.image)] : (product.images ?? [])}
              name={product.name}
              fallback={<PackagingMockup type={mockupType} color={product.accent} className="w-full h-full drop-shadow-xl" />}
              overlay={
                <>
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
                </>
              }
            />

            {/* Save / Share row (below the gallery) */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => guard(() => toggle(product.id), { label: "save to wishlist" })}
                aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
                className="inline-flex items-center gap-2 rounded-full border border-dark-200 px-4 py-2 text-sm font-bold text-dark-700 transition hover:border-primary-400 hover:text-primary-600"
              >
                <Heart className={`h-4 w-4 ${wishlisted ? "fill-primary-500 text-primary-500" : ""}`} />
                {wishlisted ? "Saved" : "Save"}
              </button>
              <button
                onClick={shareProduct}
                aria-label="Share this product"
                className="inline-flex items-center gap-2 rounded-full border border-dark-200 px-4 py-2 text-sm font-bold text-dark-700 transition hover:border-primary-400 hover:text-primary-600"
              >
                <Share2 className="h-4 w-4" /> Share
              </button>
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

            {/* Rating (only when real review data exists) + honest stock state */}
            <div className="mt-3 flex items-center gap-4">
              {product.rating != null && (
                <>
                  <div className="flex items-center gap-1">
                    <div className="flex items-center gap-0.5 text-amber-400">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star key={i} className={`h-4 w-4 ${i <= Math.round(product.rating!) ? "fill-current" : "text-dark-200 fill-dark-200"}`} />
                      ))}
                    </div>
                    <span className="font-semibold text-sm">{product.rating}</span>
                    {product.reviews != null && (
                      <span className="text-dark-500 text-sm">({product.reviews.toLocaleString()})</span>
                    )}
                  </div>
                  <span className="h-4 w-px bg-dark-200" />
                </>
              )}
              {!complete ? (
                <span className="text-sm text-dark-500 font-semibold">Choose your options</span>
              ) : outOfStock ? (
                <span className="text-sm text-red-600 font-semibold flex items-center gap-1">Out of stock</span>
              ) : (
                <span className="text-sm text-emerald-600 font-semibold flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> In stock{sellable.available != null && sellable.available > 0 ? ` · ${sellable.available.toLocaleString("en-IN")} available` : ""}
                </span>
              )}
            </div>

            {/* Price + SKU for the selected variant (or the product) */}
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="sellable">
              {complete && sellable.priceMinor > 0 ? (
                <>
                  <span className="font-display text-2xl font-extrabold text-dark-900">₹{(sellable.priceMinor / 100).toLocaleString("en-IN")}</span>
                  {sellable.compareAtMinor && sellable.compareAtMinor > sellable.priceMinor && <span className="text-sm text-dark-400 line-through">₹{(sellable.compareAtMinor / 100).toLocaleString("en-IN")}</span>}
                  <span className="text-xs text-dark-500">per {product.unit}</span>
                </>
              ) : complete ? (
                <span className="text-sm font-bold text-primary-700">Price on quotation</span>
              ) : isVariable && product.priceMinor > 0 ? (
                <span className="text-sm text-dark-600">From <span className="font-bold text-dark-900">₹{(product.priceMinor / 100).toLocaleString("en-IN")}</span></span>
              ) : null}
              <span className="text-xs text-dark-400">SKU <span className="font-mono text-dark-600">{sellable.sku}</span></span>
            </div>

            {/* Description */}
            <div className="mt-6 p-4 rounded-2xl bg-dark-50 border border-dark-100">
              <div className="flex items-center gap-3">
                <div className="text-xs text-dark-500 font-semibold bg-white px-2.5 py-1 rounded-full border border-dark-200">
                  Minimum Order (MOQ): {sellable.moq} {unitLabel}
                </div>
                {sellable.weightGrams != null && sellable.weightGrams > 0 && <div className="text-xs text-dark-500 font-semibold bg-white px-2.5 py-1 rounded-full border border-dark-200">Weight: {sellable.weightGrams} g</div>}
                {sellable.dims && <div className="text-xs text-dark-500 font-semibold bg-white px-2.5 py-1 rounded-full border border-dark-200">Size: {sellable.dims}</div>}
              </div>
              <div className="mt-3 text-sm text-dark-700 leading-relaxed">{product.description}</div>
            </div>

            {/* ===== STEP-BY-STEP SELECTION ===== */}
            <div className="mt-6 space-y-6">

              {/* VARIABLE product: one step per option (Size, Color, Capacity…) — combinations
                  that are not sold are shown disabled, and the chosen combination resolves
                  to ONE variant with its own SKU / price / stock / MOQ / image. */}
              {isVariable && options.map((o, idx) => (
                <div key={o.name} className="p-5 rounded-2xl border border-dark-100 bg-white" data-option={o.name}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="h-6 w-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                    <div className="text-sm font-bold text-dark-900">Choose {o.name}</div>
                    <div className="ml-auto text-xs text-primary-600 font-semibold">{selection[o.name] ?? "—"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {o.values.map((value) => {
                      const on = selection[o.name] === value;
                      const ok = valueAvailable(o.name, value);
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setSelection((s) => ({ ...s, [o.name]: value }))}
                          data-available={ok}
                          className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${on && ok ? "bg-dark-900 text-white border-dark-900 shadow-md" : on ? "bg-red-50 text-red-700 border-dashed border-red-300" : ok ? "bg-white text-dark-700 border-dark-200 hover:border-dark-400" : "bg-white text-dark-400 border-dashed border-dark-200"}`}
                          title={ok ? undefined : "Not available with the other selected options"}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* STEP 1: Choose Size (simple products) */}
              {!isVariable && <div className="p-5 rounded-2xl border border-dark-100 bg-white">
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
              </div>}

              {/* STEP 2: Choose Material (simple products) */}
              {!isVariable && <div className="p-5 rounded-2xl border border-dark-100 bg-white">
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
              </div>}

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
                <span className="text-xs text-dark-400">{isVariable ? sellable.label ?? "Choose options" : `${product.sizes[selectedSize]} · ${product.materials[selectedMaterial]}`}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs text-dark-400">Selected Quantity</div>
                  <div className="font-display text-2xl font-extrabold grad-text">{quantity} {unitLabel}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-dark-400">Ships in</div>
                  <div className="text-sm font-bold text-emerald-400">5-10 days</div>
                </div>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="mt-6 space-y-3">
              {!complete ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-800" data-testid="incomplete">
                  This combination is not available — choose another {options.map((o) => o.name.toLowerCase()).join(" or ")}.
                </div>
              ) : outOfStock ? (
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
                    <div className="flex justify-between py-2"><span className="text-dark-500">MOQ</span><span className="font-semibold text-dark-900">{product.moq} {unitLabel}</span></div>
                    {product.rating != null && (
                      <div className="flex justify-between py-2"><span className="text-dark-500">Rating</span><span className="font-semibold text-dark-900">{product.rating}/5 ({product.reviews ?? 0} reviews)</span></div>
                    )}
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
            <ProductGrid products={related} maxRows={1} className="mt-8" />
          </div>
        )}
      </div>
    </main>
  );
}
