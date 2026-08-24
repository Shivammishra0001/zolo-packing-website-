import { useCallback } from "react";
import { useAuthSession } from "./AuthContext";
import type { AuthTab, PendingAction } from "@/lib/auth/types";

/**
 * Wraps a protected action (Add to Cart, Buy Now, Customize, Request Quote,
 * Save Design, Wishlist). If the user is a guest, the auth modal opens and
 * the action is stashed; on successful auth the original action resumes
 * automatically (see AuthContext.handleAuthenticated).
 *
 * Usage:
 *   const guard = useAuthGuard();
 *   <button onClick={() => guard(() => addToCart(item), { label: "add to cart" })}>
 */
export function useAuthGuard() {
  const { isAuthenticated, openAuthModal } = useAuthSession();

  return useCallback(
    (action: () => void, opts?: { label?: string; tab?: AuthTab }) => {
      if (isAuthenticated) {
        action();
        return;
      }
      const pending: PendingAction = { label: opts?.label, run: action };
      openAuthModal({ tab: opts?.tab ?? "login", pendingAction: pending });
    },
    [isAuthenticated, openAuthModal],
  );
}

/**
 * Declarative wrapper for a single protected trigger. Renders a button that
 * either runs the action (authenticated) or opens the auth modal (guest).
 */
export function AuthGuard({
  action,
  label,
  className,
  children,
  ...buttonProps
}: {
  action: () => void;
  label?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const guard = useAuthGuard();
  return (
    <button
      {...buttonProps}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        guard(action, { label });
      }}
    >
      {children}
    </button>
  );
}
