import * as React from 'react'
import { Check, LogOut, Monitor, Moon, Save, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { InitialsAvatar, Separator, Switch } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { ROLE_ACCENT, ROLE_LABEL } from '@/lib/permissions'
import { cn } from '@/lib/utils'

const NOTIFICATION_PREFS = [
  { key: 'inApp', label: 'In-app notifications', detail: 'Alerts in the bell menu while you are signed in.', on: true },
  { key: 'email', label: 'Email digest', detail: 'A summary of anything you missed, sent each evening.', on: true },
  { key: 'sms', label: 'Critical SMS alerts', detail: 'Only for critical items assigned directly to you.', on: false },
  { key: 'sound', label: 'Notification sound', detail: 'Play a short chime for new critical alerts.', on: false },
]

export default function Settings() {
  const { user, signOut, permissions } = useAuth()
  const { theme, setTheme } = useTheme()
  const toast = useToast()
  const navigate = useNavigate()

  const [prefs, setPrefs] = React.useState(NOTIFICATION_PREFS)
  const [name, setName] = React.useState(user?.name ?? '')
  const [phone, setPhone] = React.useState(user?.phone ?? '')
  const [dirty, setDirty] = React.useState(false)
  const [signOutOpen, setSignOutOpen] = React.useState(false)

  if (!user) return null

  return (
    <>
      <PageHeader
        title="Preferences"
        description="Your profile, appearance and notification settings."
        crumbs={[{ label: 'Preferences' }]}
        actions={
          <Button
            disabled={!dirty}
            onClick={() => {
              setDirty(false)
              toast.success('Preferences saved', 'Your changes apply to this device immediately.')
            }}
          >
            <Save />
            Save changes
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <SectionCard title="Profile" description="How you appear to colleagues across the platform.">
            <div className="mb-5 flex items-center gap-4">
              <InitialsAvatar
                initials={user.initials}
                color={user.avatarColor}
                className="size-16 text-lg"
              />
              <div className="min-w-0">
                <p className="text-[16px] font-semibold">{user.name}</p>
                <p className="text-[13px] text-muted-foreground">{user.designation}</p>
                <Badge className={cn('mt-1.5 border', ROLE_ACCENT[user.role])}>{ROLE_LABEL[user.role]}</Badge>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="pref-name">
                <Input
                  id="pref-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setDirty(true)
                  }}
                />
              </Field>
              <Field label="Work email" htmlFor="pref-email" hint="Managed by your administrator.">
                <Input id="pref-email" value={user.email} readOnly className="bg-muted/50" />
              </Field>
              <Field label="Contact number" htmlFor="pref-phone">
                <Input
                  id="pref-phone"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setDirty(true)
                  }}
                />
              </Field>
              <Field label="Branch" htmlFor="pref-branch" hint="Managed by your administrator.">
                <Input id="pref-branch" value={user.branch} readOnly className="bg-muted/50" />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Appearance" description="Applies to this browser only." delay={0.05}>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { key: 'light', label: 'Light', icon: Sun, detail: 'Bright, high contrast' },
                  { key: 'dark', label: 'Dark', icon: Moon, detail: 'Easier on the eyes at night' },
                  { key: 'system', label: 'System', icon: Monitor, detail: 'Follow your device setting' },
                ] as const
              ).map(({ key, label, icon: Icon, detail }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTheme(key)}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated',
                    theme === key ? 'border-accent bg-accent/[0.06]' : 'border-border',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg',
                        theme === key ? 'bg-accent/12 text-accent' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    {theme === key && <Check className="size-4 text-accent" strokeWidth={3} />}
                  </div>
                  <p className="mt-3 text-[13.5px] font-semibold">{label}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{detail}</p>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Notifications" description="Choose how the platform reaches you." delay={0.1}>
            <ul className="space-y-2">
              {prefs.map((pref) => (
                <li
                  key={pref.key}
                  className={cn(
                    'flex items-start justify-between gap-4 rounded-lg border px-4 py-3 transition-colors',
                    pref.on ? 'border-accent/25 bg-accent/[0.05]' : 'border-border',
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{pref.label}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{pref.detail}</p>
                  </div>
                  <Switch
                    checked={pref.on}
                    aria-label={pref.label}
                    className="mt-0.5 shrink-0"
                    onCheckedChange={(v) => {
                      setPrefs((prev) => prev.map((p) => (p.key === pref.key ? { ...p, on: v } : p)))
                      setDirty(true)
                    }}
                  />
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard
            title="Your access"
            description={`${permissions.length} permissions granted by your administrator.`}
            delay={0.05}
          >
            <div className="flex flex-wrap gap-1.5">
              {permissions.map((permission) => (
                <Badge key={permission} variant="outline" className="font-mono text-[10.5px]">
                  {permission}
                </Badge>
              ))}
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              Permissions come from the server and control both the navigation you see and the screens you can open.
              Your administrator can change them at any time.
            </p>
          </SectionCard>

          <SectionCard title="Session" description="This device." delay={0.1}>
            <dl className="space-y-2.5 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Signed in as</dt>
                <dd className="truncate text-right font-medium">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Role</dt>
                <dd className="font-medium">{ROLE_LABEL[user.role]}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last sign-in</dt>
                <dd className="font-medium">{user.lastLogin}</dd>
              </div>
            </dl>

            <Separator className="my-4" />

            <Button variant="outline" className="w-full" onClick={() => setSignOutOpen(true)}>
              <LogOut />
              Sign out
            </Button>
          </SectionCard>
        </aside>
      </div>

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out of Arogya Rehab?"
        description="You will need to sign in again to return to your dashboard. Any unsaved form data will be lost."
        confirmLabel="Sign out"
        onConfirm={async () => {
          await signOut()
          navigate('/login')
        }}
      />
    </>
  )
}
