import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2,
  Check,
  ChevronDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Repeat,
  Settings,
  Sparkles,
  Sun,
  UserRound,
} from 'lucide-react'
import type { Role } from '@/types'
import { ORGANISATION } from '@/data/users'
import { ROLE_ACCENT, ROLE_HOME, ROLE_LABEL } from '@/lib/permissions'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { GlobalSearch } from '@/components/layout/GlobalSearch'
import { NotificationsMenu } from '@/components/layout/NotificationsMenu'
import { Logo } from '@/components/layout/Logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InitialsAvatar } from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'
import { Hint } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ROLES: Role[] = ['owner', 'admin', 'doctor', 'therapist', 'nurse', 'pharmacist', 'receptionist', 'accountant']

function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <Hint label="Appearance">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Change appearance"
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {resolved === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
          </button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {(
          [
            { key: 'light', label: 'Light', icon: Sun },
            { key: 'dark', label: 'Dark', icon: Moon },
            { key: 'system', label: 'System', icon: Monitor },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <DropdownMenuItem key={key} onSelect={() => setTheme(key)}>
            <Icon />
            <span className="flex-1">{label}</span>
            {theme === key && <Check className="size-3.5 text-accent" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BranchIndicator() {
  const { user } = useAuth()
  const [branch, setBranch] = React.useState(user?.branch ?? ORGANISATION.branches[0].name)

  React.useEffect(() => {
    if (user?.branch) setBranch(user.branch)
  }, [user?.branch])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hidden max-w-[220px] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex"
        >
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Branch
            </span>
            <span className="block truncate text-[12.5px] font-medium leading-tight">{branch}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{ORGANISATION.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setBranch('All Branches')}>
          <Building2 />
          <span className="flex-1">All Branches</span>
          {branch === 'All Branches' && <Check className="size-3.5 text-accent" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ORGANISATION.branches.map((b) => (
          <DropdownMenuItem key={b.id} onSelect={() => setBranch(b.name)}>
            <Building2 />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{b.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {b.city} · {b.beds} beds
              </span>
            </span>
            {branch === b.name && <Check className="size-3.5 shrink-0 text-accent" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { user, signOut, switchRole, demoMode } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pr-2"
        >
          <InitialsAvatar initials={user.initials} color={user.avatarColor} className="size-8" />
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block max-w-[130px] truncate text-[13px] font-semibold leading-tight">{user.name}</span>
            <span className="block max-w-[130px] truncate text-[11px] text-muted-foreground">
              {ROLE_LABEL[user.role]}
            </span>
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <InitialsAvatar initials={user.initials} color={user.avatarColor} className="size-10" />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold">{user.name}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <div className="px-2.5 pb-2">
          <Badge className={cn('w-full justify-center', ROLE_ACCENT[user.role])}>{user.designation}</Badge>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(ROLE_HOME[user.role])}>
          <UserRound />
          My dashboard
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings />
          Preferences
        </DropdownMenuItem>

        {/* Development affordance only. Each button performs a real sign-in
            with the seeded demo credentials — it never fabricates a session. */}
        {demoMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <span className="flex items-center gap-1.5">
                <Repeat className="size-3" />
                Demo — switch role
              </span>
            </DropdownMenuLabel>
            <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto px-1.5 pb-1.5">
              {ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={async () => {
                    await switchRole(role)
                    navigate(ROLE_HOME[role])
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-[11.5px] font-medium transition-colors',
                    role === user.role
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border text-muted-foreground hover:border-accent/30 hover:bg-muted hover:text-foreground',
                  )}
                >
                  {ROLE_LABEL[role]}
                </button>
              ))}
            </div>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            await signOut()
            navigate('/login')
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Topbar({
  onOpenMobileNav,
  onOpenAssistant,
}: {
  onOpenMobileNav: () => void
  onOpenAssistant: () => void
}) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-md sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <Link to={user ? '/' : '/login'} className="shrink-0 lg:hidden">
        <Logo collapsed className="sm:hidden" />
        <Logo className="hidden sm:flex" />
      </Link>

      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
        <GlobalSearch className="hidden min-w-0 max-w-md flex-1 md:block" />
        <BranchIndicator />

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Hint label="AI Assistant (demo)">
            <button
              type="button"
              onClick={onOpenAssistant}
              aria-label="Open AI assistant"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles className="size-[18px]" />
            </button>
          </Hint>
          <ThemeToggle />
          <NotificationsMenu />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

/** Search bar shown under the top bar on small screens. */
export function MobileSearchBar() {
  return (
    <div className="border-b border-border bg-background px-3 py-2.5 md:hidden">
      <GlobalSearch />
    </div>
  )
}
