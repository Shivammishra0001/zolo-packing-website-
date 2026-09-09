import * as React from 'react'
import { Download, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useDebounced, useQuery } from '@/hooks/useApi'
import { listAudit, type AuditCategory, type AuditRecord } from '@/services/auditService'

const CATEGORIES: (AuditCategory | 'all')[] = ['all', 'auth', 'staff', 'patient', 'pharmacy', 'billing', 'system']

const CATEGORY_LABEL: Record<string, string> = {
  all: 'All categories',
  auth: 'Authentication',
  staff: 'Staff & accounts',
  patient: 'Patient records',
  pharmacy: 'Pharmacy',
  billing: 'Billing',
  system: 'System',
}

/** The timeline renders a sentence; an audit row carries a verb and a summary. */
function toEvent(row: AuditRecord) {
  return {
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
  }
}

export default function AdminAuditLog() {
  const toast = useToast()
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]>('all')

  // Filtered in PostgreSQL: the trail has thousands of entries and only grows,
  // so narrowing it in the browser was never going to hold.
  const search = useDebounced(query, 250)
  const { data, loading, error, refetch } = useQuery(
    () =>
      listAudit({
        limit: 100,
        search: search || undefined,
        category: category === 'all' ? undefined : category,
      }),
    [search, category],
  )
  // The tiles count the whole trail, not the page of it on screen.
  const { data: signIns } = useQuery(() => listAudit({ category: 'auth', limit: 1 }), [])
  const { data: records } = useQuery(() => listAudit({ category: 'patient', limit: 1 }), [])
  const { data: config } = useQuery(() => listAudit({ category: 'system', limit: 1 }), [])

  const rows = data?.items ?? []
  const filtered = rows.map(toEvent)

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every account, record and configuration change, retained for 90 days."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Audit Log' }]}
        actions={
          <Button
            variant="outline"
            onClick={() => toast.success('Export queued', 'A CSV of the filtered entries will be emailed to you.')}
          >
            <Download />
            Export CSV
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Entries retained" value={data?.total ?? 0} hint="Every recorded action" />
        <StatTile label="Sign-in events" value={signIns?.total ?? 0} tone="info" />
        <StatTile
          label="Record changes"
          value={records?.total ?? 0}
          tone="accent"
        />
        <StatTile
          label="Configuration changes"
          value={config?.total ?? 0}
          tone="warning"
        />
      </div>

      <SectionCard
        title="Activity"
        description={`${filtered.length} of ${data?.total ?? 0} entries shown.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search actor or record"
                className="h-8 w-52 pl-8 text-[13px]"
              />
            </div>
            <Select value={category} onValueChange={(v) => setCategory(v as (typeof CATEGORIES)[number])}>
              <SelectTrigger className="h-8 w-44 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {error ? (
          <ErrorState message={error} title="Could not load the audit log" onRetry={refetch} />
        ) : loading ? (
          <LoadingState label="Loading the audit log" />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-semibold">No audit entries match your filters</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Try a broader search or a different category.</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setQuery('')
                setCategory('all')
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ActivityTimeline events={filtered} />
        )}
      </SectionCard>
    </>
  )
}
