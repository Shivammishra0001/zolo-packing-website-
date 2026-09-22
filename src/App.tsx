import { useState, useEffect, useMemo, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Link, NavLink, useLocation, useSearchParams, useNavigate, useParams, Navigate } from "react-router-dom";
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
  /** `avatar` = initials fallback; `avatarUrl` = the uploaded profile photo. */
  user?: { name: string; email: string; avatar: string; avatarUrl?: string | null };
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
    <div className="bg-navy-950 text-xs text-white">
      <div className="shell flex min-h-8 flex-wrap py-1.5 items-center justify-center gap-x-4 gap-y-1 sm:flex-nowrap sm:justify-between">
        {/* Announcement bar: the live "Announcement Bar" campaign (Admin →
            Marketing → Campaigns). With no live campaign the standing shipping
            note shows instead — hidden on small phones so the links never clip. */}
        <div className="min-w-0 max-w-full sm:flex-1">
          <AnnouncementCampaign
            fallback={
              <span className="hidden sm:flex items-center gap-1.5 truncate">
                <Truck className="h-3.5 w-3.5 shrink-0 text-primary-400" /> Free shipping on orders over ₹10000
              </span>
            }
          />
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link to="/order-tracking" className="hover:text-primary-400 transition-colors">Track Order</Link>
          <span className="hidden md:inline text-dark-600">|</span>
          <Link to="/rfq" className="hidden md:inline hover:text-primary-400 transition-colors">Get Quote</Link>
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
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [searchVal, setSearchVal] = useState("");
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [sellerMenu, setSellerMenu] = useState(false);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const searchParam = searchParams.get("search") || "";
  const { pathname } = useLocation();

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  useEffect(() => { setSearchVal(searchParam); }, [searchParam]);
  // Route change closes the drawer; lock page scroll while it is open.
  useEffect(() => { setOpen(false); setShowMobileSearch(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowMobileSearch(false);
    setOpen(false);
    if (searchVal.trim()) nav(`/products?search=${encodeURIComponent(searchVal.trim())}`);
    else nav("/products");
  };

  const links = [
    { to: "/products", label: "Products" },
    { to: "/categories", label: "Categories" },
    { to: "/eco-rewards", label: "Eco Rewards" },
    { to: "/contact", label: "Contact" },
  ];

  const iconBtn = "relative flex h-10 w-10 items-center justify-center rounded-lg text-dark-600 transition-colors hover:bg-dark-50 hover:text-dark-900";
  const badge = "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold tabular-nums text-white";

  return (
    <header className={`sticky top-0 z-40 border-b border-dark-200 bg-white/95 backdrop-blur-md transition-shadow ${scrolled ? "shadow-[0_4px_16px_rgba(15,23,42,0.06)]" : ""}`}>
      <div className="shell flex h-16 items-center gap-3 lg:h-[68px]">
        {showMobileSearch ? (
          <form onSubmit={handleSearchSubmit} className="flex flex-1 items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" aria-hidden />
              <input type="search" value={searchVal} onChange={(e) => setSearchVal(e.target.value)} placeholder="Search packaging products…" autoFocus aria-label="Search products" className="input h-10 min-h-0 pl-9" />
            </div>
            <button type="button" onClick={() => { setShowMobileSearch(false); setSearchVal(""); }} aria-label="Close search" className={iconBtn}><X className="h-5 w-5" /></button>
          </form>
        ) : (
          <>
            <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Zolo Packing home">
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white sm:h-10 sm:w-10">
                <img src={logoImg} alt="" className="h-full w-full object-cover" />
              </span>
              <span className="leading-none">
                <span className="block font-display text-base font-extrabold tracking-tight text-dark-900 sm:text-lg">Zolo<span className="text-primary-500"> Packing</span></span>
                <span className="mt-0.5 hidden text-[9px] font-semibold uppercase tracking-[0.18em] text-dark-500 sm:block">Premium Packaging</span>
              </span>
            </Link>

            <nav className="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Main">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-green-100 text-green-700" : "text-dark-600 hover:bg-dark-50 hover:text-dark-900"}`}>
                  {l.label}
                </NavLink>
              ))}
            </nav>

            {/* Search sits in the header as an integrated field, not a stray input. */}
            <form onSubmit={handleSearchSubmit} role="search" className="mx-auto hidden w-full max-w-md flex-1 md:block xl:max-w-lg">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" aria-hidden />
                <input type="search" value={searchVal} onChange={(e) => setSearchVal(e.target.value)} placeholder="Search boxes, bags, tape…" aria-label="Search products" className="input h-10 min-h-0 border-dark-200 bg-dark-50 pl-9 text-sm focus:bg-white" />
              </div>
            </form>

            <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
              {/* Seller entry — login or register as a supplier */}
              <div className="relative hidden lg:block">
                <button onClick={() => setSellerMenu((v) => !v)} onBlur={() => setTimeout(() => setSellerMenu(false), 150)} aria-haspopup="true" aria-expanded={sellerMenu} className="btn btn-ghost btn-sm text-dark-700">
                  <Store className="h-4 w-4" aria-hidden /> Sell on Zolo <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sellerMenu ? "rotate-180" : ""}`} aria-hidden />
                </button>
                <AnimatePresence>
                  {sellerMenu && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="card absolute right-0 z-50 mt-2 w-60 p-1.5 shadow-card-hover">
                      <Link to="/seller/login" onMouseDown={(e) => e.preventDefault()} onClick={() => setSellerMenu(false)} className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-green-50">
                        <User className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                        <span><span className="block text-sm font-bold text-dark-900">Seller Login</span><span className="block text-xs text-dark-500">Access your supplier dashboard</span></span>
                      </Link>
                      <Link to="/seller/login?tab=register" onMouseDown={(e) => e.preventDefault()} onClick={() => setSellerMenu(false)} className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-green-50">
                        <Store className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
                        <span><span className="block text-sm font-bold text-dark-900">Become a Supplier</span><span className="block text-xs text-dark-500">Register your business to sell</span></span>
                      </Link>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <Link to="/rfq" className="btn btn-primary btn-sm hidden lg:inline-flex"><Quote className="h-4 w-4" aria-hidden /> Get Quote</Link>
              <button onClick={() => setShowMobileSearch(true)} aria-label="Search" className={`${iconBtn} md:hidden`}><Search className="h-5 w-5" /></button>
              <Link to="/account/dashboard" aria-label={auth.loggedIn ? "My account" : "Sign in"} className={`${iconBtn} hidden sm:flex`}>
                {auth.loggedIn ? (
                  auth.user?.avatarUrl
                    ? <img src={auth.user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover ring-2 ring-green-100" />
                    : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">{auth.user?.avatar}</span>
                ) : <User className="h-5 w-5" />}
              </Link>
              <Link to="/account/dashboard" aria-label="Wishlist" className={`${iconBtn} hidden sm:flex`}>
                <Heart className="h-5 w-5" />
                {items.length > 0 && <span className={badge}>{items.length}</span>}
              </Link>
              {/* Cart — count comes from the real server-backed cart store, so
                  it stays in sync across listing, detail, cart page and header. */}
              <Link to="/cart" aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}` : "Cart, empty"} className={iconBtn}>
                <ShoppingCart className="h-5 w-5" />
                {cartCount > 0 && <span className={badge}>{cartCount > 99 ? "99+" : cartCount}</span>}
              </Link>
              <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className={`${iconBtn} lg:hidden`}><Menu className="h-5 w-5" /></button>
            </div>
          </>
        )}
      </div>

      {/* Mobile navigation: a real slide-in drawer (menu, search, links, CTAs, account). */}
      <AnimatePresence>
        {open && (
          <>
            <motion.button type="button" aria-label="Close menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden" />
            <motion.aside
              role="dialog" aria-modal="true" aria-label="Menu"
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
              className="fixed inset-y-0 right-0 z-50 flex w-[86vw] max-w-sm flex-col bg-white shadow-2xl lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b border-dark-200 px-4">
                <span className="font-display text-base font-extrabold text-dark-900">Zolo<span className="text-primary-500"> Packing</span></span>
                <button onClick={() => setOpen(false)} aria-label="Close menu" className={iconBtn}><X className="h-5 w-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <form onSubmit={handleSearchSubmit} role="search" className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" aria-hidden />
                  <input type="search" value={searchVal} onChange={(e) => setSearchVal(e.target.value)} placeholder="Search products…" aria-label="Search products" className="input pl-9" />
                </form>
                <nav className="mt-4 space-y-0.5" aria-label="Mobile">
                  {[{ to: "/", label: "Home" }, ...links].map((l) => (
                    <NavLink key={l.to} to={l.to} end={l.to === "/"} onClick={() => setOpen(false)} className={({ isActive }) => `block rounded-lg px-3 py-2.5 text-[15px] font-semibold ${isActive ? "bg-green-100 text-green-700" : "text-dark-700 hover:bg-dark-50"}`}>
                      {l.label}
                    </NavLink>
                  ))}
                </nav>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link to="/rfq" onClick={() => setOpen(false)} className="btn btn-primary"><Quote className="h-4 w-4" aria-hidden /> Get Quote</Link>
                  <Link to="/cart" onClick={() => setOpen(false)} className="btn btn-outline"><ShoppingCart className="h-4 w-4" aria-hidden /> Cart{cartCount > 0 ? ` (${cartCount})` : ""}</Link>
                </div>
                <div className="mt-5 border-t border-dark-200 pt-4">
                  <div className="eyebrow mb-1 text-dark-400">Account</div>
                  <Link to="/account/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-dark-700 hover:bg-dark-50"><User className="h-4 w-4 text-green-600" aria-hidden /> {auth.loggedIn ? "My account" : "Sign in / Register"}</Link>
                  <Link to="/account/orders" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-dark-700 hover:bg-dark-50"><Truck className="h-4 w-4 text-green-600" aria-hidden /> Track order</Link>
                </div>
                <div className="mt-3 border-t border-dark-200 pt-4">
                  <div className="eyebrow mb-1 text-dark-400">For suppliers</div>
                  <Link to="/seller/login" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-dark-700 hover:bg-dark-50"><User className="h-4 w-4 text-green-600" aria-hidden /> Seller Login</Link>
                  <Link to="/seller/login?tab=register" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-dark-700 hover:bg-dark-50"><Store className="h-4 w-4 text-green-600" aria-hidden /> Become a Supplier</Link>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}

// ---------- Footer ----------
function Footer() {
  const cols = [
    { title: "Products", items: [
      { label: "All Products", to: "/products" }, { label: "Categories", to: "/categories" }, { label: "New Arrivals", to: "/products?sort=new" }, { label: "Custom Printing", to: "/contact" }, { label: "Eco Products", to: "/products?search=eco" },
    ] },
    { title: "Support", items: [
      { label: "Contact us", to: "/contact" }, { label: "Track order", to: "/order-tracking" }, { label: "Request Quote", to: "/rfq" }, { label: "Shipping & Returns", to: "/contact" }, { label: "Eco Rewards", to: "/eco-rewards" },
    ] },
    { title: "Company", items: [
      { label: "About Us", to: "/contact" }, { label: "Sustainability", to: "/sustainability" }, { label: "Recycling Program", to: "/sustainability#recycling" }, { label: "Sell on Zolo", to: "/seller/login?tab=register" }, { label: "Careers", to: "/contact" },
    ] },
  ];

  return (
    <footer className="bg-navy-950 text-white">
      {/* Compact contact + CTA strip */}
      <div className="border-b border-white/10">
        <div className="shell flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <a href="tel:+919582712626" className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-primary-400" aria-hidden />
              <span><span className="block text-[11px] uppercase tracking-wider text-dark-400">Call us</span><span className="block text-sm font-bold">+91 9582712626</span></span>
            </a>
            <a href="mailto:contact@zolopacking.com" className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-primary-400" aria-hidden />
              <span><span className="block text-[11px] uppercase tracking-wider text-dark-400">Email</span><span className="block text-sm font-bold">contact@zolopacking.com</span></span>
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/rfq" className="btn btn-primary btn-sm"><Quote className="h-4 w-4" aria-hidden /> Request Free Quote</Link>
            <Link to="/eco-rewards" className="btn btn-sm border border-white/15 bg-white/10 text-white hover:bg-white/15"><Leaf className="h-4 w-4" aria-hidden /> Eco Rewards</Link>
          </div>
        </div>
      </div>

      <div className="shell py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white"><img src={logoImg} alt="" className="h-full w-full object-cover" /></span>
              <span className="font-display text-lg font-extrabold">Zolo<span className="text-primary-400"> Packing</span></span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-dark-400">India's leading packaging manufacturer. Premium custom boxes, bags, pouches and sustainable packaging for brands of every size.</p>
            <div className="mt-4 flex gap-2">
              {[Send, MessageCircle, Mail, Phone].map((Icon, i) => (
                <a key={i} href="#" aria-label="Social link" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-green-500 hover:bg-green-500"><Icon className="h-4 w-4" aria-hidden /></a>
              ))}
            </div>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <div className="mb-3 text-sm font-bold">{c.title}</div>
              <ul className="space-y-2 text-sm">
                {c.items.map((it) => <li key={it.label}><Link to={it.to} className="text-dark-400 transition-colors hover:text-white">{it.label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-5 text-xs text-dark-500 md:flex-row md:items-center md:justify-between">
          <div>© 2026 Zolo Packing Inc. All rights reserved.</div>
          <div className="flex flex-wrap gap-4"><a href="#" className="hover:text-white">Privacy</a><a href="#" className="hover:text-white">Terms</a><a href="#" className="hover:text-white">Cookies</a></div>
          <div className="flex gap-3 text-[10px] uppercase tracking-wider"><span>Visa</span><span>Mastercard</span><span>Amex</span><span>UPI</span></div>
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
// Sales contact. International format with no "+", spaces or dashes — wa.me
// silently fails on anything else.
const WHATSAPP_NUMBER = "919582712626";
const WHATSAPP_MESSAGE =
  "Hi Zolo Packaging, I'd like to request a quotation.\n\n" +
  "Product: \nQuantity: \nCompany: ";

function WhatsAppButton() {
  // Prefill the chat so the customer lands on a quotation request rather than
  // an empty box, and the sales team gets the fields it always has to ask for.
  // encodeURIComponent keeps the newlines intact as %0A.
  const href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

  return (
    <a
      href={href}
      target="_blank"
      // noreferrer defends against reverse-tabnabbing on the opened tab.
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-30 group"
      title="Chat on WhatsApp"
      aria-label="Request a quotation on WhatsApp"
    >
      <div className="relative">
        <div className="h-14 w-14 rounded-full bg-[#25D366] shadow-lg shadow-[#25D366]/40 flex items-center justify-center hover:scale-110 transition-transform">
          {/* WhatsApp's own glyph, not a generic chat bubble — the mark is what
              makes the button recognisable at a glance. */}
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            style={{ color: "#fff" }}
          >
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
        </div>
        <div className="absolute -top-12 right-0 hidden group-hover:block">
          <div className="bg-dark-900 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
            Get a quotation on WhatsApp
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
        ? { loggedIn: true, user: { name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email, email: user.email, avatar: (user.firstName?.[0] ?? user.email[0] ?? "U").toUpperCase(), avatarUrl: user.avatarUrl ?? null } }
        : { loggedIn: false },
    );
  }, [user, authReady, onChange]);
  return null;
}

/** /category/boxes[/gift-boxes] → /products?category=boxes[&subcategory=gift-boxes] */
function CategoryRedirect() {
  const { slug = "", sub } = useParams();
  const q = new URLSearchParams({ category: slug });
  if (sub) q.set("subcategory", sub);
  return <Navigate to={`/products?${q.toString()}`} replace />;
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
          {/* SEO paths for category / subcategory pages → the catalog listing filters. */}
          <Route path="/category/:slug" element={<CategoryRedirect />} />
          <Route path="/category/:slug/:sub" element={<CategoryRedirect />} />
          <Route path="/eco-rewards" element={<EcoRewards />} />
          <Route path="/sustainability" element={<Navigate to="/eco-rewards" replace />} />
           <Route path="/cart" element={<CartPage />} />
           {/* RFQ: collect many products into one request, then review/send. */}
           <Route path="/rfq" element={<RfqPage />} />
           {/* NOTE: /account/* never reaches this router — Shell() hands those
               paths to BuyerRoutes, where /account/quotations renders the real
               quotations page. A duplicate route here would be dead code. */}
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

import { AnnouncementCampaign } from "./components/marketing/campaigns";
import Home from "./pages/Home";
import Listing from "./pages/Listing";
import Details from "./pages/Details";
import Categories from "./pages/Categories";
import EcoRewards from "./pages/EcoRewards";
import CartPage from "./pages/CartPage";
import RfqPage from "./pages/RfqPage";
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
