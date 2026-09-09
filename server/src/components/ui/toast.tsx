import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  title: string
  description?: string
  tone: ToastTone
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; tone?: ToastTone }) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const TONE_STYLES: Record<ToastTone, { icon: React.ElementType; ring: string; iconClass: string }> = {
  success: { icon: CheckCircle2, ring: 'border-success/30', iconClass: 'text-success' },
  error: { icon: XCircle, ring: 'border-destructive/30', iconClass: 'text-destructive' },
  warning: { icon: AlertTriangle, ring: 'border-warning/35', iconClass: 'text-warning' },
  info: { icon: Info, ring: 'border-info/30', iconClass: 'text-info' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const counter = React.useRef(0)

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = React.useCallback(
    ({ title, description, tone = 'success' }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = ++counter.current
      setItems((prev) => [...prev.slice(-3), { id, title, description, tone }])
      window.setTimeout(() => dismiss(id), 4200)
    },
    [dismiss],
  )

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error' }),
      info: (title, description) => toast({ title, description, tone: 'info' }),
    }),
    [toast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const { icon: Icon, ring, iconClass } = TONE_STYLES[item.tone]
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, x: 24, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 16, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  'pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover p-3.5 shadow-pop',
                  ring,
                )}
              >
                <Icon className={cn('mt-0.5 size-[18px] shrink-0', iconClass)} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold leading-snug">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{item.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Dismiss notification"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
