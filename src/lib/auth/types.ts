// ---------- Auth module types ----------
// Frontend-only contracts. The backend integration replaces the service
// implementations, not these shapes.

/** The only two roles in the system. */
export type UserRole = "admin" | "buyer";

/** Authenticated user as the backend will return it (never includes secrets) */
export interface AuthUser {
  id: string;
  email: string;
  phone: string;
  state?: string;
  /** Drives role-based routing + guards. Defaults to "buyer" when absent. */
  role?: UserRole;
  firstName?: string;
  lastName?: string;
  company?: string;
  gstin?: string;
  /**
   * Links a buyer to their customer record so the buyer dashboard can scope
   * data to THIS customer only. Never used for admin users.
   */
  customerId?: string;
}

/** Home route for a role after login. */
export function homeRouteForRole(role: UserRole | undefined): string {
  return role === "admin" ? "/admin/dashboard" : "/account/dashboard";
}

export interface LoginCredentials {
  /** Email address or Indian mobile number */
  identifier: string;
  password: string;
  /** Asks the backend for a longer-lived session — never persisted client-side */
  rememberMe: boolean;
}

export interface RegisterData {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}

export type AuthTab = "login" | "register";

export type PasswordStrengthLevel = "weak" | "medium" | "strong" | "very-strong";

export interface PasswordRuleResult {
  id: string;
  label: string;
  passed: boolean;
}

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  /** 0–4, drives the meter fill */
  score: number;
  rules: PasswordRuleResult[];
}

/**
 * The action a guest attempted before authenticating (Add to Cart, Request
 * Quote, …). Stored while the modal is open and resumed after a successful
 * login/registration once the backend is connected.
 */
export type PendingAction = {
  /** Human label for messaging, e.g. "add this item to your wishlist" */
  label?: string;
  run: () => void;
};
