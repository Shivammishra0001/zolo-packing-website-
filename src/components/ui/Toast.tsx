import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/utils/cn";

// ---------- Minimal toast system (no dependency) ----------

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  body?: string;
}

interface ToastApi {
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const VARIANT_META: Record<ToastVariant, { icon: typeof Info; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: "text-emerald-500" },
  error: { icon: XCircle, iconClass: "text-red-500" },
  info: { icon: Info, iconClass: "text-sky-500" },
};

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, title: string, body?: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, variant, title, body }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, b) => push("success", t, b),
      error: (t, b) => push("error", t, b),
      info: (t, b) => push("info", t, b),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const meta = VARIANT_META[t.variant];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                role="status"
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-dark-200 bg-white/95 p-3.5 shadow-lg backdrop-blur",
                  "dark:border-dark-700 dark:bg-dark-900/95",
                )}
              >
                <meta.icon className={cn("mt-0.5 h-5 w-5 shrink-0", meta.iconClass)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-dark-900 dark:text-white">{t.title}</p>
                  {t.body && (
                    <p className="mt-0.5 text-xs leading-relaxed text-dark-500 dark:text-dark-300">{t.body}</p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-dark-400 hover:bg-dark-50 hover:text-dark-700 dark:hover:bg-dark-800"
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
