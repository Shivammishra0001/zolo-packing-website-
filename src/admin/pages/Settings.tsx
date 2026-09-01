import { Building2, CreditCard, MessageCircle, ServerCog, Truck } from "lucide-react";
import { Badge, PageHeader } from "../components/ui";

// Settings.
//
// The previous page was decorative: a fabricated GSTIN, a Razorpay toggle for
// a gateway that does not exist, courier switches wired to nothing, a dummy
// API key, and one shared "Settings saved" toast behind all eight tabs — an
// operator could believe they had configured things that were never stored.
//
// Until a real settings backend exists, this page states what is actually
// configured and where. Runtime configuration lives in server environment
// variables (server/.env — see server/.env.example).

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Building2; children: React.ReactNode }) {
  return (
    <div className="erp-card card-shadow p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold erp-text">
        <Icon className="h-4 w-4 text-primary-500" aria-hidden /> {title}
      </h3>
      {children}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Settings" }]}
        title="Settings"
        subtitle="What is configured today, and where configuration lives."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Payments" icon={CreditCard}>
          <p className="text-sm erp-text-muted">
            Orders settle <span className="font-semibold erp-text">offline</span>: Cash on Delivery, NEFT, cheque and
            bank transfer. No online payment gateway is integrated yet — when one is added, it will be configured via
            server environment variables, not a toggle here.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["COD", "NEFT", "Cheque", "Bank transfer"].map((m) => <Badge key={m} tone="success">{m}</Badge>)}
            <Badge tone="neutral">Online gateway: not integrated</Badge>
          </div>
        </Card>

        <Card title="WhatsApp notifications" icon={MessageCircle}>
          <p className="text-sm erp-text-muted">
            New-RFQ alerts to the owner are sent via Meta's WhatsApp Cloud API when <code className="font-mono text-xs">WHATSAPP_*</code> and{" "}
            <code className="font-mono text-xs">OWNER_WHATSAPP_NUMBER</code> are set in <code className="font-mono text-xs">server/.env</code>. Without
            credentials, deliveries are recorded as skipped — never faked. Delivery outcomes are stored per message in
            the database.
          </p>
        </Card>

        <Card title="Shipping" icon={Truck}>
          <p className="text-sm erp-text-muted">
            Shipments are recorded manually per order (courier name + tracking number on the order's status update).
            No courier API integration exists yet.
          </p>
        </Card>

        <Card title="Company profile" icon={Building2}>
          <p className="text-sm erp-text-muted">
            Company name, address and GSTIN for invoices are not yet stored in the database. Until a settings API
            exists, nothing is shown here rather than a fabricated profile.
          </p>
        </Card>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border erp-border-soft p-4 text-xs erp-text-faint">
        <ServerCog className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Runtime configuration (database, JWT secrets, WhatsApp, admin account, CORS) lives in{" "}
          <code className="font-mono">server/.env</code> — the annotated reference is{" "}
          <code className="font-mono">server/.env.example</code>. Changes require a server restart.
        </span>
      </div>
    </div>
  );
}
