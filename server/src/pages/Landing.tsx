import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  CalendarCheck,
  ClipboardList,
  Dumbbell,
  HeartPulse,
  KeyRound,
  Layers,
  Menu,
  Moon,
  Pill,
  Receipt,
  ShieldCheck,
  Stethoscope,
  Sun,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import type { Role } from '@/types'
import { Logo, LogoMark } from '@/components/layout/Logo'
import { RehabVisual } from '@/components/layout/RehabVisual'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/misc'
import { useTheme } from '@/context/ThemeContext'
import { ORGANISATION } from '@/data/users'
import { ROLE_LABEL } from '@/lib/permissions'
import { cn } from '@/lib/utils'

const ROLE_CARDS: { role: Role; icon: React.ElementType; blurb: string }[] = [
  { role: 'owner', icon: TrendingUp, blurb: 'Revenue, occupancy and therapy utilisation at a glance.' },
  { role: 'admin', icon: ShieldCheck, blurb: 'Accounts, roles, branches and platform health.' },
  { role: 'doctor', icon: Stethoscope, blurb: 'Clinic list, consultations, prescriptions and lab review.' },
  { role: 'therapist', icon: HeartPulse, blurb: 'Session entry, rehab plans and progress tracking.' },
  { role: 'nurse', icon: ClipboardList, blurb: 'Ward rounds, vitals, medication tasks and discharges.' },
  { role: 'pharmacist', icon: Pill, blurb: 'Dispensing queue, inventory, expiry alerts and POS.' },
  { role: 'receptionist', icon: CalendarCheck, blurb: 'Registration, booking, check-in and bed availability.' },
  { role: 'accountant', icon: Wallet, blurb: 'Collections, outstanding balances, expenses and P&L.' },
]

const JOURNEY = [
  { label: 'Registration', icon: UserRound, detail: 'Front desk creates the record and books the first visit.' },
  { label: 'Consultation', icon: Stethoscope, detail: 'Doctor records findings and sets the rehabilitation goal.' },
  { label: 'Rehabilitation', icon: Dumbbell, detail: 'Therapists deliver sessions and log pain, mobility and strength.' },
  { label: 'Pharmacy', icon: Pill, detail: 'Prescriptions dispense against live stock, with substitutions flagged.' },
  { label: 'Billing', icon: Receipt, detail: 'Invoices, payments and insurance settle against one ledger.' },
  { label: 'Recovery', icon: TrendingUp, detail: 'Outcomes close the loop and feed the centre’s analytics.' },
]

const REHAB_FEATURES = [
  { icon: Dumbbell, title: 'Rehabilitation plans', detail: 'Goals, modalities, session counts and milestone dates in one structured plan.' },
  { icon: HeartPulse, title: 'Therapy sessions', detail: 'Exercise selection with pain, mobility and strength captured at the point of care.' },
  { icon: TrendingUp, title: 'Progress tracking', detail: 'Weekly trends that make plateaus visible before a programme stalls.' },
  { icon: Layers, title: 'Patient 360', detail: 'History, appointments, vitals, prescriptions, billing and documents in one record.' },
  { icon: ClipboardList, title: 'Clinical workflows', detail: 'Consultation to prescription to follow-up, without re-keying anything.' },
  { icon: BarChart3, title: 'Operational analytics', detail: 'Therapist workload, package utilisation, occupancy and revenue mix.' },
]

const PREVIEW_KPIS = [
  { label: "Today's revenue", value: '₹2,84,620', delta: '+12.4%' },
  { label: 'Occupancy', value: '40%', delta: '−3.2%' },
  { label: 'Therapy utilisation', value: '87%', delta: '+5.5%' },
]

const PREVIEW_BARS = [58, 72, 64, 81, 76, 92, 88, 96, 84, 91]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/[0.07] px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wider text-accent">
      {children}
    </span>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const { resolved, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = React.useState(false)

  const nav = [
    { label: 'Platform', href: '#platform' },
    { label: 'Journey', href: '#journey' },
    { label: 'Rehabilitation', href: '#rehab' },
    { label: 'Security', href: '#security' },
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* --------------------------------- Header -------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/" className="shrink-0">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {resolved === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
            </button>
            <Button asChild className="hidden sm:inline-flex">
              <Link to="/login">Sign In</Link>
            </Button>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle menu"
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted md:hidden"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <motion.nav
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="overflow-hidden border-t border-border md:hidden"
          >
            <ul className="space-y-1 px-5 py-3">
              {nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-[13.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li className="pt-2">
                <Button asChild className="w-full">
                  <Link to="/login">Sign In</Link>
                </Button>
              </li>
            </ul>
          </motion.nav>
        )}
      </header>

      {/* ---------------------------------- Hero --------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-fade opacity-60" aria-hidden />
        <div className="pointer-events-none absolute -top-32 left-1/2 size-[540px] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl" aria-hidden />

        <div className="relative mx-auto grid max-w-[1200px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-24">
          <div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <SectionLabel>{ORGANISATION.tagline}</SectionLabel>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 text-[38px] font-bold leading-[1.1] tracking-tight sm:text-[46px] lg:text-[54px]"
            >
              Rehabilitation care,
              <br />
              managed in one place.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-muted-foreground"
            >
              Connect clinical care, rehabilitation therapy, pharmacy, operations and finance through one intelligent
              platform.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Button size="lg" asChild>
                <Link to="/login">
                  Sign In
                  <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/login')}>
                Explore Demo
              </Button>
            </motion.div>

            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-border pt-6"
            >
              {[
                ['8', 'staff roles'],
                ['3', 'connected branches'],
                ['1', 'patient record'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="num text-2xl font-bold tracking-tight">{value}</dt>
                  <dd className="mt-0.5 text-[12.5px] text-muted-foreground">{label}</dd>
                </div>
              ))}
            </motion.dl>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto w-full max-w-[26rem] lg:mx-0 lg:ml-auto"
          >
            <div className="rounded-2xl border border-border bg-card p-1.5 shadow-pop">
              <div className="rounded-xl bg-gradient-to-br from-primary to-chart-2 p-5 text-white dark:from-card dark:to-card">
                <RehabVisual />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* -------------------------------- Platform -------------------------------- */}
      <section id="platform" className="border-t border-border bg-muted/25 py-16 lg:py-20">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="max-w-2xl">
            <SectionLabel>One platform</SectionLabel>
            <h2 className="mt-4 text-[28px] font-bold tracking-tight sm:text-[32px]">
              Eight roles, one sign-in, one source of truth.
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              Everyone signs in at the same place. The platform identifies the role and opens the right dashboard, with
              navigation and permissions scoped to what that person actually does.
            </p>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_CARDS.map((card, i) => {
              const Icon = card.icon
              return (
                <motion.li
                  key={card.role}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.35, delay: (i % 4) * 0.06 }}
                >
                  <div className="flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon className="size-[18px]" />
                    </span>
                    <p className="mt-3.5 text-[14px] font-semibold">{ROLE_LABEL[card.role]}</p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{card.blurb}</p>
                  </div>
                </motion.li>
              )
            })}
          </ul>
        </div>
      </section>

      {/* --------------------------------- Journey -------------------------------- */}
      <section id="journey" className="border-t border-border py-16 lg:py-20">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="max-w-2xl">
            <SectionLabel>Connected patient journey</SectionLabel>
            <h2 className="mt-4 text-[28px] font-bold tracking-tight sm:text-[32px]">
              From the front desk to full recovery.
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              Every step writes to the same patient record, so nobody has to ask the patient the same question twice.
            </p>
          </div>

          <div className="relative mt-12">
            <div className="absolute left-0 right-0 top-6 hidden h-px bg-border lg:block" aria-hidden />
            <motion.div
              className="absolute left-0 top-6 hidden h-px bg-accent lg:block"
              initial={{ width: 0 }}
              whileInView={{ width: '100%' }}
              viewport={{ once: true }}
              transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
              aria-hidden
            />

            <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-6 lg:gap-4">
              {JOURNEY.map((step, i) => {
                const Icon = step.icon
                return (
                  <motion.li
                    key={step.label}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.35, delay: i * 0.1 }}
                    className="relative"
                  >
                    <span className="relative z-10 flex size-12 items-center justify-center rounded-xl border border-border bg-card text-accent shadow-card">
                      <Icon className="size-5" />
                    </span>
                    <p className="mt-3.5 flex items-center gap-2 text-[13.5px] font-semibold">
                      <span className="num text-[11px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                      {step.label}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{step.detail}</p>
                  </motion.li>
                )
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* ------------------------------ Rehabilitation ---------------------------- */}
      <section id="rehab" className="border-t border-border bg-muted/25 py-16 lg:py-20">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="max-w-2xl">
            <SectionLabel>Built for rehabilitation</SectionLabel>
            <h2 className="mt-4 text-[28px] font-bold tracking-tight sm:text-[32px]">
              Not a general hospital system with therapy bolted on.
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              Rehabilitation runs on programmes, not single visits. The data model is built around plans, sessions and
              measurable progress.
            </p>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REHAB_FEATURES.map((feature, i) => {
              const Icon = feature.icon
              return (
                <motion.li
                  key={feature.title}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.35, delay: (i % 3) * 0.08 }}
                >
                  <div className="flex h-full gap-3.5 rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon className="size-[17px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold">{feature.title}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{feature.detail}</p>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </ul>
        </div>
      </section>

      {/* ------------------------------- Dashboard -------------------------------- */}
      <section className="border-t border-border py-16 lg:py-20">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <SectionLabel>Intelligent dashboards</SectionLabel>
            <h2 className="mt-4 text-[28px] font-bold tracking-tight sm:text-[32px]">
              Every dashboard answers one question: what do I need to do today?
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              Not a wall of charts. Each role sees what needs attention, what is happening today, and the single action
              that moves it forward — with the numbers behind it a click away.
            </p>

            <ul className="mt-6 space-y-3">
              {[
                'Owners see revenue, occupancy and therapy utilisation together.',
                'Doctors see the next patient and open a consultation in one click.',
                'Therapists record pain, mobility and strength at the point of care.',
                'Pharmacists dispense against live stock, with substitutions flagged.',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[13.5px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="text-muted-foreground">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-border bg-card p-5 shadow-pop"
          >
            {/* Fake app chrome */}
            <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
              <LogoMark className="size-7" />
              <span className="text-[12.5px] font-semibold">Owner dashboard</span>
              <Badge variant="warning" className="ml-auto">
                Demo Mode
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {PREVIEW_KPIS.map((kpi) => (
                <div key={kpi.label} className="rounded-xl border border-border bg-muted/30 p-3.5">
                  <p className="text-[11px] font-medium text-muted-foreground">{kpi.label}</p>
                  <p className="num mt-1.5 text-lg font-bold tracking-tight">{kpi.value}</p>
                  <p
                    className={cn(
                      'num mt-0.5 text-[11px] font-semibold',
                      kpi.delta.startsWith('+') ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {kpi.delta}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[12.5px] font-semibold">Revenue trend</p>
                <span className="text-[11px] text-muted-foreground">Last 10 months</span>
              </div>
              <div className="flex h-28 items-end gap-1.5">
                {PREVIEW_BARS.map((height, i) => (
                  <motion.span
                    key={i}
                    className="flex-1 rounded-t-sm bg-accent/75"
                    initial={{ height: 0 }}
                    whileInView={{ height: `${height}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="text-[12.5px] font-semibold">Rehab progress</p>
                <div className="mt-3 space-y-2.5">
                  {[
                    { name: 'Raj Kumar', value: 75 },
                    { name: 'Simran Kaur', value: 65 },
                    { name: 'Amit Singh', value: 58 },
                  ].map((row) => (
                    <div key={row.name}>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="text-muted-foreground">{row.name}</span>
                        <span className="num font-semibold">{row.value}%</span>
                      </div>
                      <Progress value={row.value} className="h-1.5" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <p className="text-[12.5px] font-semibold">Needs attention</p>
                <ul className="mt-3 space-y-2 text-[11.5px]">
                  {[
                    { text: '4 medicines below threshold', tone: 'text-warning' },
                    { text: '₹1,25,000 outstanding', tone: 'text-destructive' },
                    { text: '5 medicines near expiry', tone: 'text-info' },
                  ].map((item) => (
                    <li key={item.text} className="flex items-start gap-2">
                      <span className={cn('mt-1 size-1.5 shrink-0 rounded-full bg-current', item.tone)} />
                      <span className="text-muted-foreground">{item.text}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <BedDouble className="size-3.5 text-muted-foreground" />
                  <span className="text-[11.5px] text-muted-foreground">8 of 20 beds occupied</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* -------------------------------- Security -------------------------------- */}
      <section id="security" className="border-t border-border bg-muted/25 py-16 lg:py-20">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="max-w-2xl">
            <SectionLabel>Security & access</SectionLabel>
            <h2 className="mt-4 text-[28px] font-bold tracking-tight sm:text-[32px]">
              People see exactly what their role requires.
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              Access is driven by an explicit permission matrix rather than hard-coded screens. Navigation, routes and
              actions all read from the same source, so what a person can see and what they can do never drift apart.
            </p>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: KeyRound,
                title: 'Single sign-in',
                detail: 'One login page for every role. The platform routes each person to their own dashboard.',
              },
              {
                icon: ShieldCheck,
                title: 'Permission matrix',
                detail: '34 granular permissions grouped by function, editable per role by an administrator.',
              },
              {
                icon: Users,
                title: 'Scoped navigation',
                detail: 'Menu items a person cannot open are never rendered, not merely disabled.',
              },
              {
                icon: ClipboardList,
                title: 'Audit trail',
                detail: 'Sign-ins, record changes and configuration edits are recorded with actor and timestamp.',
              },
              {
                icon: Layers,
                title: 'Branch awareness',
                detail: 'Staff are assigned to branches, with organisation-wide views for leadership roles.',
              },
              {
                icon: BarChart3,
                title: 'Backend ready',
                detail: 'The permission layer is a data structure, so a real API can supply it without UI changes.',
              },
            ].map((item, i) => {
              const Icon = item.icon
              return (
                <motion.li
                  key={item.title}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.35, delay: (i % 3) * 0.08 }}
                >
                  <div className="flex h-full gap-3.5 rounded-xl border border-border bg-card p-5 shadow-card">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Icon className="size-[17px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold">{item.title}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </ul>

          <p className="mt-8 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
            This build is a front-end demonstration running entirely on sample data. It makes no regulatory or
            certification claims, and the AI assistant is a scripted demo rather than a clinical tool.
          </p>
        </div>
      </section>

      {/* ---------------------------------- CTA ---------------------------------- */}
      <section className="border-t border-border py-16 lg:py-20">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary to-chart-2 px-6 py-12 text-center text-primary-foreground shadow-pop sm:px-12 dark:from-card dark:to-card">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                backgroundSize: '42px 42px',
                maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000 20%, transparent 75%)',
              }}
              aria-hidden
            />
            <div className="relative">
              <h2 className="text-[28px] font-bold tracking-tight sm:text-[32px]">
                See it running with real rehabilitation data.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[14.5px] leading-relaxed text-white/75 dark:text-muted-foreground">
                Eight demo accounts, one shared password, and every dashboard fully clickable.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/login">
                    Explore Demo
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------- Footer -------------------------------- */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-5 sm:flex-row sm:px-8">
          <Logo />
          <p className="text-center text-[12px] text-muted-foreground sm:text-right">
            {ORGANISATION.name} · Demonstration build with sample data.
            <br className="sm:hidden" /> Not for clinical use.
          </p>
        </div>
      </footer>
    </div>
  )
}
