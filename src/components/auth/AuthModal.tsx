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
 * scroll lock. Bottom sheet on phones, centred card on desktop.
 * Login / Create Account tabs.
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
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={cn(
              // Cap to the viewport and scroll internally so a tall register
              // form is never clipped on small/landscape phones. Bottom sheet
              // on phones (rounded top only), centred card on larger screens.
              "card relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[16px] rounded-b-none outline-none sm:rounded-[12px]",
            )}
          >
            <button
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-dark-500 transition-colors duration-150 hover:bg-dark-100 hover:text-dark-800"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>

            <div className="relative px-5 pb-6 pt-7 sm:px-8 sm:pb-8">
              {/* Header */}
              <div className="mb-5 flex flex-col items-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <Package className="h-6 w-6" aria-hidden />
                </div>
                <h2 id={titleId} className="h3 text-dark-900">
                  {tab === "login" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="mt-1 text-sm text-dark-500">
                  {tab === "login"
                    ? "Sign in to order, quote and save designs."
                    : "Join Zolo Packaging to order and request quotes."}
                </p>
              </div>

              {/* Tabs: underline style, green active */}
              <div
                role="tablist"
                aria-label="Authentication"
                className="mb-6 grid grid-cols-2 border-b border-dark-200"
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
                        "relative -mb-px h-11 text-sm font-bold transition-colors duration-150",
                        selected ? "text-green-600" : "text-dark-500 hover:text-dark-800",
                      )}
                    >
                      <span>{t.label}</span>
                      {selected && (
                        <motion.span
                          layoutId="auth-tab-underline"
                          className="absolute inset-x-0 bottom-0 h-0.5 bg-green-500"
                          transition={{ duration: 0.2, ease: "easeOut" }}
                        />
                      )}
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
