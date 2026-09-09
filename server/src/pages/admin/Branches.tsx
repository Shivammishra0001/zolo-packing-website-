import * as React from 'react'
import { AlertTriangle, Building2, Check, MapPin, Phone } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Switch } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listBranches, updateBranch, type BranchRecord } from '@/services/branchService'
import { cn } from '@/lib/utils'

export default function AdminBranches() {
  const toast = useToast()
  const [branches, setBranches] = React.useState<BranchRecord[]>([])
  const [selectedId, setSelectedId] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const { data, loading, error, refetch } = useQuery(() => listBranches(), [])

  React.useEffect(() => {
    if (!data) return
    setBranches(data)
    // Open on the first site still needing setup, which is what the screen was
    // built to draw attention to.
    setSelectedId((current) =>
      current && data.some((b) => b.id === current)
        ? current
        : (data.find((b) => !b.configured) ?? data[0])?.id ?? '',
    )
  }, [data])

  const selected = branches.find((b) => b.id === selectedId)

  /** Edits are held locally until Save, so a half-typed field is not written. */
  function update<K extends keyof BranchRecord>(key: K, value: BranchRecord[K]) {
    setBranches((prev) => prev.map((b) => (b.id === selectedId ? { ...b, [key]: value } : b)))
  }

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      await updateBranch(selected.id, {
        name: selected.name,
        city: selected.city,
        address: selected.address,
        phone: selected.phone,
        opensAt: selected.opensAt ?? undefined,
        closesAt: selected.closesAt ?? undefined,
        beds: selected.beds,
        configured: true,
        services: selected.services,
      })
      toast.success('Branch saved', `${selected.name} is now fully configured.`)
      refetch()
    } catch (err) {
      toast.error('Could not save that branch', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Branch settings"
        description="Operating hours, contact details and the services each site offers."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Branch Settings' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Branches" value={branches.length} hint="Every configured site" />
        <StatTile label="Total beds" value={branches.reduce((a, b) => a + b.beds, 0)} tone="info" />
        <StatTile
          label="Pending configuration"
          value={branches.filter((b) => !b.configured).length}
          tone={branches.some((b) => !b.configured) ? 'warning' : 'success'}
        />
      </div>

      {error ? (
        <ErrorState message={error} title="Could not load branches" onRetry={refetch} />
      ) : loading || !selected ? (
        <LoadingState label="Loading branches" />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => setSelectedId(branch.id)}
              className={cn(
                'w-full rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated',
                branch.id === selectedId ? 'border-accent bg-accent/[0.06]' : 'border-border bg-card',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Building2 className="size-4" />
                </span>
                {branch.configured ? (
                  <Badge variant="success" dot>
                    Configured
                  </Badge>
                ) : (
                  <Badge variant="warning" dot pulse>
                    Setup pending
                  </Badge>
                )}
              </div>
              <p className="mt-3 text-[13.5px] font-semibold leading-snug">{branch.name}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {branch.city} · {branch.beds} beds · {branch.services.length} services
              </p>
            </button>
          ))}
        </div>

        <div className="space-y-5">
          {!selected.configured && (
            <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/[0.07] px-4 py-3.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="text-[13px] font-semibold">This branch still needs consultation hours and tariffs</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Appointments cannot be booked at {selected.name} until the setup below is completed and saved.
                </p>
              </div>
            </div>
          )}

          <SectionCard
            title={selected.name}
            description="Details shown to patients and used for scheduling."
            action={
              <Button size="sm" loading={saving} onClick={save}>
                <Check />
                Save branch
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Branch name" htmlFor="branch-name">
                <Input id="branch-name" value={selected.name} onChange={(e) => update('name', e.target.value)} />
              </Field>
              <Field label="City" htmlFor="branch-city">
                <Input id="branch-city" value={selected.city} onChange={(e) => update('city', e.target.value)} />
              </Field>
            </div>

            <Field label="Address" htmlFor="branch-address" className="mt-4">
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="branch-address"
                  className="pl-9"
                  value={selected.address}
                  onChange={(e) => update('address', e.target.value)}
                />
              </div>
            </Field>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Reception phone" htmlFor="branch-phone">
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="branch-phone"
                    className="pl-9"
                    value={selected.phone}
                    onChange={(e) => update('phone', e.target.value)}
                  />
                </div>
              </Field>
              <Field label="Opens at" htmlFor="branch-open">
                <Input
                  id="branch-open"
                  type="time"
                  value={selected.opensAt ?? ''}
                  onChange={(e) => update('opensAt', e.target.value)}
                />
              </Field>
              <Field label="Closes at" htmlFor="branch-close">
                <Input
                  id="branch-close"
                  type="time"
                  value={selected.closesAt ?? ''}
                  onChange={(e) => update('closesAt', e.target.value)}
                />
              </Field>
            </div>

            <Field label="Licensed beds" htmlFor="branch-beds" className="mt-4 max-w-[200px]">
              <Input
                id="branch-beds"
                type="number"
                min={0}
                value={selected.beds}
                onChange={(e) => update('beds', Number(e.target.value))}
              />
            </Field>
          </SectionCard>

          <SectionCard title="Services offered" description="Turn a service on to make it bookable at this branch.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {[
                'OPD',
                'IPD',
                'Physiotherapy',
                'Occupational Therapy',
                'Neuro Rehabilitation',
                'Speech Therapy',
                'Cardiac Rehab',
                'Hydrotherapy',
                'Pharmacy',
                'Diagnostics',
              ].map((service) => {
                const on = selected.services.includes(service)
                return (
                  <li
                    key={service}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors',
                      on ? 'border-accent/25 bg-accent/[0.05]' : 'border-border',
                    )}
                  >
                    <span className="text-[13px] font-medium">{service}</span>
                    <Switch
                      checked={on}
                      aria-label={service}
                      onCheckedChange={(v) =>
                        update(
                          'services',
                          v ? [...selected.services, service] : selected.services.filter((s) => s !== service),
                        )
                      }
                    />
                  </li>
                )
              })}
            </ul>
          </SectionCard>
        </div>
      </div>
      )}
    </>
  )
}
