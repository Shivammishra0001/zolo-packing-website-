import { Navigate, Route, Routes } from "react-router-dom";
import { BuyerGuard } from "@/components/auth/RoleGuards";
import BuyerLayout from "./BuyerLayout";
import Dashboard from "./pages/Dashboard";
// The REAL quotations page (live /rfqs API: list, compare, accept, reject).
// The previous ./pages/Quotations rendered mock arrays that are permanently
// empty, so a buyer could never see or act on an actual quotation.
import Quotations from "@/pages/MyQuotations";
import Orders from "./pages/OrdersReal";
import OrderDetail from "./pages/OrderDetailReal";
import InvoiceView from "./pages/InvoiceView";
import Tracking from "./pages/Tracking";
import Payments from "./pages/Payments";
import Recycle from "./pages/Recycle";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

/**
 * Buyer self-service dashboard at /account/*.
 * Every route is wrapped in <BuyerGuard>: guests are bounced to the storefront
 * (auth modal opens), and ADMINS are redirected to /admin — a buyer view is
 * never shown to an admin, and admin data is never exposed here.
 */
export default function BuyerRoutes() {
  return (
    <BuyerGuard>
      <Routes>
        <Route path="/account" element={<BuyerLayout />}>
          <Route index element={<Navigate to="/account/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="quotations" element={<Quotations />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="orders/:id/invoice" element={<InvoiceView />} />
          <Route path="tracking" element={<Tracking />} />
          <Route path="payments" element={<Payments />} />
          <Route path="recycle" element={<Recycle />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/account/dashboard" replace />} />
        </Route>
      </Routes>
    </BuyerGuard>
  );
}
