import { Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./AdminLayout";
import DashboardHome from "./pages/DashboardHome";

// Sales
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Quotations from "./pages/Quotations";
import QuotationDetail from "./pages/QuotationDetail";
import Orders from "./pages/OrdersReal";
import OrderDetail from "./pages/OrderDetailReal";
import OrderInvoice from "./pages/OrderInvoice";

// Catalog
import Catalog from "./pages/Catalog";
import ProductDetail from "./pages/ProductDetail";
import PackagingTemplates from "./pages/PackagingTemplates";

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
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="orders/:id/invoice" element={<OrderInvoice />} />

        {/* Sellers / Suppliers (real DB-backed onboarding review) */}
        <Route path="sellers" element={<AdminSellers />} />
        <Route path="sellers/:id" element={<AdminSellerDetail />} />

        {/* Catalog */}
        <Route path="catalog" element={<Catalog />} />
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

        {/* System */}
        <Route path="audit" element={<AuditLogs />} />
        <Route path="settings" element={<Settings />} />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
