import { useEffect, useState } from "react";
import { Outlet, useOutletContext } from "react-router-dom";
import { cn } from "@/utils/cn";
import { Sidebar } from "./components/Sidebar";
import { Topbar, type DateRange } from "./components/Topbar";
import { AdminThemeProvider } from "./theme";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { onCatalogPersistError } from "./catalog-store";

export interface AdminContext {
  range: DateRange;
}

/** Read the topbar's selected date range from any admin page */
export function useAdminContext() {
  return useOutletContext<AdminContext>();
}

function AdminChrome() {
  const toast = useToast();
  // Surface any DB persistence failure as a visible toast — never swallowed.
  useEffect(() => {
    const off = onCatalogPersistError((msg) => toast.error("Not saved to database", msg));
    return () => { off(); };
  }, [toast]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [range, setRange] = useState<DateRange>("today");

  return (
    <div className="min-h-screen erp-bg erp-text">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className={cn("flex min-h-screen flex-col", collapsed ? "lg:pl-[68px]" : "lg:pl-60")}>
        <Topbar
          onOpenMobileNav={() => setMobileOpen(true)}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          range={range}
          onRangeChange={setRange}
        />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet context={{ range } satisfies AdminContext} />
        </main>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  return (
    <AdminThemeProvider>
      <ToastProvider>
        <AdminChrome />
      </ToastProvider>
    </AdminThemeProvider>
  );
}
