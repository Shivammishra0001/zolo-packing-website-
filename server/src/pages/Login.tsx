import * as React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import type { Role } from '@/types'
import { DEMO_PASSWORD, DEMO_USERS, ORGANISATION } from '@/data/users'
import { ROLE_HOME, ROLE_LABEL } from '@/lib/permissions'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { LogoMark } from '@/components/layout/Logo'
import { RehabVisual } from '@/components/layout/RehabVisual'
import { cn } from '@/lib/utils'

const DEMO_ROLES: Role[] = [
  'owner',
  'admin',
  'doctor',
  'therapist',
  'nurse',
  'pharmacist',
  'receptionist',
  'accountant',
]

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [remember, setRemember] = React.useState(true)
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [filledRole, setFilledRole] = React.useState<Role | null>(null)

  const redirectTo = (location.state as { from?: string } | null)?.from

  function fillDemo(role: Role) {
    setEmail(DEMO_USERS[role].email)
    setPassword(DEMO_PASSWORD)
    setFilledRole(role)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const user = await signIn(email, password, remember)
      toast.success(`Welcome back, ${user.name.split(' ').slice(-1)[0]}`, `Signed in as ${ROLE_LABEL[user.role]}`)
      navigate(redirectTo ?? ROLE_HOME[user.role], { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------ Visual side ----------------------------- */}
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col dark:bg-card">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-chart-2/80 dark:from-card dark:via-card dark:to-accent/10" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '46px 46px',
            maskImage: 'radial-gradient(ellipse 75% 65% at 45% 42%, #000 25%, transparent 76%)',
          }}
        />

        <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
          <Link to="/" className="flex w-fit items-center gap-2.5 rounded-lg">
            <LogoMark className="bg-white/10 backdrop-blur" />
            <span>
              <span className="block text-[15px] font-bold leading-tight tracking-tight">{ORGANISATION.shortName}</span>
              <span className="block text-[11px] font-medium uppercase tracking-wider text-white/60">
                Rehabilitation HMS
              </span>
            </span>
          </Link>

          <div className="max-w-lg">
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="text-[38px] font-bold leading-[1.12] tracking-tight xl:text-[44px]"
            >
              Rehabilitation care, connected.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="mt-4 text-[15px] leading-relaxed text-white/75"
            >
              One intelligent platform for patients, clinicians, therapy, pharmacy and operations.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mt-9"
            >
              <RehabVisual />
            </motion.div>
          </div>

          <div className="flex items-center gap-6 text-[12.5px] text-white/60">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-4" />
              Role-based access control
            </span>
            <span>{ORGANISATION.branches.length} branches · 8 staff roles</span>
          </div>
        </div>
      </aside>

      {/* ------------------------------- Form side ------------------------------ */}
      <main className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-12 xl:px-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-[26rem]"
        >
          <Link
            to="/"
            className="mb-7 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="size-3.5" />
            Back to home
          </Link>

          <div className="mb-7 lg:hidden">
            <LogoMark />
          </div>

          <h2 className="text-[26px] font-bold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            Use your staff credentials. Your dashboard is selected automatically from your role.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <Field label="Email address" htmlFor="email" required>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setFilledRole(null)
                  }}
                  placeholder="you@rehab.com"
                  className="h-10 pl-9"
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-10 pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            <div className="flex items-center justify-between gap-3">
              <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                Remember me
              </label>
              <button
                type="button"
                onClick={() =>
                  toast.info('Password reset', 'In the demo build, use the shared demo password shown below.')
                }
                className="text-[13px] font-medium text-accent transition-colors hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3.5 py-2.5"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="text-[12.5px] leading-relaxed text-destructive">{error}</p>
              </motion.div>
            )}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          {/* ---------------------------- Demo accounts --------------------------- */}
          <section className="mt-8 rounded-xl border border-dashed border-border bg-muted/35 p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-[12.5px] font-semibold">Demo Accounts</h3>
              <span className="text-[11.5px] text-muted-foreground">
                Password: <code className="font-mono text-foreground">{DEMO_PASSWORD}</code>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => fillDemo(role)}
                  aria-label={`Use the ${ROLE_LABEL[role]} demo account`}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left transition-all duration-150',
                    filledRole === role
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-card hover:-translate-y-px hover:border-accent/40 hover:shadow-xs',
                  )}
                >
                  <span className="block truncate text-[12.5px] font-medium">{ROLE_LABEL[role]}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{DEMO_USERS[role].email}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Selecting a role fills the form. Every role signs in through this one page — the platform routes you to the
              right dashboard afterwards.
            </p>
          </section>
        </motion.div>
      </main>
    </div>
  )
}
