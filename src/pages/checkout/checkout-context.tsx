import { createContext, useContext, useState, type ReactNode } from "react";
import type { CheckoutPaymentMethod } from "../../lib/api/commerce";

// Ephemeral checkout state shared across the address → review → payment steps.
// Persisted to sessionStorage so a refresh (or returning from payment) recovers
// the in-progress selection instead of dropping the user back to the cart.
interface CheckoutState {
  shippingAddressId: string | null;
  setShippingAddressId: (id: string | null) => void;
  couponCode: string | null;
  setCouponCode: (code: string | null) => void;
  /** Chosen from the methods the admin has enabled (see /checkout/payment-methods). */
  paymentMethod: CheckoutPaymentMethod;
  setPaymentMethod: (m: CheckoutPaymentMethod) => void;
}

const Ctx = createContext<CheckoutState | null>(null);

const KEY = "zolo.checkout";
interface Persisted { shippingAddressId: string | null; couponCode: string | null; paymentMethod?: CheckoutPaymentMethod }
function load(): Persisted {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return { shippingAddressId: null, couponCode: null }; }
}
function save(s: Persisted) {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const initial = load();
  const [shippingAddressId, setShipId] = useState<string | null>(initial.shippingAddressId ?? null);
  const [couponCode, setCoupon] = useState<string | null>(initial.couponCode ?? null);
  const [paymentMethod, setMethod] = useState<CheckoutPaymentMethod>(initial.paymentMethod ?? "cod");

  const setShippingAddressId = (id: string | null) => { setShipId(id); save({ shippingAddressId: id, couponCode, paymentMethod }); };
  const setCouponCode = (code: string | null) => { setCoupon(code); save({ shippingAddressId, couponCode: code, paymentMethod }); };
  const setPaymentMethod = (m: CheckoutPaymentMethod) => { setMethod(m); save({ shippingAddressId, couponCode, paymentMethod: m }); };

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
