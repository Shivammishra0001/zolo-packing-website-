import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSellerAuth } from "../SellerAuth";
import { ApiError } from "../api";
import { Card, Button, Field, Input, Alert } from "../ui";

export default function SellerLogin() {
  const { login, registerSeller } = useSellerAuth();
  const navigate = useNavigate();
  // Deep-link support: /seller/login?tab=register opens the sign-up tab.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<"login" | "register">(
    searchParams.get("tab") === "register" ? "register" : "login",
  );
  const [form, setForm] = useState({ email: "", password: "", firstName: "", companyName: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "login") await login(form.email, form.password);
      else await registerSeller({ email: form.email, password: form.password, firstName: form.firstName, companyName: form.companyName, phone: form.phone });
      navigate("/seller/dashboard");
    } catch (err) {
      const msg = err instanceof ApiError ? (err.issues?.[0]?.message ?? err.message) : "Something went wrong";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16">
      <div className="mx-auto max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Zolo for Suppliers</h1>
          <p className="mt-1 text-sm text-slate-500">Sell your packaging to businesses across India.</p>
        </div>
        <Card>
          <div className="mb-5 flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
            {(["login", "register"] as const).map((t) => (
              <button key={t} onClick={() => { setTab(t); setError(null); }}
                className={`flex-1 rounded-md py-1.5 capitalize transition ${tab === t ? "bg-white text-orange-600 shadow-sm" : "text-slate-500"}`}>
                {t === "login" ? "Sign in" : "Become a supplier"}
              </button>
            ))}
          </div>

          {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}

          <form onSubmit={submit} className="space-y-4">
            {tab === "register" && (
              <>
                <Field label="Your name" required>
                  <Input value={form.firstName} onChange={set("firstName")} required placeholder="Sam Kapoor" autoComplete="name" />
                </Field>
                <Field label="Company name" hint="Used as your organization name; you can refine it later.">
                  <Input value={form.companyName} onChange={set("companyName")} placeholder="Acme Packaging Pvt Ltd" />
                </Field>
                <Field label="Phone">
                  <Input value={form.phone} onChange={set("phone")} placeholder="98765 43210" autoComplete="tel" />
                </Field>
              </>
            )}
            <Field label="Work email" required>
              <Input type="email" value={form.email} onChange={set("email")} required placeholder="you@company.com" autoComplete="email" />
            </Field>
            <Field label="Password" required hint={tab === "register" ? "At least 8 characters, with a letter and a number." : undefined}>
              <Input type="password" value={form.password} onChange={set("password")} required autoComplete={tab === "login" ? "current-password" : "new-password"} />
            </Field>
            <Button type="submit" loading={busy} className="w-full">
              {tab === "login" ? "Sign in" : "Create supplier account"}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-400">
          <Link to="/" className="hover:text-slate-600">← Back to Zolo</Link>
        </p>
      </div>
    </div>
  );
}
