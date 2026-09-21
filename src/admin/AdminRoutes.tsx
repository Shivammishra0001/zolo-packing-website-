import { Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import DashboardHome from "./pages/DashboardHome";

// Sales
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Quotations from "./pages/Quotations";
import QuotationDetail from "./pages/QuotationDetail";
import ChatInbox from "./pages/ChatInbox";
import Orders from "./pages/OrdersReal";
import OrderDetail from "./pages/OrderDetailReal";
import OrderInvoice from "./pages/OrderInvoice";
import ReturnsRecycling from "./pages/returns/ReturnsRecycling";
import RecyclingRequestDetail from "./pages/returns/RecyclingRequestDetail";
import ReturnDetail from "./pages/ReturnDetail";

// Catalog
import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
import PackagingTemplates from "./pages/PackagingTemplates";
import ImportHistory from "./pages/ImportHistory";

// Operations
import Artwork from "./pages/Artwork";
import Production from "./pages/Production";
import Inventory from "./pages/Inventory";
import Procurement from "./pages/Procurement";
import Shipping from "./pages/Shipping";

// Business
import Finance from "./pages/Finance";
import Reports from "./pages/Reports";

// Growth
import CMS from "./pages/CMS";
import Marketing from "./pages/Marketing";

// System
import AuditLogs from "./pages/AuditLogs";
import Settings from "./pages/Settings";

// Sellers / Suppliers (real backend)
import AdminSellers from "../seller/pages/AdminSellers";
import AdminSellerDetail from "../seller/pages/AdminSellerDetail";

/**
 * Self-contained ERP admin section — rendered without the storefront chrome.
 * All 17 modules wired here. Detail routes read their entity from mock data
 * by id via useParams; swap the mock imports for API calls later.
 */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardHome />} />

        {/* Sales */}
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="quotes" element={<Quotations />} />
        <Route path="quotes/:id" element={<QuotationDetail />} />
        <Route path="chat" element={<ChatInbox />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="orders/:id/invoice" element={<OrderInvoice />} />
        {/* Returns & Recycling: two separate workflows under one menu. */}
        <Route path="returns" element={<ReturnsRecycling section="overview" />} />
        <Route path="returns/product" element={<ReturnsRecycling section="product" />} />
        <Route path="returns/recycling" element={<ReturnsRecycling section="recycling" />} />
        <Route path="returns/recycling/:id" element={<RecyclingRequestDetail />} />
        <Route path="returns/rules" element={<ReturnsRecycling section="rules" />} />
        <Route path="returns/eco-credits" element={<ReturnsRecycling section="eco-credits" />} />
        <Route path="returns/eco-settings" element={<ReturnsRecycling section="eco-settings" />} />
        <Route path="returns/:id" element={<ReturnDetail />} />

        {/* Sellers / Suppliers (real DB-backed onboarding review) */}
        <Route path="sellers" element={<AdminSellers />} />
        <Route path="sellers/:id" element={<AdminSellerDetail />} />

        {/* Catalog */}
        <Route path="catalog" element={<Catalog />} />
        <Route path="catalog/imports" element={<ImportHistory />} />
        <Route path="catalog/:id" element={<ProductDetail />} />
        <Route path="templates" element={<PackagingTemplates />} />

        {/* Operations */}
        <Route path="artwork" element={<Artwork />} />
        <Route path="production" element={<Production />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="procurement" element={<Procurement />} />
        <Route path="shipping" element={<Shipping />} />
        {/* Legacy dashboard links point at /dispatch → the Shipping module */}
        <Route path="dispatch" element={<Navigate to="/admin/shipping" replace />} />

        {/* Business */}
        <Route path="finance" element={<Finance />} />
        <Route path="reports" element={<Reports />} />
        <Route path="rate-cards" element={<Navigate to="/admin/finance" replace />} />

        {/* Growth */}
        <Route path="cms" element={<CMS />} />
        <Route path="marketing" element={<Marketing />} />
        {/* /admin/marketing/coupons · /admin/marketing/campaigns */}
        <Route path="marketing/:tab" element={<Marketing />} />

        {/* System */}
        <Route path="audit" element={<AuditLogs />} />
        <Route path="settings" element={<Settings />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
