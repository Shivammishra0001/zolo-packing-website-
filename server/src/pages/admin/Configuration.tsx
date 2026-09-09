import * as React from 'react'
import { Save } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Switch } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getSettings, updateSettings, type SettingsMap } from '@/services/settingsService'
import { SYSTEM_STATUS } from '@/data/operations'
import { cn } from '@/lib/utils'

interface ToggleSetting {
  key: string
  label: string
  detail: string
  on: boolean
}

const INITIAL_TOGGLES: ToggleSetting[] = [
  { key: 'sms', label: 'SMS appointment reminders', detail: 'Sent 24 hours before every scheduled appointment.', on: true },
  { key: 'email', label: 'Email visit summaries', detail: 'Emails the consultation summary once a doctor signs it off.', on: true },
  { key: 'therapyReminder', label: 'Therapy session reminders', detail: 'Notifies therapists 30 minutes before each session.', on: true },
  { key: 'lowStock', label: 'Low stock alerts', detail: 'Alerts the pharmacy when an item falls below its reorder threshold.', on: true },
  { key: 'overdue', label: 'Overdue payment escalation', detail: 'Notifies finance when an invoice passes 15 days overdue.', on: true },
  { key: 'walkIn', label: 'Allow walk-in registration', detail: 'Lets the front desk register patients without a prior appointment.', on: true },
  { key: 'selfCheckIn', label: 'Kiosk self check-in', detail: 'Patients check themselves in using the lobby kiosk.', on: false },
  { key: 'audit', label: 'Extended audit retention', detail: 'Keeps audit entries for 365 days instead of 90.', on: false },
]

export default function AdminConfiguration() {
  const toast = useToast()
  const [toggles, setToggles] = React.useState(INITIAL_TOGGLES)
  const [gst, setGst] = React.useState('')
  const [slotLength, setSlotLength] = React.useState('')
  const [currency, setCurrency] = React.useState('INR')
  const [invoicePrefix, setInvoicePrefix] = React.useState('')
  const [graceDays, setGraceDays] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Every value comes from PostgreSQL. The constants above are the field
  // labels and help text, not the data.
  const { data, loading, error, refetch } = useQuery(() => getSettings(), [])

  React.useEffect(() => {
    if (!data) return
    setToggles(INITIAL_TOGGLES.map((t) => ({ ...t, on: Boolean(data[t.key]) })))
    setGst(String(data.gst ?? ''))
    setSlotLength(String(data.slotLength ?? ''))
    setCurrency(String(data.currency ?? 'INR'))
    setInvoicePrefix(String(data.invoicePrefix ?? ''))
    setGraceDays(String(data.graceDays ?? ''))
    setDirty(false)
  }, [data])

  function toggle(key: string, on: boolean) {
    setToggles((prev) => prev.map((t) => (t.key === key ? { ...t, on } : t)))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    try {
      const values: SettingsMap = {
        ...Object.fromEntries(toggles.map((t) => [t.key, t.on])),
        gst: Number(gst),
        slotLength: Number(slotLength),
        currency,
        invoicePrefix,
        graceDays: Number(graceDays),
      }
      await updateSettings(values)
      setDirty(false)
      toast.success('Configuration saved', 'Changes apply to every branch immediately.')
      refetch()
    } catch (err) {
      toast.error('Could not save the configuration', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="System configuration"
        description="Scheduling defaults, billing rules and the notifications the platform sends."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Configuration' }]}
        actions={
          <Button
            disabled={!dirty}
            loading={saving}
            onClick={save}
          >
            <Save />
            Save configuration
          </Button>
        }
      />

      {error ? (
        <ErrorState message={error} title="Could not load the configuration" onRetry={refetch} />
      ) : loading ? (
        <LoadingState label="Loading configuration" />
      ) : (
        <>
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Scheduling" description="Defaults applied when booking new appointments.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default slot length" hint="Minutes per consultation slot.">
              <Select
                value={slotLength}
                onValueChange={(v) => {
                  setSlotLength(v)
                  setDirty(true)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['15', '20', '30', '45', '60'].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Therapy session length" hint="Used by the therapy scheduler.">
              <Select defaultValue="45" onValueChange={() => setDirty(true)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['30', '40', '45', '60'].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Billing" description="Invoice numbering, tax and payment terms." delay={0.05}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency">
              <Select
                value={currency}
                onValueChange={(v) => {
                  setCurrency(v)
                  setDirty(true)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">Indian Rupee (₹)</SelectItem>
                  <SelectItem value="USD">US Dollar ($)</SelectItem>
                  <SelectItem value="AED">UAE Dirham (د.إ)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="GST rate" htmlFor="gst" hint="Applied to therapy packages.">
              <div className="relative">
                <Input
                  id="gst"
                  type="number"
                  value={gst}
                  onChange={(e) => {
                    setGst(e.target.value)
                    setDirty(true)
                  }}
                  className="pr-8"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                  %
                </span>
              </div>
            </Field>
            <Field label="Invoice prefix" htmlFor="prefix">
              <Input
                id="prefix"
                value={invoicePrefix}
                onChange={(e) => {
                  setInvoicePrefix(e.target.value)
                  setDirty(true)
                }}
              />
            </Field>
            <Field label="Payment grace period" htmlFor="grace" hint="Days before an invoice is marked overdue.">
              <Input
                id="grace"
                type="number"
                value={graceDays}
                onChange={(e) => {
                  setGraceDays(e.target.value)
                  setDirty(true)
                }}
              />
            </Field>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Notifications & workflow"
        description="What the platform sends automatically, and which front-desk flows are enabled."
        className="mt-5"
        delay={0.1}
      >
        <ul className="grid gap-2 lg:grid-cols-2">
          {toggles.map((setting) => (
            <li
              key={setting.key}
              className={cn(
                'flex items-start justify-between gap-4 rounded-lg border px-4 py-3 transition-colors',
                setting.on ? 'border-accent/25 bg-accent/[0.05]' : 'border-border',
              )}
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{setting.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{setting.detail}</p>
              </div>
              <Switch
                checked={setting.on}
                onCheckedChange={(v) => toggle(setting.key, v)}
                aria-label={setting.label}
                className="mt-0.5 shrink-0"
              />
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Service health" description="Live status of the platform's background services." className="mt-5" delay={0.15}>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SYSTEM_STATUS.map((service) => (
            <li key={service.label} className="rounded-lg border border-border bg-muted/35 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium">{service.label}</p>
                <StatusBadge status={service.status} />
              </div>
              <p className="num mt-2 text-lg font-semibold">{service.uptime}</p>
              <p className="text-[11.5px] text-muted-foreground">30-day uptime</p>
            </li>
          ))}
        </ul>
      </SectionCard>
        </>
      )}
    </>
  )
}
