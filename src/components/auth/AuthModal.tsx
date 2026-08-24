import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Package, X } from "lucide-react";
import { cn } from "@/utils/cn";
import type { AuthTab } from "@/lib/auth/types";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";

interface AuthModalProps {
  open: boolean;
  initialTab: AuthTab;
  onClose: () => void;
}

const TABS: { id: AuthTab; label: string }[] = [
  { id: "login", label: "Login" },
  { id: "register", label: "Create Account" },
];

/**
 * Accessible auth dialog: focus trap, Escape to close, backdrop click,
 * scroll lock, and glassmorphism styling. Login / Create Account tabs.
 */
export function AuthModal({ open, initialTab, onClose }: AuthModalProps) {
  const [tab, setTab] = useState<AuthTab>(initialTab);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Sync to the tab requested when the modal was opened
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Escape to close + lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Move focus into the dialog when it opens
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Simple focus trap: keep Tab within the dialog
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />

          {/* Dialog */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDownTrap}
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className={cn(
              "relative w-full max-w-md overflow-hidden rounded-t-3xl outline-none sm:rounded-3xl",
              // Glassmorphism
              "border border-white/40 bg-white/80 shadow-2xl backdrop-blur-2xl",
              "dark:border-white/10 dark:bg-dark-900/80",
            )}
          >
            {/* Decorative brand glow (kept subtle) */}
            <div
              className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-primary-400/30 blur-3xl"
              aria-hidden
            />

            <button
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-dark-500 transition-colors hover:bg-dark-100/70 hover:text-dark-800 dark:text-dark-400 dark:hover:bg-dark-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>

            <div className="relative px-6 pb-6 pt-7 sm:px-8 sm:pb-8">
              {/* Header */}
              <div className="mb-5 flex flex-col items-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-amber-400 text-white shadow-lg shadow-primary-500/30">
                  <Package className="h-6 w-6" aria-hidden />
                </div>
                <h2 id={titleId} className="font-display text-xl font-extrabold text-dark-900 dark:text-white">
                  {tab === "login" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="mt-1 text-sm text-dark-500 dark:text-dark-400">
                  {tab === "login"
                    ? "Sign in to order, quote and save designs."
                    : "Join Zolo Packaging to order and request quotes."}
                </p>
              </div>

              {/* Tabs */}
              <div
                role="tablist"
                aria-label="Authentication"
                className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-dark-100/70 p-1 dark:bg-dark-800/70"
              >
                {TABS.map((t) => {
                  const selected = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      id={`tab-${t.id}`}
                      aria-selected={selected}
                      aria-controls={`panel-${t.id}`}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "relative h-9 rounded-lg text-sm font-bold transition-colors",
                        selected ? "text-dark-900 dark:text-white" : "text-dark-500 hover:text-dark-700 dark:text-dark-400",
                      )}
                    >
                      {selected && (
                        <motion.span
                          layoutId="auth-tab-pill"
                          className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-dark-700"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Panels */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  role="tabpanel"
                  id={`panel-${tab}`}
                  aria-labelledby={`tab-${tab}`}
                  initial={{ opacity: 0, x: tab === "login" ? -12 : 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: tab === "login" ? 12 : -12 }}
                  transition={{ duration: 0.2 }}
                >
                  {tab === "login" ? <LoginForm /> : <RegisterForm />}
                </motion.div>
              </AnimatePresence>

              <p className="mt-5 text-center text-xs leading-relaxed text-dark-400">
                Your password is only used to sign in and is never stored in your browser.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
