import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import type { Permission, Role } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listRoles, setRolePermissions } from '@/services/roleService'
import { ROLE_ACCENT, ROLE_LABEL } from '@/lib/permissions'
import { cn } from '@/lib/utils'

const ROLES: Role[] = ['owner', 'admin', 'doctor', 'therapist', 'nurse', 'pharmacist', 'receptionist', 'accountant']

const GROUPS: { title: string; description: string; permissions: Permission[] }[] = [
  {
    title: 'Patient records',
    description: 'Who can see and change patient demographics and clinical notes.',
    permissions: ['patient.view', 'patient.create', 'patient.edit', 'patient.clinical.view', 'patient.clinical.edit'],
  },
  {
    title: 'Scheduling',
    description: 'Appointment booking and front-desk check-in.',
    permissions: ['appointment.view', 'appointment.create', 'appointment.checkin'],
  },
  {
    title: 'Clinical workflow',
    description: 'Consultations, prescriptions, vitals and nursing tasks.',
    permissions: ['consultation.manage', 'prescription.create', 'vitals.record', 'nursing.tasks'],
  },
  {
    title: 'Rehabilitation',
    description: 'Rehab plans, therapy sessions and progress tracking.',
    permissions: ['rehab.plan.view', 'rehab.plan.manage', 'therapy.session.manage', 'therapy.progress.view'],
  },
  {
    title: 'Pharmacy',
    description: 'Inventory, dispensing and point of sale.',
    permissions: ['prescription.dispense', 'pharmacy.inventory', 'pharmacy.pos'],
  },
  {
    title: 'Finance',
    description: 'Invoices, payments, expenses and financial reporting.',
    permissions: ['billing.view', 'billing.manage', 'payments.manage', 'expenses.manage', 'finance.reports'],
  },
  {
    title: 'Operations & analytics',
    description: 'Bed management and business intelligence.',
    permissions: ['beds.view', 'beds.manage', 'analytics.business', 'analytics.operational'],
  },
  {
    title: 'System administration',
    description: 'Accounts, roles, branches, audit and configuration.',
    permissions: ['staff.manage', 'roles.manage', 'branches.manage', 'audit.view', 'settings.manage'],
  },
]

const PERMISSION_LABEL: Record<string, string> = {
  'patient.view': 'View patients',
  'patient.create': 'Register patients',
  'patient.edit': 'Edit patient details',
  'patient.clinical.view': 'View clinical records',
  'patient.clinical.edit': 'Edit clinical records',
  'appointment.view': 'View appointments',
  'appointment.create': 'Book appointments',
  'appointment.checkin': 'Check patients in',
  'consultation.manage': 'Record consultations',
  'prescription.create': 'Write prescriptions',
  'prescription.dispense': 'Dispense prescriptions',
  'vitals.record': 'Record vitals',
  'nursing.tasks': 'Manage nursing tasks',
  'rehab.plan.view': 'View rehab plans',
  'rehab.plan.manage': 'Create & edit rehab plans',
  'therapy.session.manage': 'Record therapy sessions',
  'therapy.progress.view': 'View therapy progress',
  'pharmacy.inventory': 'Manage inventory',
  'pharmacy.pos': 'Operate point of sale',
  'billing.view': 'View billing',
  'billing.manage': 'Create & edit invoices',
  'payments.manage': 'Record payments',
  'expenses.manage': 'Manage expenses',
  'finance.reports': 'Financial reports',
  'beds.view': 'View beds',
  'beds.manage': 'Assign beds',
  'analytics.business': 'Business analytics',
  'analytics.operational': 'Operational analytics',
  'staff.manage': 'Manage staff accounts',
  'roles.manage': 'Manage roles',
  'branches.manage': 'Manage branches',
  'audit.view': 'View audit log',
  'settings.manage': 'System configuration',
}

export default function AdminRoles() {
  const toast = useToast()
  const [selected, setSelected] = React.useState<Role>('therapist')
  const [matrix, setMatrix] = React.useState<Record<Role, Permission[]> | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // The live matrix, from the database. `ROLE_PERMISSIONS` in
  // `src/lib/permissions.ts` is only a static fallback for the signed-out
  // shell — what an administrator edits here is what the backend enforces.
  const { data: roles, loading, error, refetch } = useQuery(() => listRoles(), [])

  React.useEffect(() => {
    if (!roles) return
    setMatrix(
      Object.fromEntries(roles.map((r) => [r.id, r.permissions])) as Record<Role, Permission[]>,
    )
    setDirty(false)
  }, [roles])

  const headcounts = React.useMemo(
    () => Object.fromEntries((roles ?? []).map((r) => [r.id, r.headcount])) as Record<Role, number>,
    [roles],
  )

  const granted = new Set(matrix?.[selected] ?? [])
  const headcount = headcounts[selected] ?? 0

  function toggle(permission: Permission, on: boolean) {
    setMatrix((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            [selected]: on
              ? [...prev[selected], permission]
              : prev[selected].filter((p) => p !== permission),
          },
    )
    setDirty(true)
  }

  async function save() {
    if (!matrix) return
    setSaving(true)
    try {
      // The whole set, not a diff: the server swaps it in one transaction, so
      // the role is never observable half-updated.
      await setRolePermissions(selected, matrix[selected])
      toast.success(
        'Permissions saved',
        `${ROLE_LABEL[selected]} now has ${matrix[selected].length} permissions. Anyone holding the role is affected on their next request.`,
      )
      setDirty(false)
      refetch()
    } catch (err) {
      toast.error('Could not save the matrix', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="The permission matrix that drives navigation and route access across the platform."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Roles & Permissions' }]}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!dirty}
              onClick={() => {
                refetch()
                toast.info('Changes discarded', 'The matrix has been reloaded from the server.')
              }}
            >
              Discard
            </Button>
            <Button disabled={!dirty} loading={saving} onClick={save}>
              Save changes
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState message={error} title="Could not load the permission matrix" onRetry={refetch} />
      ) : loading || !matrix ? (
        <LoadingState label="Loading the permission matrix" />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <SectionCard title="Roles" description="Select a role to edit." bodyClassName="p-2">
          <ul className="space-y-1">
            {ROLES.map((role) => {
              const isActive = role === selected
              return (
                <li key={role}>
                  <button
                    type="button"
                    onClick={() => setSelected(role)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors',
                      isActive ? 'bg-accent/10 text-accent' : 'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">{ROLE_LABEL[role]}</span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {matrix?.[role].length ?? 0} permissions
                      </span>
                    </span>
                    <span className="num shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                      {headcounts[role] ?? 0}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard
            title={ROLE_LABEL[selected]}
            description={`${headcount} staff member${headcount === 1 ? '' : 's'} assigned · ${matrix?.[selected].length ?? 0} of ${
              Object.keys(PERMISSION_LABEL).length
            } permissions granted.`}
            action={<Badge className={cn('border', ROLE_ACCENT[selected])}>{ROLE_LABEL[selected]}</Badge>}
          >
            <div className="space-y-6">
              {GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="mb-3">
                    <h3 className="text-[13.5px] font-semibold">{group.title}</h3>
                    <p className="text-[12px] text-muted-foreground">{group.description}</p>
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {group.permissions.map((permission) => {
                      const on = granted.has(permission)
                      return (
                        <li
                          key={permission}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors',
                            on ? 'border-accent/25 bg-accent/[0.05]' : 'border-border',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">
                              {PERMISSION_LABEL[permission]}
                            </span>
                            <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                              {permission}
                            </span>
                          </span>
                          <Switch
                            checked={on}
                            onCheckedChange={(v) => toggle(permission, v)}
                            aria-label={PERMISSION_LABEL[permission]}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Matrix overview" description="Every role against every permission group.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 text-left text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Permission group
                    </th>
                    {ROLES.map((role) => (
                      <th
                        key={role}
                        className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {ROLE_LABEL[role].split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GROUPS.map((group) => (
                    <tr key={group.title} className="border-b border-border/70 last:border-0">
                      <td className="py-2.5 pr-4 text-[13px] font-medium">{group.title}</td>
                      {ROLES.map((role) => {
                        const count = group.permissions.filter((p) => matrix?.[role].includes(p)).length
                        const all = count === group.permissions.length
                        return (
                          <td key={role} className="px-2 py-2.5 text-center">
                            {count === 0 ? (
                              <Minus className="mx-auto size-3.5 text-muted-foreground/45" />
                            ) : all ? (
                              <Check className="mx-auto size-4 text-success" strokeWidth={2.6} />
                            ) : (
                              <span className="num text-[11.5px] font-semibold text-warning">
                                {count}/{group.permissions.length}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}
    </>
  )
}
