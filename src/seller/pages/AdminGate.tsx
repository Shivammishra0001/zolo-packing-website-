// Real-JWT gate for the admin seller-review pages. These pages use the seller
// API's own token store (zolo.seller.*); rather than bounce the user elsewhere,
// we show an inline sign-in form here so an admin can authenticate in place.
import { useEffect, useState, type ReactNode } from "react";
import { authApi, tokenStore } from "../api";
import { isAdmin } from "../SellerAuth";
import { ApiError } from "../api";
import { Card, Button, Field, Input, Alert } from "../ui";

export function AdminGate({ children }: { children: ReactNode }) {
  // SECURITY: never seed from tokenStore.getUser(). That blob is attacker-
  // writable localStorage — setting {"role":"admin"} in DevTools used to walk
  // straight through this gate. The session is verified against the backend
  // via authApi.me() below, and the backend re-checks the role on every admin
  // API call regardless of what this component renders.
  const [user, setUser] = useState<Awaited<ReturnType<typeof authApi.me>>["user"] | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!tokenStore.get()) { setChecking(false); return; }
    authApi
      .me()
      .then((me) => { if (!cancelled) setUser(me.user); })
      .catch(() => { if (!cancelled) { tokenStore.clear(); setUser(null); } })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, []);

  // Don't flash the sign-in form (or the protected content) mid-verification.
  if (checking) return <div className="mx-auto max-w-md p-6 text-sm text-dark-500">Checking your session…</div>;
  if (user && isAdmin(user.role)) return <>{children}</>;

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authApi.login({ email, password });
      if (!isAdmin(res.user.role)) {
        setError("This account is not an admin. Use an admin account to review sellers.");
        return;
      }
      tokenStore.set(res.accessToken, res.refreshToken, res.user);
      setUser(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <h2 className="text-lg font-bold text-slate-900">Admin sign-in</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          Seller review connects to the live backend, so it needs a real admin login
          {user ? " (your current session isn't an admin account)" : ""}.
        </p>
        {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
        <form onSubmit={signIn} className="space-y-4">
          <Field label="Admin email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="admin@zolo.com" autoComplete="email" />
          </Field>
          <Field label="Password" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </Field>
          <Button type="submit" loading={busy} className="w-full">Sign in</Button>
        </form>
        <p className="mt-4 text-xs text-slate-400">
          No default admin exists. See DOCKER.md to create one via `npm run seed:admin`.
        </p>
      </Card>
    </div>
  );
}
