import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Minus, Plus, Receipt, Search, ShoppingCart, Trash2, X } from 'lucide-react'
import type { PaymentMethod } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { Separator } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useQuery, useDebounced } from '@/hooks/useApi'
import { listProducts, createSale, type Sale } from '@/services/posService'
import type { MedicineRecord } from '@/services/inventoryService'
import { listPatients } from '@/services/patientService'
import { cn, inr } from '@/lib/utils'

interface CartLine {
  medicine: MedicineRecord
  quantity: number
}

const METHODS: PaymentMethod[] = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Insurance']

/** GST rate the till applies. The backend computes the authoritative figure. */
const GST_RATE = 0.12

export default function PharmacyPOS() {
  const toast = useToast()
  const [query, setQuery] = React.useState('')
  const [cart, setCart] = React.useState<CartLine[]>([])
  const [discountPct, setDiscountPct] = React.useState(0)
  const [method, setMethod] = React.useState<PaymentMethod>('UPI')
  const [patientId, setPatientId] = React.useState('walk-in')
  const [receiptOpen, setReceiptOpen] = React.useState(false)
  const [checkingOut, setCheckingOut] = React.useState(false)
  const [lastBill, setLastBill] = React.useState<Sale | null>(null)

  // Search runs in SQL, debounced so a fast typist does not fire a request a
  // keystroke.
  const debounced = useDebounced(query, 250)
  const { data: matches } = useQuery(() => listProducts(debounced, 8), [debounced], {
    enabled: debounced.trim().length > 0,
  })
  const results = matches ?? []

  // The quick-pick shelf, and the patient list for attaching a sale to a record.
  const { data: catalogue } = useQuery(() => listProducts(undefined, 100), [])
  const quickPicks = (catalogue ?? []).filter((m) => m.status === 'In Stock').slice(0, 8)
  const { data: patientPage } = useQuery(() => listPatients({ limit: 20, sort: 'name' }), [])
  const patients = patientPage?.items ?? []

  function addToCart(medicine: MedicineRecord) {
    if (medicine.status === 'Out of Stock') {
      toast.error('Out of stock', `${medicine.name} cannot be sold until the next delivery arrives.`)
      return
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.medicine.id === medicine.id)
      if (existing) {
        if (existing.quantity >= medicine.quantity) {
          toast.error('Not enough stock', `Only ${medicine.quantity} units of ${medicine.name} are on hand.`)
          return prev
        }
        return prev.map((l) => (l.medicine.id === medicine.id ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...prev, { medicine, quantity: 1 }]
    })
    setQuery('')
  }

  function changeQuantity(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.medicine.id === id
            ? { ...l, quantity: Math.max(0, Math.min(l.medicine.quantity, l.quantity + delta)) }
            : l,
        )
        .filter((l) => l.quantity > 0),
    )
  }

  // A running total for the operator. The till recomputes all of it server-side
  // from the batch it draws, so nothing here is sent or trusted as money.
  const subtotal = cart.reduce((a, l) => a + Number(l.medicine.mrp) * l.quantity, 0)
  const discount = Math.round((subtotal * discountPct) / 100)
  const taxable = subtotal - discount
  const gst = Math.round(taxable * GST_RATE)
  const total = taxable + gst

  async function checkout() {
    if (cart.length === 0) return

    setCheckingOut(true)
    try {
      const sale = await createSale({
        items: cart.map((l) => ({ medicineId: l.medicine.id, quantity: l.quantity })),
        discountPercent: discountPct,
        paymentMethod: method,
        patientId: patientId === 'walk-in' ? undefined : patientId,
      })
      setLastBill(sale)
      setReceiptOpen(true)
      toast.success('Sale completed', `${inr(Number(sale.total))} collected via ${sale.paymentMethod}.`)
      setCart([])
      setDiscountPct(0)
    } catch (err) {
      // Insufficient or expired stock comes back as a 409; nothing was sold.
      toast.error('Sale failed', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setCheckingOut(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Point of sale"
        description="Over-the-counter sales and prescription pickups."
        crumbs={[{ label: 'Pharmacist', to: '/pharmacist/dashboard' }, { label: 'Point of Sale' }]}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        {/* ------------------------------ Catalogue ------------------------------ */}
        <div className="space-y-5">
          <SectionCard title="Find a medicine" description="Search by brand, generic name or category.">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Start typing — e.g. Paracetamol, analgesic, Cipla"
                className="h-11 pl-9 pr-9 text-[14px]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <AnimatePresence mode="wait">
              {query ? (
                <motion.ul
                  key="results"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 space-y-2"
                >
                  {results.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
                      No medicine matches “{query}”.
                    </li>
                  ) : (
                    results.map((medicine) => (
                      <li key={medicine.id}>
                        <button
                          type="button"
                          onClick={() => addToCart(medicine)}
                          disabled={medicine.status === 'Out of Stock'}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-lg border border-border px-3.5 py-3 text-left transition-all duration-150 hover:border-accent/40 hover:bg-accent/[0.05]',
                            medicine.status === 'Out of Stock' && 'cursor-not-allowed opacity-55',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium">{medicine.name}</p>
                            <p className="truncate text-[11.5px] text-muted-foreground">
                              {medicine.genericName} · rack {medicine.rackLocation} · {medicine.quantity} on hand
                            </p>
                          </div>
                          <StatusBadge status={medicine.status} showDot={false} />
                          <span className="num shrink-0 text-[13.5px] font-semibold">
                            {inr(Number(medicine.mrp), { decimals: true })}
                          </span>
                          <Plus className="size-4 shrink-0 text-accent" />
                        </button>
                      </li>
                    ))
                  )}
                </motion.ul>
              ) : (
                <motion.div key="quick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Frequently dispensed
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {quickPicks.map((medicine) => (
                      <button
                        key={medicine.id}
                        type="button"
                        onClick={() => addToCart(medicine)}
                        className="rounded-xl border border-border p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
                      >
                        <p className="truncate text-[13px] font-medium">{medicine.name}</p>
                        <p className="truncate text-[11.5px] text-muted-foreground">{medicine.category}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="num text-[13.5px] font-semibold">{inr(Number(medicine.mrp), { decimals: true })}</span>
                          <Badge variant="outline">{medicine.quantity} left</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </SectionCard>
        </div>

        {/* -------------------------------- Cart -------------------------------- */}
        <aside>
          <div className="sticky top-24 rounded-xl border border-border bg-card shadow-card">
            <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <ShoppingCart className="size-4 text-accent" />
                Cart
                {cart.length > 0 && <Badge variant="accent">{cart.length}</Badge>}
              </h2>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setCart([])}>
                  <Trash2 />
                  Clear
                </Button>
              )}
            </header>

            <div className="max-h-[38vh] overflow-y-auto p-3">
              {cart.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <ShoppingCart className="mx-auto mb-2 size-7 text-muted-foreground/60" />
                  <p className="text-[13px] font-medium">Cart is empty</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Search above or pick from the frequently dispensed list.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {cart.map((line) => (
                      <motion.li
                        key={line.medicine.id}
                        layout
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 12 }}
                        transition={{ duration: 0.18 }}
                        className="rounded-lg border border-border p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium">{line.medicine.name}</p>
                            <p className="num text-[11.5px] text-muted-foreground">
                              {inr(line.medicine.mrp, { decimals: true })} each
                            </p>
                          </div>
                          <span className="num shrink-0 text-[13.5px] font-semibold">
                            {inr(line.medicine.mrp * line.quantity)}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label="Decrease quantity"
                            onClick={() => changeQuantity(line.medicine.id, -1)}
                          >
                            <Minus />
                          </Button>
                          <span className="num w-8 text-center text-[13px] font-semibold">{line.quantity}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label="Increase quantity"
                            onClick={() => changeQuantity(line.medicine.id, 1)}
                          >
                            <Plus />
                          </Button>
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {line.medicine.quantity - line.quantity} left in stock
                          </span>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            <div className="space-y-4 border-t border-border p-5">
              <Field label="Bill to">
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walk-in">Walk-in customer</SelectItem>
                    {patients.slice(0, 8).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {p.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Discount" htmlFor="discount" hint="Percent off subtotal">
                  <Input
                    id="discount"
                    type="number"
                    min={0}
                    max={50}
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Math.max(0, Math.min(50, Number(e.target.value))))}
                  />
                </Field>
                <Field label="Payment method">
                  <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Separator />

              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="num">{inr(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Discount ({discountPct}%)</dt>
                  <dd className="num text-success">−{inr(discount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">GST (12%)</dt>
                  <dd className="num">{inr(gst)}</dd>
                </div>
                <Separator className="my-2" />
                <div className="flex items-baseline justify-between">
                  <dt className="text-[14px] font-semibold">Total</dt>
                  <dd className="num text-xl font-bold">{inr(total)}</dd>
                </div>
              </dl>

              <Button
                size="lg"
                className="w-full"
                disabled={cart.length === 0}
                loading={checkingOut}
                onClick={() => void checkout()}
              >
                <Receipt />
                Complete sale
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* ------------------------------- Receipt ------------------------------- */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Sale completed</DialogTitle>
            <DialogDescription>
              {lastBill?.id} · paid by {lastBill?.paymentMethod}
            </DialogDescription>
          </DialogHeader>

          {lastBill && (
            <>
              {/* Every figure below is the till's, not the cart's — a line that
                  spanned two batches appears here as the two lines it became. */}
              <ul className="space-y-2">
                {lastBill.items.map((line) => (
                  <li key={line.id} className="flex justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">
                      {line.medicine} <span className="text-muted-foreground">× {line.quantity}</span>
                      {line.batchNumber && (
                        <span className="num ml-1 text-[11px] text-muted-foreground">
                          ({line.batchNumber})
                        </span>
                      )}
                    </span>
                    <span className="num shrink-0">{inr(Number(line.lineTotal))}</span>
                  </li>
                ))}
              </ul>
              <Separator />
              <dl className="space-y-1.5 text-[12.5px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="num">{inr(Number(lastBill.subtotal))}</dd>
                </div>
                {Number(lastBill.discount) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Discount ({Number(lastBill.discountPercent)}%)
                    </dt>
                    <dd className="num text-success">−{inr(Number(lastBill.discount))}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">GST ({Number(lastBill.taxPercent)}%)</dt>
                  <dd className="num">{inr(Number(lastBill.tax))}</dd>
                </div>
              </dl>
              <Separator />
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold">Total paid</span>
                <span className="num text-xl font-bold">{inr(Number(lastBill.total))}</span>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptOpen(false)}>
              Close
            </Button>
            <Button onClick={() => toast.success('Receipt printed', 'Sent to the counter printer.')}>
              Print receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
