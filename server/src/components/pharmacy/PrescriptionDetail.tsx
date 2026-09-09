import * as React from 'react'
import { Link } from 'react-router-dom'
import { Pill } from 'lucide-react'
import type { Prescription } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { useQuery } from '@/hooks/useApi'
import { listMedicines } from '@/services/inventoryService'
import { formatDate, inr } from '@/lib/utils'

export function PrescriptionDetail({
  prescription,
  onOpenChange,
  footer,
}: {
  prescription: Prescription | null
  onOpenChange: (open: boolean) => void
  footer?: React.ReactNode
}) {
  // Prices come from the live catalogue, so an indicative total reflects what
  // the pharmacy would actually charge. The dialog renders without them if the
  // caller lacks inventory access — a doctor sees the prescription, not the bill.
  const { data } = useQuery(() => listMedicines({ limit: 500 }), [], {
    enabled: prescription !== null,
  })
  const medicineFor = React.useMemo(() => {
    const byName = new Map((data?.items ?? []).map((m) => [m.name, m]))
    return (name: string) => byName.get(name)
  }, [data])

  if (!prescription) return null

  const total = prescription.items.reduce(
    (acc, item) => acc + Number(medicineFor(item.medicine)?.mrp ?? 0) * item.quantity,
    0,
  )

  return (
    <Dialog open={prescription !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="num">{prescription.id}</DialogTitle>
            <StatusBadge status={prescription.status} />
            {prescription.priority === 'Urgent' && <Badge variant="danger">Urgent</Badge>}
          </div>
          <DialogDescription>
            <Link to={`/patients/${prescription.patientId}`} className="font-medium text-accent hover:underline">
              {prescription.patientName}
            </Link>{' '}
            · {prescription.patientId} · prescribed by {prescription.doctor} on {formatDate(prescription.date)}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {prescription.items.map((item, i) => {
            const med = medicineFor(item.medicine)
            return (
              <li key={i} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13.5px] font-semibold">
                      <Pill className="size-3.5 text-accent" />
                      {item.medicine}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {item.dosage} · {item.frequency} · {item.duration}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-[13px] font-semibold">Qty {item.quantity}</p>
                    {med && (
                      <p className="num text-[11.5px] text-muted-foreground">
                        {inr(Number(med.mrp) * item.quantity)}
                      </p>
                    )}
                  </div>
                </div>

                {item.instructions && (
                  <p className="mt-2.5 rounded-lg bg-muted/55 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                    {item.instructions}
                  </p>
                )}

                {med && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <StatusBadge status={med.status} showDot={false} />
                    <span className="num text-[11.5px] text-muted-foreground">
                      {med.quantity} units on hand · batch {med.batch} · rack {med.rackLocation}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between rounded-lg bg-muted/55 px-4 py-3">
          <span className="text-[13px] font-medium">Estimated total</span>
          <span className="num text-lg font-bold">{inr(total)}</span>
        </div>

        <DialogFooter>
          {footer ?? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
