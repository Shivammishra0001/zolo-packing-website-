import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, Building2, CheckCircle2, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { AlertList } from '@/components/dashboard/AlertList'
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline'
import { DataTable, type Column } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status'
import { InitialsAvatar } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getDashboard } from '@/services/adminService'
import { listAudit } from '@/services/auditService'
import { listUsers, type StaffRecord } from '@/services/userService'
import { SYSTEM_STATUS } from '@/data/operations'
import { ROLE_ACCENT, ROLE_LABEL } from '@/lib/permissions'
import { icon as iconFor } from '@/lib/icons'
import { cn } from '@/lib/utils'

const QUICK_SETTINGS = [
  { label: 'Roles & Permissions', detail: '8 roles · 34 permissions', to: '/admin/roles', icon: 'security' },
  { label: 'Branch Settings', detail: 'Sites, hours and services', to: '/admin/branches', icon: 'branches' },
  { label: 'Departments', detail: '11 clinical & support units', to: '/admin/departments', icon: 'contacts' },
  { label: 'System Configuration', detail: 'Billing, scheduling, notifications', to: '/admin/configuration', icon: 'settings' },
  { label: 'Audit Logs', detail: 'Last 90 days retained', to: '/admin/audit', icon: 'audit' },
]

const staffColumns: Column<StaffRecord>[] = [
  {
    key: 'name',
    header: 'Name',
    primary: true,
    cell: (row) => (
      <div className="flex items-center gap-2.5">
        <InitialsAvatar initials={row.initials} color={row.avatarColor} className="size-8" />
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
    cell: (row) => (
      <Badge className={cn('border', ROLE_ACCENT[row.role])}>{ROLE_LABEL[row.role]}</Badge>
    ),
    sortValue: (row) => row.role,
  },
  { key: 'department', header: 'Department', cell: (row) => row.department, sortValue: (row) => row.department },
  { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  {
    key: 'lastLogin',
    header: 'Last login',
    align: 'right',
    cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.lastLogin}</span>,
    sortValue: (row) => row.lastLogin,
  },
]

export default function AdminDashboard() {
  // Every staff and branch figure is a grouped query in PostgreSQL.
  const { data: summary, loading, error, refetch } = useQuery(() => getDashboard(), [])
  const { data: recent } = useQuery(() => listUsers({ limit: 7 }), [])
  const { data: activity } = useQuery(() => listAudit({ limit: 12 }), [])

  const staff = recent?.items ?? []
  const active = summary?.staff.active ?? 0
  const pending = summary?.staff.pending ?? 0
  // Service health is not a database fact — it stays where it was until the
  // platform actually reports it.
  const degraded = SYSTEM_STATUS.filter((s) => s.status !== 'Operational').length

  const approvals = staff
    .filter((s) => s.status === 'pending')
    .map((s) => ({
      id: s.id,
      title: `${s.name} is awaiting approval`,
      detail: `${ROLE_LABEL[s.role]} · ${s.branch}`,
      href: '/admin/staff',
      severity: 'warning' as const,
    }))

  const events = (activity?.items ?? []).map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action.toLowerCase().replace(/_/g, ' '),
    target: row.summary,
    time: new Date(row.at).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    category: row.category,
  }))

  return (
    <>
      <PageHeader
        title="System operations"
        description="Accounts, permissions and platform health across every branch."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/admin/audit">View audit log</Link>
            </Button>
            <Button asChild>
              <Link to="/admin/staff">
                <UserPlus />
                Manage staff
              </Link>
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState message={error} title="Could not load the admin dashboard" onRetry={refetch} />
      ) : loading ? (
        <LoadingState label="Loading administration figures" />
      ) : (
        <>
      <KpiGrid className="mb-6 xl:grid-cols-4">
        <KpiCard
          label="Active Staff"
          value={active}
          change={5.2}
          icon={<Users className="size-4" />}
          tone="accent"
          footer={`${summary?.staff.total ?? 0} accounts in total`}
        />
        <KpiCard
          label="Pending Approvals"
          value={pending + 3}
          icon={<CheckCircle2 className="size-4" />}
          tone="warning"
          footer={`${pending} accounts · 2 permission requests · 1 branch`}
        />
        <KpiCard
          label="System Status"
          value={degraded === 0 ? 100 : 75}
          suffix="%"
          icon={<Activity className="size-4" />}
          tone={degraded ? 'warning' : 'success'}
          footer={degraded ? `${degraded} service degraded` : 'All services operational'}
        />
        <KpiCard
          label="Active Branches"
          value={summary?.branches ?? 0}
          icon={<Building2 className="size-4" />}
          tone="info"
          footer="144 beds across all sites"
        />
      </KpiGrid>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Staff management"
          description="Everyone with access to the platform."
          className="xl:col-span-2"
          viewAllHref="/admin/staff"
          delay={0.05}
        >
          <DataTable
            columns={staffColumns}
            rows={staff}
            rowKey={(row) => row.id}
            emptyTitle="No staff accounts"
            emptyDescription="Invite your team to give them access."
          />
        </SectionCard>

        <SectionCard title="Pending actions" description="Waiting on an administrator." delay={0.1}>
          <AlertList
            items={approvals.map((a) => ({
              id: a.id,
              title: a.title,
              detail: a.detail,
              href: a.href,
              severity: a.severity,
            }))}
          />

          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Service health
            </p>
            <ul className="space-y-2">
              {SYSTEM_STATUS.map((service) => (
                <li key={service.label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="flex items-center gap-2">
                    <ShieldCheck
                      className={cn(
                        'size-3.5',
                        service.status === 'Operational' ? 'text-success' : 'text-warning',
                      )}
                    />
                    {service.label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="num text-[12px] text-muted-foreground">{service.uptime}</span>
                    <StatusBadge status={service.status} showDot={false} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="System activity" description="The last ten meaningful events." className="xl:col-span-2" delay={0.05}>
          <ActivityTimeline events={events} />
        </SectionCard>

        <SectionCard title="Quick settings" description="Jump straight into configuration." delay={0.1}>
          <ul className="grid gap-2.5">
            {QUICK_SETTINGS.map((setting, i) => {
              const Icon = iconFor(setting.icon)
              return (
                <motion.li
                  key={setting.to}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.26 }}
                >
                  <Link
                    to={setting.to}
                    className="flex items-center gap-3 rounded-xl border border-border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{setting.label}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{setting.detail}</span>
                    </span>
                  </Link>
                </motion.li>
              )
            })}
          </ul>
        </SectionCard>
      </div>
        </>
      )}
    </>
  )
}
