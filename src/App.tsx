import { useState, useEffect, useMemo, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, useLocation, useSearchParams, useNavigate, Navigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  Heart,
  User,
  Menu,
  X,
  Globe2,
  Truck,
  Send,
  MessageCircle,
  Mail,
  Phone,
  Quote,
  Leaf,
  ShoppingCart,
  Store,
  ChevronDown,
} from "lucide-react";
import type { Product } from "./data/products";
import logoImg from "../images/logo.jpg";
import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider, useAuthSession } from "./components/auth/AuthContext";
import * as authService from "./lib/auth/service";
import { homeRouteForRole } from "./lib/auth/types";
import { useCart as useServerCart } from "./lib/cart-store";
import { useBuyerProducts } from "./lib/products";
import { useCategoryTree } from "./lib/categories";

// ---------- Types ----------
export type CartLine = {
  productId: string;
  name: string;
  image: string;
  emoji: string;
  accent: string;
  price: number;
  color: string;
  size: string;
  material: string;
  quantity: number;
};

export type WishlistItem = { productId: string };

export type AuthState = {
  loggedIn: boolean;
  user?: { name: string; email: string; avatar: string };
};

// ---------- Contexts ----------
const CartCtx = createContext<{
  lines: CartLine[];
  add: (line: CartLine) => void;
  remove: (key: string) => void;
  updateQty: (key: string, qty: number) => void;
  clear: () => void;
  total: number;
  count: number;
}>({} as any);
export const useCart = () => useContext(CartCtx);
export const lineKey = (l: CartLine) => `${l.productId}|${l.color}|${l.size}|${l.material}`;

const WishCtx = createContext<{
  items: WishlistItem[];
  toggle: (id: string) => void;
  has: (id: string) => boolean;
}>({ items: [], toggle: () => {}, has: () => false });
export const useWishlist = () => useContext(WishCtx);

const AuthCtx = createContext<{
  auth: AuthState;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => void;
  register: (name: string, email: string, password?: string) => Promise<void>;
}>({ auth: { loggedIn: false }, login: async () => {}, logout: () => {}, register: async () => {} });
export const useAuth = () => useContext(AuthCtx);

// ---------- Top Bar ----------
function TopBar() {
  return (
    <div className="bg-dark-950 text-white text-xs">
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-primary-400" /> Free shipping on orders over ₹10000
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/order-tracking" className="hover:text-primary-400 transition-colors">Track Order</Link>
          <span className="hidden md:inline text-dark-600">|</span>
          <Link to="/contact" className="hidden md:inline hover:text-primary-400 transition-colors">Get Quote</Link>
          <span className="hidden md:inline text-dark-600">|</span>
          <button className="flex items-center gap-1 hover:text-primary-400 transition-colors">
            <Globe2 className="h-3.5 w-3.5" /> EN
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Navbar ----------
function Navbar() {
  const { items } = useWishlist();
  const { auth } = useAuth();
  // Real server-backed cart (lib/cart-store), NOT the legacy CartCtx below.
  // Summing quantities means the badge shows total units, matching the cart page.
  const cartLines = useServerCart();
  const cartCount = cartLines.reduce((n, l) => n + (l.quantity ?? 0), 0);
  // Category menu — built from the live catalog, never a hardcoded list.
  const shopCategories = useCategoryTree(useBuyerProducts());
  const [shopMenu, setShopMenu] = useState(false);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [searchVal, setSearchVal] = useState("");
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [sellerMenu, setSellerMenu] = useState(false);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const searchParam = searchParams.get("search") || "";
  const { pathname } = useLocation();

  // Transparent navbar overlays the dark hero on the home page while at the top;
  // it turns solid white once scrolled past the hero. On other pages (light
  // backgrounds) it stays solid so text/icons remain readable.
  const overHero = pathname === "/" && !scrolled;

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  useEffect(() => {
    setSearchVal(searchParam);
  }, [searchParam]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowMobileSearch(false);
    if (searchVal.trim()) {
      nav(`/products?search=${encodeURIComponent(searchVal.trim())}`);
    } else {
      nav("/products");
    }
  };

  const links = [
    { to: "/", label: "Home" },
    { to: "/products", label: "Products" },
    { to: "/categories", label: "Categories" },
    { to: "/eco-rewards", label: "Eco Rewards" },
    { to: "/contact", label: "Contact" },
  ];

  return (
    <header
      className={`sticky top-0 z-40 transition-all duration-300 ${
        overHero
          ? "bg-dark-950/60 backdrop-blur-xl backdrop-saturate-150 border-b border-white/10"
          : "bg-white/80 backdrop-blur-xl backdrop-saturate-150 border-b border-dark-100"
      } ${scrolled ? "shadow-md" : ""}`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center gap-4">
        {showMobileSearch ? (
          <form onSubmit={handleSearchSubmit} className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dark-400" />
              <input
                type="text"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                placeholder="Search packaging products..."
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 rounded-full border border-dark-200 bg-dark-50 text-sm focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
              />
            </div>
            <button
              type="button"
              onClick={() => { setShowMobileSearch(false); setSearchVal(""); }}
              className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-dark-50 text-dark-500 shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </form>
        ) : (
          <>
            <Link to="/" className={`flex items-center gap-2 shrink-0 rounded-xl transition-colors px-1.5 py-1 ${overHero ? "hover:bg-white/10" : "hover:bg-dark-50/80"}`}>
              <div className="flex items-center justify-center overflow-hidden shrink-0">
                <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl overflow-hidden flex items-center justify-center bg-white">
                  <img src={logoImg} alt="Zolo Packing Logo" className="h-full w-full object-cover" />
                </div>
              </div>
              <div className="leading-none">
                <div className={`font-display font-extrabold text-lg tracking-tight ${overHero ? "text-white" : "text-dark-900"}`}>
                  Zolo<span className={overHero ? "text-primary-400" : "grad-text"}> Packing</span>
                </div>
                <div className={`text-[9px] uppercase tracking-[0.18em] mt-0.5 ${overHero ? "text-white/70" : "text-dark-500"}`}>
                  Premium Packaging
                </div>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-0.5 ml-6">
              {/* Shop — category dropdown sourced from the live catalog. */}
              <div className="relative">
                <button
                  onClick={() => setShopMenu((v) => !v)}
                  onBlur={() => setTimeout(() => setShopMenu(false), 160)}
                  aria-haspopup="true"
                  aria-expanded={shopMenu}
                  className={`relative inline-flex items-center gap-1 px-3.5 py-2 text-sm font-medium rounded-lg transition-colors ${
                    overHero ? "text-white/70 hover:text-white" : "text-dark-500 hover:text-dark-900"
                  }`}
                >
                  Shop
                  <ChevronDown className={`h-3 w-3 transition-transform ${shopMenu ? "rotate-180" : ""}`} aria-hidden />
                </button>
                <AnimatePresence>
                  {shopMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-dark-100 bg-white p-2 shadow-xl z-50 max-h-96 overflow-y-auto"
                    >
                      <Link to="/products" className="block rounded-lg px-3 py-2 text-sm font-semibold text-dark-900 hover:bg-dark-50">
                        Shop All
                      </Link>
                      <div className="my-1 border-t border-dark-100" />
                      {shopCategories.map((c) => (
                        <Link
                          key={c.slug}
                          to={`/products?category=${c.slug}`}
                          className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-dark-600 hover:bg-dark-50 hover:text-dark-900"
                        >
                          <span>{c.icon} {c.name}</span>
                          <span className="text-xs text-dark-400 tabular-nums">{c.count}</span>
                        </Link>
                      ))}
                      {shopCategories.length === 0 && (
                        <p className="px-3 py-2 text-xs text-dark-400">No categories yet.</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === "/"}
                  className={({ isActive }) =>
                    `relative px-3.5 py-2 text-sm font-medium transition-colors rounded-lg ${
                      overHero
                        ? isActive ? "text-white" : "text-white/70 hover:text-white"
                        : isActive ? "text-dark-900" : "text-dark-500 hover:text-dark-900"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="nav-pill"
                          className={`absolute inset-0 rounded-lg ${overHero ? "bg-white/15" : "bg-dark-50"}`}
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{l.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md mx-auto hidden md:block">
              <div className="relative">
                <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 ${overHero ? "text-white/60" : "text-dark-400"}`} />
                <input
                  type="text"
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  placeholder="Search packaging..."
                  className={`w-full pl-10 pr-4 py-2.5 rounded-full border text-sm outline-none transition-all ${
                    overHero
                      ? "border-white/25 bg-white/10 text-white placeholder-white/60 focus:bg-white/20 focus:border-white/50"
                      : "border-dark-200 bg-dark-50 focus:bg-white focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                  }`}
                />
              </div>
            </form>

            <div className="flex items-center gap-1 sm:gap-2 ml-auto">
              {/* Seller entry — login or register as a supplier */}
              <div className="relative hidden lg:block">
                <button
                  onClick={() => setSellerMenu((v) => !v)}
                  onBlur={() => setTimeout(() => setSellerMenu(false), 150)}
                  aria-haspopup="true"
                  aria-expanded={sellerMenu}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${
                    overHero
                      ? "text-white/90 hover:bg-white/10 border border-white/25"
                      : "text-dark-700 hover:bg-dark-50 border border-dark-200"
                  }`}
                >
                  <Store className="h-3.5 w-3.5" /> Sell on Zolo
                  <ChevronDown className={`h-3 w-3 transition-transform ${sellerMenu ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {sellerMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-60 rounded-2xl border border-dark-100 bg-white p-2 shadow-xl z-50"
                    >
                      <Link
                        to="/seller/login"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setSellerMenu(false)}
                        className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-dark-50 transition-colors"
                      >
                        <User className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" />
                        <span>
                          <span className="block text-sm font-bold text-dark-900">Seller Login</span>
                          <span className="block text-xs text-dark-500">Access your supplier dashboard</span>
                        </span>
                      </Link>
                      <Link
                        to="/seller/login?tab=register"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setSellerMenu(false)}
                        className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-dark-50 transition-colors"
                      >
                        <Store className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" />
                        <span>
                          <span className="block text-sm font-bold text-dark-900">Become a Supplier</span>
                          <span className="block text-xs text-dark-500">Register your business to sell</span>
                        </span>
                      </Link>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <Link to="/contact" className="hidden lg:inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary-500 text-white text-xs font-bold hover:bg-primary-600 transition-colors shadow-sm shadow-primary-500/30 btn-glow">
                <Quote className="h-3.5 w-3.5" /> Get Quote
              </Link>
              <button
                onClick={() => setShowMobileSearch(true)}
                className={`md:hidden h-9 w-9 flex items-center justify-center rounded-full ${overHero ? "text-white hover:bg-white/10" : "text-dark-600 hover:bg-dark-50"}`}
              >
                <Search className="h-4 w-4" />
              </button>
              <Link to="/account/dashboard" className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-full relative ${overHero ? "hover:bg-white/10" : "hover:bg-dark-50"}`}>
                {auth.loggedIn ? (
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary-500 to-amber-400 text-white text-xs font-bold flex items-center justify-center">
                    {auth.user?.avatar}
                  </div>
                ) : (
                  <User className={`h-4 w-4 ${overHero ? "text-white" : "text-dark-600"}`} />
                )}
              </Link>
              <Link to="/account/dashboard" className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-full relative ${overHero ? "hover:bg-white/10" : "hover:bg-dark-50"}`}>
                <Heart className={`h-4 w-4 ${overHero ? "text-white" : "text-dark-600"}`} />
                {items.length > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary-500 text-[10px] font-bold text-white">
                    {items.length}
                  </span>
                )}
              </Link>
              {/* Cart — count comes from the real server-backed cart store, so
                  it stays in sync across listing, detail, cart page and header. */}
              <Link
                to="/cart"
                aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}` : "Cart, empty"}
                className={`flex h-9 w-9 items-center justify-center rounded-full relative ${overHero ? "hover:bg-white/10" : "hover:bg-dark-50"}`}
              >
                <ShoppingCart className={`h-4 w-4 ${overHero ? "text-white" : "text-dark-600"}`} />
                {cartCount > 0 && (
                  <span className="absolute top-1 right-1 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-primary-500 text-[10px] font-bold text-white tabular-nums">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </Link>
              <button
                onClick={() => setOpen(!open)}
                className={`lg:hidden h-9 w-9 flex items-center justify-center rounded-full ${overHero ? "text-white hover:bg-white/10" : "hover:bg-dark-50"}`}
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="lg:hidden overflow-hidden border-t border-dark-100"
          >
            <div className="px-4 py-3 space-y-1">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block px-3 py-2.5 rounded-lg text-sm font-medium ${
                      isActive ? "bg-dark-50 text-dark-900" : "text-dark-600"
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
              <Link
                to="/contact"
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 rounded-lg text-sm font-bold text-primary-600"
              >
                Get Custom Quote →
              </Link>

              {/* Seller options */}
              <div className="mt-2 pt-2 border-t border-dark-100">
                <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-dark-400">For Suppliers</div>
                <Link
                  to="/seller/login"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-dark-700"
                >
                  <User className="h-4 w-4 text-primary-600" /> Seller Login
                </Link>
                <Link
                  to="/seller/login?tab=register"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-dark-700"
                >
                  <Store className="h-4 w-4 text-primary-600" /> Become a Supplier
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

// ---------- Footer ----------
function Footer() {
  const cols = [
    {
      title: "Products",
      items: [
        { label: "All Products", to: "/products" },
        { label: "Categories", to: "/categories" },
        { label: "Bestsellers", to: "/products?sort=bestseller" },
        { label: "New Arrivals", to: "/products?sort=new" },
        { label: "Custom Printing", to: "/contact" },
        { label: "Eco Products", to: "/products?search=eco" },
      ],
    },
    {
      title: "Support",
      items: [
        { label: "Contact us", to: "/contact" },
        { label: "Track order", to: "/order-tracking" },
        { label: "Shipping info", to: "/contact" },
        { label: "Returns", to: "/contact" },
        { label: "Request Quote", to: "/contact" },
        { label: "Eco Rewards", to: "/eco-rewards" },
      ],
    },
    {
      title: "Company",
      items: [
        { label: "About Us", to: "/contact" },
        { label: "Sustainability", to: "/sustainability" },
        { label: "Recycling Program", to: "/sustainability#recycling" },
        { label: "Manufacturing", to: "/contact" },
        { label: "Careers", to: "/contact" },
      ],
    },
  ];

  return (
    <footer className="bg-dark-950 text-white">
      {/* Pre-footer CTA */}
      <div className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-primary-400" />
              <div>
                <div className="text-xs text-dark-400 uppercase tracking-wider">Call us</div>
                <div className="font-bold text-sm">+91 9582712626</div>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-3">
              <Mail className="h-5 w-5 text-primary-400" />
              <div>
                <div className="text-xs text-dark-400 uppercase tracking-wider">Email</div>
                <div className="font-bold text-sm">contact@zolopacking.com</div>
              </div>
            </div>
          </div>
          <Link to="/contact" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary-500 text-white text-sm font-bold hover:bg-primary-600 transition-colors shadow-lg shadow-primary-500/30">
            <Quote className="h-4 w-4" /> Request Free Quote
          </Link>
          <Link to="/eco-rewards" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 text-white text-sm font-bold hover:bg-white/15 transition-colors border border-white/10">
            <Leaf className="h-4 w-4" /> Eco Rewards
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-14">
        <div className="grid gap-10 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-10 w-10 rounded-xl overflow-hidden flex items-center justify-center bg-white">
                <img src={logoImg} alt="Zolo Packing Logo" className="h-full w-full object-cover" />
              </div>
              <div className="font-display text-xl font-extrabold text-white">
                Zolo<span className="grad-text"> Packing</span>
              </div>
            </div>
            <p className="text-sm text-dark-400 max-w-sm leading-relaxed">
              India's leading packaging manufacturer. Premium quality custom boxes,
              pouches, and packaging solutions for brands worldwide.
            </p>
            <div className="mt-5 flex gap-3">
              {[Send, MessageCircle, Mail, Phone].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="h-9 w-9 rounded-full bg-white/5 border border-white/10 hover:bg-primary-500 hover:border-primary-500 flex items-center justify-center transition-colors"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="font-display font-bold mb-4 text-sm">{c.title}</div>
              <ul className="space-y-2.5 text-sm">
                {c.items.map((it) => (
                  <li key={it.label}>
                    <Link to={it.to} className="text-dark-400 hover:text-white transition-colors">
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 grid gap-4 md:grid-cols-3 items-center">
          <div className="text-xs text-dark-500">
            © 2026 Zolo Packing Inc. All rights reserved.
          </div>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-dark-500">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Cookies</a>
          </div>
          <div className="flex justify-end gap-3 text-dark-500 text-[10px] uppercase tracking-wider">
            <span>Visa</span>
            <span>Mastercard</span>
            <span>Amex</span>
            <span>PayPal</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ---------- ScrollToTop ----------
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as any });
  }, [pathname]);
  return null;
}

// ---------- WhatsApp ----------
function WhatsAppButton() {
  return (
    <a
      href="#"
      className="fixed bottom-6 right-6 z-30 group"
      title="Chat on WhatsApp"
    >
      <div className="relative">
        <div className="h-14 w-14 rounded-full bg-[#25D366] shadow-lg shadow-[#25D366]/40 flex items-center justify-center hover:scale-110 transition-transform">
          <MessageCircle className="h-6 w-6 text-white" />
        </div>
        <div className="absolute -top-12 right-0 hidden group-hover:block">
          <div className="bg-dark-900 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
            Need packaging help? Chat now!
          </div>
        </div>
      </div>
    </a>
  );
}

// ---------- App ----------
export default function App() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  // SECURITY: start UNAUTHENTICATED, always.
  //
  // This previously read localStorage ("user" + "token") synchronously and
  // returned { loggedIn: true } with NO server verification — so anyone could
  // set those two keys in DevTools and appear logged in (as admin), and a
  // stale entry auto-logged users in on startup. Session state now comes
  // exclusively from AuthProvider, which verifies against the backend; this
  // legacy context is a read-only mirror of that verified state.
  const [auth, setAuth] = useState<AuthState>({ loggedIn: false });

  const add = (line: CartLine) => {
    setLines((prev) => {
      const k = lineKey(line);
      const idx = prev.findIndex((p) => lineKey(p) === k);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + line.quantity };
        return copy;
      }
      return [...prev, line];
    });
  };

  const remove = (key: string) => {
    setLines((p) => p.filter((x) => lineKey(x) !== key));
  };

  const updateQty = (key: string, qty: number) => {
    setLines((p) => p.map((x) => (lineKey(x) === key ? { ...x, quantity: Math.max(1, qty) } : x)));
  };

  const clear = () => {
    setLines([]);
  };

  const total = useMemo(() => lines.reduce((s, l) => s + l.price * l.quantity, 0), [lines]);
  const count = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);

  const toggle = (id: string) => {
    setWishlist((prev) =>
      prev.find((x) => x.productId === id)
        ? prev.filter((x) => x.productId !== id)
        : [...prev, { productId: id }],
    );
  };

  const has = (id: string) => wishlist.some((x) => x.productId === id);

  // Build this context's lightweight user shape (name + avatar initials) from
  // the AuthUser the real backend returns.
  const toNavUser = (u: { email: string; firstName?: string; lastName?: string; role?: "admin" | "buyer" }) => ({
    email: u.email,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
    avatar: (u.firstName?.[0] ?? u.email[0]).toUpperCase() + (u.lastName?.[0] ?? "").toUpperCase(),
    role: u.role ?? ("buyer" as const),
  });

  const login = async (email: string, password?: string) => {
    // Real backend auth (bcrypt-hashed, JWT session on :5001). Routes admin →
    // /admin, buyer → /account.
    const authUser = await authService.login({ identifier: email, password: password || "", rememberMe: false });
    const user = toNavUser(authUser);
    localStorage.setItem("user", JSON.stringify(user));
    setAuth({ loggedIn: true, user });
    window.location.assign(homeRouteForRole(user.role));
  };

  const register = async (name: string, email: string, password?: string) => {
    // Real backend registration — new sign-ups are buyers and persist server-side.
    const authUser = await authService.register({ fullName: name, email, phone: "", password: password || "" });
    const user = toNavUser(authUser);
    localStorage.setItem("user", JSON.stringify(user));
    setAuth({ loggedIn: true, user });
    setLines([]);
    setWishlist([]);
    window.location.assign(homeRouteForRole("buyer"));
  };

  const logout = () => {
    void authService.logout(); // best-effort server-side revocation + token clear
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setAuth({ loggedIn: false });
    setLines([]);
    setWishlist([]);
  };

  return (
    <AuthCtx.Provider value={{ auth, login, logout, register }}>
      <CartCtx.Provider value={{ lines, add, remove, updateQty, clear, total, count }}>
        <WishCtx.Provider value={{ items: wishlist, toggle, has }}>
          <ToastProvider>
            <BrowserRouter>
              <AuthProvider>
                <LegacyAuthBridge onChange={setAuth} />
                <ScrollToTop />
                <Shell />
              </AuthProvider>
            </BrowserRouter>
          </ToastProvider>
        </WishCtx.Provider>
      </CartCtx.Provider>
    </AuthCtx.Provider>
  );
}

/**
 * Mirrors the VERIFIED session from AuthProvider into the legacy AuthCtx that
 * the navbar still reads. One authoritative source (the backend-validated
 * session); this component only copies it down. Renders nothing.
 */
function LegacyAuthBridge({ onChange }: { onChange: (s: AuthState) => void }) {
  const { user, authReady } = useAuthSession();
  useEffect(() => {
    if (!authReady) return; // never claim a session before verification finishes
    onChange(
      user
        // NOTE: role is deliberately NOT mirrored here. This context feeds
        // presentation only (avatar/'"'"'signed in'"'"' chrome); every authorization
        // decision reads the verified session via useAuthSession().
        ? { loggedIn: true, user: { name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email, email: user.email, avatar: (user.firstName?.[0] ?? user.email[0] ?? "U").toUpperCase() } }
        : { loggedIn: false },
    );
  }, [user, authReady, onChange]);
  return null;
}

function Shell() {
  const loc = useLocation();
  // The admin dashboard ships its own layout (sidebar + topbar), no storefront chrome.
  // Guarded so only ADMIN users can reach it; buyers are redirected to /account.
  if (loc.pathname.startsWith("/admin")) {
    return (
      <AdminGuard>
        <AdminRoutes />
      </AdminGuard>
    );
  }
  // The buyer self-service dashboard ships its own layout too. Guarded: an
  // unauthenticated visitor previously reached /account/* directly (orders,
  // addresses, invoices) and only saw empty data because the APIs 401'"'"'d.
  if (loc.pathname.startsWith("/account")) {
    return (
      <BuyerGuard>
        <BuyerRoutes />
      </BuyerGuard>
    );
  }
  // The supplier portal (real JWT auth) ships its own layout and guards.
  if (loc.pathname.startsWith("/seller")) return <SellerRoutes />;
  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      <Navbar />
      <AnimatedRoutes />
      <Footer />
      <WhatsAppButton />
    </div>
  );
}

function AnimatedRoutes() {
  const loc = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={loc.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className="flex-1"
      >
        <Routes location={loc} key={loc.pathname}>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Listing />} />
          <Route path="/product/:slug" element={<Details />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/eco-rewards" element={<EcoRewards />} />
          <Route path="/sustainability" element={<Navigate to="/eco-rewards" replace />} />
           <Route path="/cart" element={<CartPage />} />
          {/* Multi-step checkout — buyer-guarded, wrapped in the checkout state provider. */}
          <Route
            path="/checkout/*"
            element={
              <BuyerGuard>
                <CheckoutProvider>
                  <Routes>
                    <Route index element={<Navigate to="address" replace />} />
                    <Route path="address" element={<CheckoutAddress />} />
                    <Route path="review" element={<CheckoutReview />} />
                    <Route path="payment" element={<CheckoutPayment />} />
                    <Route path="success/:orderId" element={<CheckoutSuccess />} />
                  </Routes>
                </CheckoutProvider>
              </BuyerGuard>
            }
          />
          {/* Legacy storefront routes now consolidated into the buyer portal (/account/*). */}
          <Route path="/order-tracking" element={<Navigate to="/account/orders" replace />} />
          <Route path="/dashboard" element={<Navigate to="/account/dashboard" replace />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

import Home from "./pages/Home";
import Listing from "./pages/Listing";
import Details from "./pages/Details";
import Categories from "./pages/Categories";
import EcoRewards from "./pages/EcoRewards";
import CartPage from "./pages/CartPage";
import Contact from "./pages/Contact";
import AdminRoutes from "./admin/AdminRoutes";
import BuyerRoutes from "./buyer/BuyerRoutes";
import SellerRoutes from "./seller/SellerRoutes";
import { AdminGuard, BuyerGuard } from "./components/auth/RoleGuards";
import { CheckoutProvider } from "./pages/checkout/checkout-context";
import CheckoutAddress from "./pages/checkout/CheckoutAddress";
import CheckoutReview from "./pages/checkout/CheckoutReview";
import CheckoutPayment from "./pages/checkout/CheckoutPayment";
import CheckoutSuccess from "./pages/checkout/CheckoutSuccess";

export { TopBar, Navbar, Footer };
export type { Product };
export { CATEGORIES } from "./data/products";
