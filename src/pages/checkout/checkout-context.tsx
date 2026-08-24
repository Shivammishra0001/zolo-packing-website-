import { createContext, useContext, useState, type ReactNode } from "react";

// Ephemeral checkout state shared across the address → review → payment steps.
// Persisted to sessionStorage so a refresh (or returning from payment) recovers
// the in-progress selection instead of dropping the user back to the cart.
interface CheckoutState {
  shippingAddressId: string | null;
  setShippingAddressId: (id: string | null) => void;
  couponCode: string | null;
  setCouponCode: (code: string | null) => void;
  paymentMethod: "cod";
  setPaymentMethod: (m: "cod") => void;
}

const Ctx = createContext<CheckoutState | null>(null);

const KEY = "zolo.checkout";
function load(): { shippingAddressId: string | null; couponCode: string | null } {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return { shippingAddressId: null, couponCode: null }; }
}
function save(s: { shippingAddressId: string | null; couponCode: string | null }) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const initial = load();
  const [shippingAddressId, setShipId] = useState<string | null>(initial.shippingAddressId ?? null);
  const [couponCode, setCoupon] = useState<string | null>(initial.couponCode ?? null);
  const [paymentMethod, setPaymentMethod] = useState<"cod">("cod");

  const setShippingAddressId = (id: string | null) => { setShipId(id); save({ shippingAddressId: id, couponCode }); };
  const setCouponCode = (code: string | null) => { setCoupon(code); save({ shippingAddressId, couponCode: code }); };

  return (
    <Ctx.Provider value={{ shippingAddressId, setShippingAddressId, couponCode, setCouponCode, paymentMethod, setPaymentMethod }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCheckout(): CheckoutState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCheckout must be used inside <CheckoutProvider>");
  return ctx;
}

export function clearCheckoutState() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
