import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox, Separator } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useQuery } from '@/hooks/useApi'
import { listClinicians } from '@/services/userService'
import { createPatient } from '@/services/patientService'
import { ApiError } from '@/services/api'
import { inr } from '@/lib/utils'

const DEPARTMENTS = [
  'Rehabilitation Medicine',
  'Orthopaedics',
  'Neurology',
  'Physiotherapy',
  'Occupational Therapy',
  'Neuro Rehabilitation',
  'Speech Therapy',
  'Cardiac Rehabilitation',
]

const APPOINTMENT_TYPES = ['New Consultation', 'Walk-in', 'Assessment', 'Follow-up', 'Therapy Review']

const CONSULT_FEE: Record<string, number> = {
  'New Consultation': 1600,
  'Walk-in': 1200,
  Assessment: 2400,
  'Follow-up': 900,
  'Therapy Review': 1100,
}

const EMPTY = {
  name: '',
  dob: '',
  gender: '',
  phone: '',
  email: '',
  address: '',
  bloodGroup: '',
  emergencyName: '',
  emergencyRelation: '',
  emergencyPhone: '',
  department: '',
  doctor: '',
  appointmentType: 'New Consultation',
  // Today, not a fixed date — a literal here is wrong from tomorrow onwards.
  appointmentDate: new Date().toISOString().slice(0, 10),
  appointmentTime: '10:00',
  insuranceProvider: '',
  policyNo: '',
}

export default function ReceptionRegister() {
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = React.useState(EMPTY)
  const [hasInsurance, setHasInsurance] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Active clinicians from the API, so a suspended or departed doctor
  // cannot still be booked.
  const { data: clinicians } = useQuery(() => listClinicians('doctor'), [])
  const doctors = clinicians ?? []
  const fee = CONSULT_FEE[form.appointmentType] ?? 1200

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const required: (keyof typeof EMPTY)[] = ['name', 'dob', 'gender', 'phone', 'department', 'doctor']
  const missing = required.filter((k) => !form[k])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (missing.length > 0) {
      toast.error('Missing details', 'Complete every required field before registering the patient.')
      return
    }

    setSaving(true)
    try {
      const patient = await createPatient({
        name: form.name,
        dateOfBirth: form.dob,
        gender: form.gender as 'Male' | 'Female' | 'Other',
        phone: form.phone,
        email: form.email || null,
        address: form.address || null,
        bloodGroup: form.bloodGroup || null,
        emergencyContact: form.emergencyName
          ? {
              name: form.emergencyName,
              relation: form.emergencyRelation || 'Other',
              phone: form.emergencyPhone,
            }
          : null,
        insurance:
          hasInsurance && form.insuranceProvider
            ? { provider: form.insuranceProvider, policyNo: form.policyNo }
            : null,
        department: form.department || null,
        assignedDoctor: form.doctor || null,
      })

      // The patient number is allocated by the database, never guessed here.
      toast.success(
        'Patient registered',
        `${patient.name} created as ${patient.id}. Booking the first appointment comes next.`,
      )
      setForm(EMPTY)
      setHasInsurance(false)
      navigate(`/patients/${patient.id}`)
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Could not register the patient. Please try again.'
      toast.error('Registration failed', message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        title="Register patient"
        description="Create the record and book the first appointment in a single step."
        crumbs={[{ label: 'Reception', to: '/reception/dashboard' }, { label: 'Register Patient' }]}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setForm(EMPTY)}>
              Reset form
            </Button>
            <Button type="submit" loading={saving}>
              <UserPlus />
              Register patient
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <SectionCard title="Patient details" description="Identity and contact information.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="name" required className="sm:col-span-2">
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Nikhil Bharadwaj"
                />
              </Field>
              <Field label="Date of birth" htmlFor="dob" required>
                <Input id="dob" type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} />
              </Field>
              <Field label="Gender" required>
                <Select value={form.gender} onValueChange={(v) => set('gender', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    {['Male', 'Female', 'Other'].map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Phone number" htmlFor="phone" required>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="+91 98200 00000"
                />
              </Field>
              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="patient@example.com"
                />
              </Field>
              <Field label="Blood group">
                <Select value={form.bloodGroup} onValueChange={(v) => set('bloodGroup', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Address" htmlFor="address" className="sm:col-span-2">
                <Textarea
                  id="address"
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  placeholder="Flat, building, area, city, PIN"
                  className="min-h-[72px]"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Emergency contact" description="Who we call if the patient cannot be reached." delay={0.05}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Contact name" htmlFor="ec-name">
                <Input
                  id="ec-name"
                  value={form.emergencyName}
                  onChange={(e) => set('emergencyName', e.target.value)}
                  placeholder="Full name"
                />
              </Field>
              <Field label="Relationship">
                <Select value={form.emergencyRelation} onValueChange={(v) => set('emergencyRelation', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {['Spouse', 'Parent', 'Child', 'Sibling', 'Friend', 'Other'].map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contact number" htmlFor="ec-phone">
                <Input
                  id="ec-phone"
                  type="tel"
                  value={form.emergencyPhone}
                  onChange={(e) => set('emergencyPhone', e.target.value)}
                  placeholder="+91 98200 00001"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="First appointment" description="Booked as soon as the record is created." delay={0.1}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" required>
                <Select value={form.department} onValueChange={(v) => set('department', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Doctor" required>
                <Select value={form.doctor} onValueChange={(v) => set('doctor', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.name}>
                        {d.name} — {d.department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Appointment type">
                <Select value={form.appointmentType} onValueChange={(v) => set('appointmentType', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPOINTMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t} — {inr(CONSULT_FEE[t])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date" htmlFor="apt-date">
                  <Input
                    id="apt-date"
                    type="date"
                    value={form.appointmentDate}
                    onChange={(e) => set('appointmentDate', e.target.value)}
                  />
                </Field>
                <Field label="Time" htmlFor="apt-time">
                  <Input
                    id="apt-time"
                    type="time"
                    value={form.appointmentTime}
                    onChange={(e) => set('appointmentTime', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Insurance" description="Optional — needed for cashless admissions." delay={0.15}>
            <label className="mb-4 flex cursor-pointer items-center gap-2.5 text-[13px]">
              <Checkbox checked={hasInsurance} onCheckedChange={(v) => setHasInsurance(v === true)} />
              This patient has a health insurance policy
            </label>

            {hasInsurance && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider">
                  <Select value={form.insuranceProvider} onValueChange={(v) => set('insuranceProvider', v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        'Star Health Insurance',
                        'HDFC ERGO Health',
                        'ICICI Lombard',
                        'New India Assurance',
                        'Bajaj Allianz Health',
                        'Senior Citizen Mediclaim',
                      ].map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Policy number" htmlFor="policy">
                  <Input
                    id="policy"
                    value={form.policyNo}
                    onChange={(e) => set('policyNo', e.target.value)}
                    placeholder="SH-0000-00000"
                  />
                </Field>
              </div>
            )}
          </SectionCard>
        </div>

        {/* -------------------------------- Summary ------------------------------- */}
        <aside>
          {/*
            Capped to the space below the sticky topbar and scrolled internally.
            Without the cap this column is ~645px tall pinned at 96px, so on any
            window shorter than ~740px its last card sits below the fold for the
            whole middle of the page.
          */}
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] space-y-5 overflow-y-auto">
            <SectionCard title="Registration summary" delay={0.05}>
              <dl className="space-y-2.5 text-[12.5px]">
                {[
                  ['Name', form.name || '—'],
                  ['Date of birth', form.dob || '—'],
                  ['Gender', form.gender || '—'],
                  ['Phone', form.phone || '—'],
                  ['Department', form.department || '—'],
                  ['Doctor', form.doctor || '—'],
                  ['Appointment', form.appointmentDate ? `${form.appointmentDate} · ${form.appointmentTime}` : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="truncate text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              <Separator className="my-4" />

              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium">{form.appointmentType} fee</span>
                <span className="num text-lg font-bold">{inr(fee)}</span>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                An invoice is raised automatically once the appointment is confirmed.
              </p>
            </SectionCard>

            <SectionCard title="Before you save" delay={0.1}>
              {missing.length === 0 ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-success/25 bg-success/[0.06] px-3.5 py-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  <p className="text-[12.5px] leading-relaxed">
                    All required details are complete. Registering will create the patient record, book the appointment
                    and raise the invoice.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-2.5 text-[12.5px] text-muted-foreground">
                    {missing.length} required field{missing.length > 1 ? 's' : ''} still to complete:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {missing.map((field) => (
                      <Badge key={field} variant="warning">
                        {field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                      </Badge>
                    ))}
                  </div>
                </>
              )}

            </SectionCard>
          </div>
        </aside>
      </div>

      {/*
        The form is 1300–2100px tall and its only other submit lives in the page
        header, which the sticky topbar paints over after the first scroll notch.
        This bar is pinned to the bottom of the viewport so a save is reachable
        from anywhere in the form rather than only at the two ends of it.
      */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            {missing.length === 0
              ? 'All required details are complete.'
              : `${missing.length} required field${missing.length > 1 ? 's' : ''} still to complete.`}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setForm(EMPTY)}>
              Reset form
            </Button>
            <Button type="submit" loading={saving}>
              <UserPlus />
              Register patient
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
