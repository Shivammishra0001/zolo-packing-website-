import * as React from 'react'
import { Check, Search, UserPlus, X } from 'lucide-react'
import type { Role } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useDebounced, useQuery } from '@/hooks/useApi'
import { getDashboard } from '@/services/adminService'
import { listBranches } from '@/services/branchService'
import {
  approveUser,
  createUser,
  listUsers,
  suspendUser,
  type StaffRecord,
} from '@/services/userService'
import { ROLE_ACCENT, ROLE_LABEL } from '@/lib/permissions'
import { cn } from '@/lib/utils'

const ROLES: Role[] = ['owner', 'admin', 'doctor', 'therapist', 'nurse', 'pharmacist', 'receptionist', 'accountant']

export default function AdminStaff() {
  const toast = useToast()
  const [query, setQuery] = React.useState('')
  const [roleFilter, setRoleFilter] = React.useState<'all' | Role>('all')
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [suspendTarget, setSuspendTarget] = React.useState<StaffRecord | null>(null)

  const [form, setForm] = React.useState({ name: '', email: '', role: 'therapist' as Role, department: '', branch: '' })

  // Filtered in PostgreSQL, not here: the search hits name, email, staff
  // number, designation and department across the whole directory rather than
  // whichever page happens to be loaded.
  const search = useDebounced(query, 250)
  const { data, loading, error, refetch } = useQuery(
    () => listUsers({ limit: 100, search: search || undefined, role: roleFilter === 'all' ? undefined : roleFilter }),
    [search, roleFilter],
  )
  const { data: branches } = useQuery(() => listBranches(), [])
  // Headcount by status is a grouped query, so the tiles stay right however
  // the directory is filtered below them.
  const { data: summary, refetch: refetchSummary } = useQuery(() => getDashboard(), [])

  const staff = data?.items ?? []
  const filtered = staff
  const branchOptions = branches ?? []

  async function approve(user: StaffRecord) {
    try {
      await approveUser(user.id)
      toast.success('Account approved', `${user.name} can now sign in as ${ROLE_LABEL[user.role]}.`)
      refetch()
      refetchSummary()
    } catch (err) {
      toast.error('Could not approve that account', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  async function suspend(user: StaffRecord) {
    try {
      await suspendUser(user.id)
      // Their token stays valid; the account behind it does not.
      toast.info('Account suspended', `${user.name} can no longer sign in.`)
      refetch()
      refetchSummary()
    } catch (err) {
      toast.error('Could not suspend that account', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await createUser({
        name: form.name,
        email: form.email,
        role: form.role,
        department: form.department || undefined,
        branchId: form.branch || undefined,
      })
      setInviteOpen(false)
      setForm({ name: '', email: '', role: 'therapist', department: '', branch: '' })
      // The temporary password is shown once, because this build has no mail
      // server to send an invitation through.
      toast.success(
        'Invitation created',
        `${created.user.name} is pending approval. Temporary password: ${created.temporaryPassword}`,
      )
      refetch()
      refetchSummary()
    } catch (err) {
      toast.error('Could not invite that person', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<StaffRecord>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar initials={row.initials} color={row.avatarColor} className="size-9" />
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{row.email}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => <Badge className={cn('border', ROLE_ACCENT[row.role])}>{ROLE_LABEL[row.role]}</Badge>,
      sortValue: (row) => ROLE_LABEL[row.role],
    },
    {
      key: 'department',
      header: 'Department',
      cell: (row) => (
        <div>
          <p className="text-[13px]">{row.department}</p>
          <p className="text-[11.5px] text-muted-foreground">{row.branch}</p>
        </div>
      ),
      sortValue: (row) => row.department,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'lastLogin',
      header: 'Last login',
      cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.lastLogin}</span>,
      sortValue: (row) => row.lastLogin,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1.5">
          {row.status === 'pending' && (
            <Button size="sm" variant="outline" onClick={() => approve(row)}>
              <Check />
              Approve
            </Button>
          )}
          {row.status === 'active' && (
            <Button size="sm" variant="ghost" onClick={() => setSuspendTarget(row)}>
              <X />
              Suspend
            </Button>
          )}
          {row.status === 'suspended' && (
            <Button size="sm" variant="ghost" onClick={() => approve(row)}>
              Reinstate
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Staff management"
        description="Approve new accounts, adjust roles and control who can sign in."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Staff Management' }]}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus />
            Invite staff
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total accounts" value={summary?.staff.total ?? 0} />
        <StatTile label="Active" value={summary?.staff.active ?? 0} tone="success" />
        <StatTile label="Awaiting approval" value={summary?.staff.pending ?? 0} tone="warning" />
        <StatTile label="Suspended" value={summary?.staff.suspended ?? 0} tone="danger" />
      </div>

      <SectionCard
        title="Directory"
        description={`${filtered.length} of ${staff.length} accounts shown.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search staff"
                className="h-8 w-44 pl-8 text-[13px]"
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as 'all' | Role)}>
              <SelectTrigger className="h-8 w-40 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {error ? (
          <ErrorState message={error} title="Could not load the staff directory" onRetry={refetch} />
        ) : loading ? (
          <LoadingState label="Loading staff" />
        ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          emptyTitle="No staff match your filters"
          emptyDescription="Try a different search term or clear the role filter."
          emptyAction={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('')
                setRoleFilter('all')
              }}
            >
              Clear filters
            </Button>
          }
        />
        )}
      </SectionCard>

      {/* ------------------------------ Invite modal ----------------------------- */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a staff member</DialogTitle>
            <DialogDescription>
              They receive an onboarding link and appear as pending until an administrator approves the account.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={invite} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="staff-name" required>
                <Input
                  id="staff-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Dr. Ananya Rao"
                />
              </Field>
              <Field label="Work email" htmlFor="staff-email" required>
                <Input
                  id="staff-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="ananya.rao@rehab.com"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role" required>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Department" htmlFor="staff-dept">
                <Input
                  id="staff-dept"
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  placeholder="Physiotherapy"
                />
              </Field>
            </div>

            <Field label="Branch" required>
              <Select value={form.branch} onValueChange={(v) => setForm((f) => ({ ...f, branch: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branchOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => !open && setSuspendTarget(null)}
        title={`Suspend ${suspendTarget?.name ?? 'this account'}?`}
        description="They will be signed out immediately and will not be able to sign in until reinstated. Their records stay intact."
        confirmLabel="Suspend account"
        destructive
        onConfirm={() => {
          if (suspendTarget) suspend(suspendTarget)
          setSuspendTarget(null)
        }}
      />
    </>
  )
}
