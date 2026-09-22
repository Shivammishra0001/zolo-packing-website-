import { CampaignStrip } from "@/components/marketing/campaigns";
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  X,
  Quote,
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
import { Badge, Breadcrumb, Button, ButtonLink, EmptyState, SectionHeader, cx } from "../components/UI";
import { ProductGrid } from "../components/ProductGrid";
import PackagingMockup from "../components/PackagingMockup";
import { ProductGallery } from "../components/product/ProductGallery";

const typeToMockup: Record<string, "mailer" | "shipping" | "pizza" | "cosmetic" | "pouch" | "jar" | "tube" | "rigid" | "tuck" | "bag"> = {
  print: "mailer", food: "pizza", pouches: "pouch", jars: "jar", tubes: "tube",
  cans: "rigid", cups: "tuck", apparel: "bag", device: "rigid", others: "shipping", tapes: "shipping",
};

const inr = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Option chip group (sizes / colours). Keeps the data-option hook + "Selected:" label. */
function OptionGroup({
  option,
  title,
  values,
  selected,
  onSelect,
}: {
  option: "size" | "color";
  title: string;
  values: string[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div data-option={option}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-dark-900">{title}</div>
        <div className="truncate text-xs font-semibold text-green-600">Selected: {values[selected]}</div>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={title}>
        {values.map((v, i) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={selected === i}
            onClick={() => onSelect(i)}
            className={cx("chip", selected === i && "chip-active")}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const [selectedColor, setSelectedColor] = useState(0);
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
    setSelectedColor(0);
    setArtwork(null);
    setArtworkName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, storeProduct]);

  useEffect(() => {
    if (product) {
      setQuantity(product.moq || 100);
    }
  }, [product]);

  // Guest guard — safe to return now that every hook above has run.
  if (!isAuthenticated) return null;

  if (loading) {
    return (
      <main className="section-sm">
        <div className="shell">
          <div className="skeleton mb-4 h-3 w-48" />
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]" aria-busy="true" aria-label="Loading product">
            <div className="skeleton aspect-square w-full rounded-[12px]" />
            <div className="space-y-3">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-8 w-4/5" />
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton h-16 w-full" />
              <div className="skeleton h-28 w-full" />
              <div className="skeleton h-11 w-full" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="section-sm">
        <div className="shell">
          <EmptyState
            title="Product not found"
            message="This product may have been removed or its link has changed."
            action={<ButtonLink to="/products" variant="outline">Back to products</ButtonLink>}
          />
        </div>
      </main>
    );
  }

  const wishlisted = has(product._id || product.id);
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

  const outOfStock = product.inStock === false || product.stockStatus === "out_of_stock";
  // Quotation-based product (no fixed price): never show ₹0 / cart buttons —
  // the Request Quote CTA is the purchase path.
  const quoteOnly = !product.priceMinor;
  const priceMinor: number = product.priceMinor || 0;
  const totalMinor = priceMinor * quantity;

  // Everything the buyer has picked, in one label ("8x8x6 in / White").
  const selectionLabel = [product.sizes[selectedSize], product.colors[selectedColor]].filter(Boolean).join(" / ");
  const hasSizes = product.sizes.length > 0;
  const hasColors = product.colors.length > 0;

  // Spec rows are derived from the material chips (thickness / material / GSM)
  // so the table only shows facts the admin actually entered.
  const materials: string[] = product.materials ?? [];
  const gsm: string | undefined = product.gsm ? `${product.gsm} GSM` : materials.find((m) => /gsm/i.test(m));
  const thickness: string | undefined =
    product.thickness ?? materials.find((m) => m !== gsm && /\b(ply|mm|micron|mic|gauge|thick)/i.test(m));
  const materialLabel: string | undefined =
    product.material ?? (materials.filter((m) => m !== gsm && m !== thickness).join(", ") || undefined);
  const specRows = [
    materialLabel ? { label: "Material", value: materialLabel } : null,
    gsm ? { label: "GSM", value: gsm } : null,
    thickness ? { label: "Thickness", value: thickness } : null,
    { label: "MOQ", value: `${product.moq.toLocaleString("en-IN")} ${product.unit}s` },
  ].filter((r): r is { label: string; value: string } => r !== null);

  const handleAddToCart = () => {
    // Guarded: guests get the auth modal, then this resumes automatically.
    guard(
      async () => {
        // The chosen size/colour travel as the existing free-text cart
        // descriptor. They are product-level options, not priced variants.
        const variant = selectionLabel || null;
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
        const variant = selectionLabel || null;
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
          sku: product.sku,
          quantity,
          unit: product.unit,
          specs: {
            size: product.sizes[selectedSize] || "Default",
            ...(product.colors[selectedColor] ? { color: product.colors[selectedColor] } : {}),
            material: product.materials.join(", ") || "Default",
            ...(artworkName ? { artwork: artworkName } : {}),
          },
        });
        toast.success("Added to your quotation request", "Add more products, or review and send it.");
        nav("/rfq");
      },
      { label: "request a custom quote" },
    );
  };

  const breadcrumbItems = [
    { label: "Home", to: "/" },
    { label: "Products", to: "/products" },
    // Category / subcategory from the admin-managed tree (only while active).
    ...(categoryNode ? [{ label: categoryNode.name, to: `/category/${categoryNode.slug}` }] : []),
    ...(categoryNode && subNode ? [{ label: subNode.name, to: `/category/${categoryNode.slug}/${subNode.pathSlug}` }] : []),
    { label: product.name },
  ];

  const TABS = [
    { key: "specs", label: "Specifications" },
    { key: "features", label: "Features" },
    { key: "shipping", label: "Shipping" },
  ] as const;

  return (
    <main className="section-sm">
      <div className="shell">
        {/* Admin-managed promotion (Marketing → Campaigns → Product Detail). */}
        <CampaignStrip placement="product_detail" className="mb-6" />
        <Breadcrumb items={breadcrumbItems} className="mb-4" />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* LEFT: gallery */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-w-0">
            <ProductGallery
              images={product.images ?? []}
              name={product.name}
              fallback={<PackagingMockup type={mockupType} color={product.accent} className="h-full w-full" />}
              overlay={
                <>
                  {artwork && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <img src={artwork} alt="artwork" className="max-h-32 max-w-32 rounded-lg object-contain opacity-80 shadow-md" />
                    </div>
                  )}
                  <div className="absolute left-3 top-3 flex gap-1.5">
                    {product.bestseller && (
                      <span className="badge bg-primary-500 text-white shadow-sm"><Zap className="h-2.5 w-2.5" aria-hidden /> Bestseller</span>
                    )}
                    {product.newArrival && <span className="badge bg-green-500 text-white shadow-sm">New</span>}
                  </div>
                </>
              }
            />

            {/* Save / Share row (below the gallery) */}
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => guard(() => toggle(product.id), { label: "save to wishlist" })}
                aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
                aria-pressed={wishlisted}
              >
                <Heart className={cx("h-4 w-4", wishlisted && "fill-green-500 text-green-500")} aria-hidden />
                {wishlisted ? "Saved" : "Save"}
              </Button>
              <Button variant="outline" size="sm" onClick={shareProduct} aria-label="Share this product" icon={Share2}>
                Share
              </Button>
            </div>
          </motion.div>

          {/* RIGHT: product configuration */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }} className="min-w-0">
            {product.specTag && <p className="eyebrow mb-2">{product.specTag}</p>}
            <h1 className="h2 text-dark-900">{product.name}</h1>

            {/* SKU + stock + (real) rating */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              {product.sku && <span className="text-dark-500">SKU <span className="font-semibold text-dark-700">{product.sku}</span></span>}
              {outOfStock ? (
                <Badge tone="red">Out of stock</Badge>
              ) : (
                <Badge tone="green"><Check className="h-3 w-3" aria-hidden /> In stock</Badge>
              )}
              {quoteOnly && <Badge tone="neutral">Quote based</Badge>}
              {product.rating != null && (
                <span className="flex items-center gap-1">
                  <span className="flex items-center gap-0.5 text-amber-400">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className={cx("h-3.5 w-3.5", i <= Math.round(product.rating!) ? "fill-current" : "fill-dark-200 text-dark-200")} aria-hidden />
                    ))}
                  </span>
                  <span className="text-sm font-semibold">{product.rating}</span>
                  {product.reviews != null && <span className="text-sm text-dark-500">({product.reviews.toLocaleString()})</span>}
                </span>
              )}
            </div>

            {/* Short description */}
            <p className="mt-4 text-sm leading-relaxed text-dark-600">{product.description}</p>

            {/* Options: sizes / colours — product-level info, one price, one stock. */}
            {(hasSizes || hasColors) && (
              <div className="card-flat mt-5 space-y-4 p-4">
                {hasSizes && (
                  <OptionGroup option="size" title="Available Sizes" values={product.sizes} selected={selectedSize} onSelect={setSelectedSize} />
                )}
                {hasColors && (
                  <OptionGroup option="color" title="Available Colors" values={product.colors} selected={selectedColor} onSelect={setSelectedColor} />
                )}
              </div>
            )}

            {/* Spec table */}
            <dl className="card-flat mt-4 divide-y divide-dark-100 px-4">
              {specRows.map((r) => (
                <div key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-3 py-2.5 text-sm">
                  <dt className="text-dark-500">{r.label}</dt>
                  <dd className="min-w-0 break-words font-semibold text-dark-900">{r.value}</dd>
                </div>
              ))}
            </dl>

            {/* Quantity + price line */}
            <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="label mb-1.5">Quantity <span className="font-normal text-dark-500">(min {product.moq.toLocaleString("en-IN")})</span></div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex h-11 items-center overflow-hidden rounded-[10px] border border-dark-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(product.moq, quantity - 50))}
                      aria-label="Decrease quantity"
                      className="flex h-full w-10 items-center justify-center text-dark-600 hover:bg-dark-50"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                    <input
                      type="number"
                      min={product.moq}
                      value={quantity}
                      aria-label="Quantity"
                      onChange={(e) => setQuantity(Math.max(product.moq, +e.target.value))}
                      className="h-full w-20 border-x border-dark-200 text-center text-sm font-semibold tabular-nums text-dark-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(quantity + 50)}
                      aria-label="Increase quantity"
                      className="flex h-full w-10 items-center justify-center text-dark-600 hover:bg-dark-50"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[product.moq, product.moq * 2, product.moq * 5, product.moq * 10].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuantity(q)}
                        aria-pressed={quantity === q}
                        className={cx("chip h-8 px-2.5 text-xs", quantity === q && "chip-active")}
                      >
                        {q >= 1000 ? `${q / 1000}K` : q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-right">
                {quoteOnly ? (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wider text-dark-500">Pricing</div>
                    <div className="font-display text-lg font-bold text-dark-900">On request</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wider text-dark-500">Price per {product.unit}</div>
                    <div className="font-display text-2xl font-bold leading-none text-dark-900">{inr(priceMinor)}</div>
                  </>
                )}
              </div>
            </div>

            {/* CTA row — orange only on the one conversion action. */}
            <div className="mt-5 space-y-3">
              {outOfStock && !quoteOnly && (
                <p className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
                  Out of stock — Add to Cart and Buy Now are unavailable. You can still request a quote.
                </p>
              )}
              {quoteOnly || outOfStock ? (
                <Button onClick={handleRequestQuote} className="w-full" icon={Quote}>
                  Request Quote
                </Button>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={handleAddToCart} className="w-full sm:flex-1" icon={ShoppingCart}>
                    Add to Cart
                  </Button>
                  <Button onClick={handleBuyNow} variant="navy" className="w-full sm:w-auto">
                    Buy Now
                  </Button>
                  <Button onClick={handleRequestQuote} variant="secondary" className="w-full sm:w-auto" icon={Quote}>
                    Request Quote
                  </Button>
                </div>
              )}
            </div>

            {/* Artwork dropzone (optional) */}
            <label className="card-flat mt-4 flex cursor-pointer items-center gap-3 border-dashed p-3 transition-colors hover:border-green-500">
              {artwork ? (
                <>
                  <img src={artwork} className="h-10 w-10 rounded-lg object-cover" alt="" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-dark-900">{artworkName}</div>
                    <div className="text-xs text-dark-500">Artwork attached</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setArtwork(null); setArtworkName(""); }}
                    aria-label="Remove artwork"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-dark-400 hover:bg-dark-50 hover:text-red-600"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-600">
                    <Upload className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-dark-900">Upload artwork <span className="font-normal text-dark-500">(optional)</span></div>
                    <div className="text-xs text-dark-500">PNG, JPG, AI, PDF · Max 10MB</div>
                  </div>
                  <span className="text-xs font-bold text-green-600">Browse</span>
                </>
              )}
              <input type="file" accept="image/*,.pdf,.ai" className="hidden" onChange={handleArtwork} />
            </label>

            {/* Selection summary */}
            <div className="mt-4 rounded-[12px] bg-navy-900 p-4 text-white">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <span className="text-dark-300">Selection</span>
                <span className="font-semibold">{selectionLabel || product.materials.join(" · ") || "Standard"}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
                <span className="text-dark-300">Quantity</span>
                <span className="font-semibold tabular-nums">{quantity.toLocaleString("en-IN")} {product.unit}s</span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-white/10 pt-2">
                <span className="text-sm text-dark-300">Total</span>
                <span className="font-display text-xl font-bold tabular-nums">{quoteOnly ? "Quote on request" : inr(totalMinor)}</span>
              </div>
            </div>

            {/* Trust items */}
            <ul className="mt-4 grid grid-cols-3 gap-2">
              {[
                { icon: Truck, label: "Free shipping", sub: "Orders ₹250+" },
                { icon: ShieldCheck, label: "ISO certified", sub: "Quality checked" },
                { icon: RefreshCw, label: "30-day returns", sub: "Hassle-free" },
              ].map((f) => (
                <li key={f.label} className="flex min-w-0 items-center gap-2">
                  <f.icon className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-dark-900">{f.label}</div>
                    <div className="truncate text-[11px] text-dark-500">{f.sub}</div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Tabs */}
            <div className="mt-6">
              <div role="tablist" aria-label="Product information" className="flex flex-wrap gap-1 border-b border-dark-200">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    type="button"
                    aria-selected={activeTab === t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={cx(
                      "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors duration-150",
                      activeTab === t.key ? "border-green-500 text-green-700" : "border-transparent text-dark-500 hover:text-dark-900",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="card-flat mt-3 p-4" role="tabpanel">
                {activeTab === "specs" && (
                  <dl className="divide-y divide-dark-100 text-sm">
                    {product.materials.length > 0 && (
                      <div className="flex justify-between gap-4 py-2"><dt className="text-dark-500">Material</dt><dd className="text-right font-semibold text-dark-900">{product.materials.join(", ")}</dd></div>
                    )}
                    {hasSizes && (
                      <div className="flex justify-between gap-4 py-2"><dt className="text-dark-500">Available Sizes</dt><dd className="text-right font-semibold text-dark-900">{product.sizes.join(", ")}</dd></div>
                    )}
                    {hasColors && (
                      <div className="flex justify-between gap-4 py-2"><dt className="text-dark-500">Available Colors</dt><dd className="text-right font-semibold text-dark-900">{product.colors.join(", ")}</dd></div>
                    )}
                    <div className="flex justify-between gap-4 py-2"><dt className="text-dark-500">MOQ</dt><dd className="font-semibold text-dark-900">{product.moq} {product.unit}s</dd></div>
                    {product.rating != null && (
                      <div className="flex justify-between gap-4 py-2"><dt className="text-dark-500">Rating</dt><dd className="font-semibold text-dark-900">{product.rating}/5 ({product.reviews ?? 0} reviews)</dd></div>
                    )}
                  </dl>
                )}
                {activeTab === "features" && (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {product.features.map((f: string) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-dark-700">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" aria-hidden /> {f}
                      </li>
                    ))}
                  </ul>
                )}
                {activeTab === "shipping" && (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                      <Truck className="mt-0.5 h-5 w-5 shrink-0 text-green-500" aria-hidden />
                      <div>
                        <div className="font-bold text-dark-900">Standard Shipping: 5-10 business days</div>
                        <div className="text-dark-500">Free on orders over ₹250. Available worldwide to 180+ countries.</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Package className="mt-0.5 h-5 w-5 shrink-0 text-green-500" aria-hidden />
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
          <section className="section">
            <SectionHeader eyebrow="You may also like" title="Related products" />
            <ProductGrid products={related} maxRows={1} className="mt-6" />
          </section>
        )}
      </div>
    </main>
  );
}
