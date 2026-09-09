import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  ArrowLeft,
  Check,
  FlaskConical,
  Plus,
  Save,
  Stethoscope,
  Trash2,
  UserRound,
} from 'lucide-react'
import type { MedicalHistoryEntry, Patient, PrescriptionItem } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox, InitialsAvatar, Separator } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getPatient } from '@/services/patientService'
import { appointmentKey, listAppointments, todayIso } from '@/services/appointmentService'
import { createConsultation } from '@/services/consultationService'
import { createPrescription, listMedicines } from '@/services/prescriptionService'
import { addHistoryEntry, latestVitals, listMedicalHistory, recordVitals } from '@/services/vitalsService'
import { listLabs } from '@/services/labService'
import { formatDate, to12Hour } from '@/lib/utils'

const EMPTY_ITEM: PrescriptionItem = {
  medicine: '',
  strength: '',
  dosage: '1 tablet',
  frequency: 'Twice daily',
  duration: '7 days',
  quantity: 14,
  instructions: '',
}

/** The care-plan options the screen has always offered. */
const CARE_PLANS = [
  { value: 'continue', label: 'Continue current rehabilitation plan' },
  { value: 'escalate', label: 'Escalate intensity / add modality' },
  { value: 'revise', label: 'Revise plan — progress plateaued' },
  { value: 'discharge', label: 'Prepare for discharge' },
  { value: 'refer', label: 'Refer to another specialty' },
]

const FREQUENCIES = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'Every 8 hours as needed',
  'Once weekly',
  'At bedtime',
]

/** The medical-history vocabulary, exactly as `MedicalHistoryEntry` declares it. */
const HISTORY_TYPES: MedicalHistoryEntry['type'][] = [
  'Diagnosis',
  'Surgery',
  'Injury',
  'Allergy',
  'Chronic Condition',
  'Lab Result',
]

const FLAG_TONE = { Normal: 'success', Abnormal: 'warning', Critical: 'danger' } as const

/** Two weeks out — the default the follow-up field opens on. */
function defaultFollowUp(): string {
  const date = new Date()
  date.setDate(date.getDate() + 14)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export default function Consultation() {
  const { patientId } = useParams()
  const { data: patient, loading, error, refetch } = useQuery(
    () => getPatient(patientId!),
    [patientId],
    { enabled: Boolean(patientId) },
  )

  if (loading) return <LoadingState label="Loading the patient record" />

  if (error || !patient) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <UserRound className="mb-3 size-9 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Patient not found</h1>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
          {error ?? 'The record you are looking for does not exist in this workspace.'}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={refetch}>
            Try again
          </Button>
          <Button asChild>
            <Link to="/patients">Back to patients</Link>
          </Button>
        </div>
      </div>
    )
  }

  return <ConsultationForm patient={patient} />
}

function ConsultationForm({ patient }: { patient: Patient }) {
  const navigate = useNavigate()
  const toast = useToast()

  /* ------------------------------ Loaded context ----------------------------- */

  // Today's slot for this patient — the encounter is recorded against it, so
  // the appointment and the consultation stay linked.
  const { data: todaysSlots } = useQuery(
    () => listAppointments({ patient: patient.id, date: todayIso(), scope: 'branch', limit: 10 }),
    [patient.id],
  )
  const appointment = todaysSlots?.items.find(
    (a) => a.status === 'In Consultation' || a.status === 'Waiting',
  )

  const { data: vitals, refetch: refetchVitals } = useQuery(
    () => latestVitals(patient.id),
    [patient.id],
  )
  const { data: history, refetch: refetchHistory } = useQuery(
    () => listMedicalHistory(patient.id),
    [patient.id],
  )
  const historyEntries = history ?? []
  const { data: labPage } = useQuery(
    () => listLabs({ patient: patient.id, limit: 20 }),
    [patient.id],
  )
  const labs = labPage?.items ?? []

  const { data: medicines } = useQuery(() => listMedicines(), [])
  const catalogue = medicines ?? []

  /* --------------------------------- Form state ------------------------------ */

  const [complaint, setComplaint] = React.useState('')
  const [examination, setExamination] = React.useState('')
  const [diagnosis, setDiagnosis] = React.useState('')
  const [carePlan, setCarePlan] = React.useState('continue')
  const [notes, setNotes] = React.useState('')
  const [followUp, setFollowUp] = React.useState(defaultFollowUp)
  const [followUpType, setFollowUpType] = React.useState('Follow-up')
  const [items, setItems] = React.useState<PrescriptionItem[]>([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = React.useState(false)

  // Opt-in, because not every encounter's working diagnosis belongs in the
  // permanent history — a week-8 review note would only clutter it.
  const [addToHistory, setAddToHistory] = React.useState(false)
  const [historyType, setHistoryType] = React.useState<MedicalHistoryEntry['type']>('Diagnosis')

  // Vitals recorded from here, so a doctor does not have to leave the encounter.
  const [obs, setObs] = React.useState({ systolic: '', diastolic: '', heartRate: '', spo2: '', temperature: '' })
  const [recording, setRecording] = React.useState(false)

  function updateItem(index: number, patch: Partial<PrescriptionItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function saveVitals() {
    const payload = {
      systolic: obs.systolic ? Number(obs.systolic) : undefined,
      diastolic: obs.diastolic ? Number(obs.diastolic) : undefined,
      heartRate: obs.heartRate ? Number(obs.heartRate) : undefined,
      spo2: obs.spo2 ? Number(obs.spo2) : undefined,
      temperature: obs.temperature ? Number(obs.temperature) : undefined,
    }
    if (Object.values(payload).every((v) => v === undefined)) {
      toast.error('Nothing to record', 'Enter at least one observation.')
      return
    }

    setRecording(true)
    try {
      await recordVitals(patient.id, payload)
      setObs({ systolic: '', diastolic: '', heartRate: '', spo2: '', temperature: '' })
      refetchVitals()
      toast.success('Vitals recorded', `Saved against ${patient.name}'s record.`)
    } catch (err) {
      toast.error('Could not record vitals', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setRecording(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!diagnosis.trim()) {
      toast.error('Diagnosis required', 'Enter a working diagnosis before saving the consultation.')
      return
    }

    const prescribed = items.filter((i) => i.medicine.trim())
    setSaving(true)
    try {
      // The encounter first — the prescription hangs off it, so a failed
      // prescription never leaves an unrecorded consultation behind.
      const consultation = await createConsultation({
        patientId: patient.id,
        appointmentId: appointment ? appointmentKey(appointment) : null,
        complaint: complaint.trim() || undefined,
        examination: examination.trim() || undefined,
        diagnosis: diagnosis.trim(),
        carePlan,
        notes: notes.trim() || undefined,
        followUpDate: followUp || null,
      })

      if (addToHistory) {
        await addHistoryEntry(patient.id, {
          type: historyType,
          title: diagnosis.trim(),
          detail: examination.trim() || notes.trim() || undefined,
        })
        refetchHistory()
      }

      if (prescribed.length > 0) {
        // Its own call: the backend writes the prescription and every item in
        // one transaction, so a bad line rolls the whole prescription back.
        await createPrescription({
          patientId: patient.id,
          consultationId: consultation.id,
          items: prescribed,
        })
      }

      toast.success(
        'Consultation saved',
        `${patient.name}'s record updated${
          prescribed.length
            ? ` with ${prescribed.length} prescribed medicine${prescribed.length > 1 ? 's' : ''}`
            : ''
        }. Follow-up set for ${formatDate(followUp)}.`,
      )
      navigate('/doctor/dashboard')
    } catch (err) {
      toast.error(
        'Could not save the consultation',
        err instanceof Error ? err.message : 'Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const outOfStock = (name: string) =>
    catalogue.find((m) => m.name === name)?.status === 'Out of Stock'

  return (
    <form onSubmit={save}>
      <PageHeader
        title="Consultation"
        description={`${patient.name} · ${patient.id}${
          appointment ? ` · ${to12Hour(appointment.time)} ${appointment.type}` : ''
        }`}
        crumbs={[
          { label: 'Doctor', to: '/doctor/dashboard' },
          { label: 'Consultations', to: '/doctor/consultations' },
          { label: patient.name },
        ]}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft />
              Back
            </Button>
            <Button type="submit" loading={saving}>
              <Save />
              Save consultation
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <SectionCard title="Clinical assessment" description="Recorded against today's encounter." icon={<Stethoscope />}>
            <div className="space-y-4">
              <Field label="Chief complaint" htmlFor="complaint" required>
                <Textarea
                  id="complaint"
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                  placeholder={`e.g. ${patient.name.split(' ')[0]} reports stiffness on waking that eases after 20 minutes of activity.`}
                  className="min-h-[76px]"
                />
              </Field>

              <Field label="Examination findings" htmlFor="examination">
                <Textarea
                  id="examination"
                  value={examination}
                  onChange={(e) => setExamination(e.target.value)}
                  placeholder="Range of motion, strength grading, special tests, gait observation…"
                  className="min-h-[92px]"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Working diagnosis" htmlFor="diagnosis" required>
                  <Input
                    id="diagnosis"
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder={patient.primaryCondition}
                  />
                </Field>
                <Field label="Plan of care">
                  <Select value={carePlan} onValueChange={setCarePlan}>
                    <SelectTrigger id="care-plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CARE_PLANS.map((plan) => (
                        <SelectItem key={plan.value} value={plan.value}>
                          {plan.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-3.5 py-3">
                <label className="flex items-center gap-2 text-[12.5px]">
                  <Checkbox
                    checked={addToHistory}
                    onCheckedChange={(checked) => setAddToHistory(checked === true)}
                  />
                  Add this diagnosis to the medical history
                </label>
                {addToHistory && (
                  <Select
                    value={historyType}
                    onValueChange={(v) => setHistoryType(v as MedicalHistoryEntry['type'])}
                  >
                    <SelectTrigger className="h-8 w-auto min-w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HISTORY_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Field label="Consultation notes" htmlFor="notes">
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Advice given, precautions, patient questions answered…"
                  className="min-h-[92px]"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="Prescription"
            description="Written against this encounter when the consultation is saved."
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, { ...EMPTY_ITEM }])}>
                <Plus />
                Add medicine
              </Button>
            }
          >
            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={index} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Medicine {index + 1}
                    </p>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove medicine ${index + 1}`}
                        onClick={() => setItems((p) => p.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Medicine">
                      <Select
                        value={item.medicine}
                        onValueChange={(v) => {
                          const med = catalogue.find((m) => m.name === v)
                          updateItem(index, { medicine: v, strength: med?.strength ?? '' })
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={catalogue.length ? 'Select a medicine' : 'Loading catalogue…'} />
                        </SelectTrigger>
                        <SelectContent>
                          {catalogue.map((med) => (
                            <SelectItem key={med.id} value={med.name}>
                              {med.name}
                              {med.status === 'Out of Stock' && ' — out of stock'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Dosage">
                      <Input value={item.dosage} onChange={(e) => updateItem(index, { dosage: e.target.value })} />
                    </Field>
                    <Field label="Frequency">
                      <Select value={item.frequency} onValueChange={(v) => updateItem(index, { frequency: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FREQUENCIES.map((f) => (
                            <SelectItem key={f} value={f}>
                              {f}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Duration">
                      <Input value={item.duration} onChange={(e) => updateItem(index, { duration: e.target.value })} />
                    </Field>
                    <Field label="Quantity">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Instructions">
                      <Input
                        value={item.instructions}
                        onChange={(e) => updateItem(index, { instructions: e.target.value })}
                        placeholder="Take after food"
                      />
                    </Field>
                  </div>

                  {item.medicine && outOfStock(item.medicine) && (
                    <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/[0.07] px-3 py-2 text-[12px] text-destructive">
                      This medicine is currently out of stock. The pharmacy will suggest a substitution.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Follow-up" description="Stored on the consultation record when it is saved.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Follow-up date" htmlFor="follow-date">
                <Input id="follow-date" type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
              </Field>
              <Field label="Appointment type">
                <Select value={followUpType} onValueChange={setFollowUpType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['Follow-up', 'Therapy Review', 'Post-op Review', 'Assessment'].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              The date is stored with the encounter and drives the dashboard&rsquo;s follow-up list.
              Booking the slot itself is done at reception.
            </p>
          </SectionCard>
        </div>

        {/* ----------------------------- Patient summary ---------------------------- */}
        <aside className="space-y-5">
          <SectionCard title="Patient summary" delay={0.05}>
            <div className="flex items-center gap-3">
              <InitialsAvatar initials={patient.initials} color={patient.avatarColor} className="size-12 text-sm" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{patient.name}</p>
                <p className="num truncate text-[12px] text-muted-foreground">
                  {patient.id} · {patient.age} yrs · {patient.gender} · {patient.bloodGroup}
                </p>
              </div>
            </div>

            <Separator className="my-4" />

            <dl className="space-y-2.5 text-[12.5px]">
              {[
                ['Condition', patient.primaryCondition],
                ['Department', patient.department],
                ['Therapist', patient.assignedTherapist],
                ['Last visit', formatDate(patient.lastVisit)],
                patient.bed ? ['Bed', `${patient.ward} · ${patient.bed}`] : null,
              ]
                .filter(Boolean)
                .map((row) => {
                  const [label, value] = row as [string, string]
                  return (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="shrink-0 text-muted-foreground">{label}</dt>
                      <dd className="text-right font-medium">{value}</dd>
                    </div>
                  )
                })}
            </dl>

            {patient.allergies.length > 0 && (
              <>
                <Separator className="my-4" />
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-destructive">Allergies</p>
                <div className="flex flex-wrap gap-1.5">
                  {patient.allergies.map((allergy) => (
                    <Badge key={allergy} variant="danger">
                      {allergy}
                    </Badge>
                  ))}
                </div>
              </>
            )}

            <Button asChild variant="outline" className="mt-4 w-full">
              <Link to={`/patients/${patient.id}`}>Open Patient 360</Link>
            </Button>
          </SectionCard>

          <SectionCard
            title="Vitals"
            description={vitals ? `Last recorded by ${vitals.recordedBy}` : 'No observations recorded yet'}
            icon={<Activity />}
            delay={0.1}
          >
            {vitals && (
              <div className="mb-4 grid grid-cols-2 gap-3">
                <StatTile label="BP" value={`${vitals.systolic ?? '—'}/${vitals.diastolic ?? '—'}`} hint="mmHg" />
                <StatTile label="Heart rate" value={vitals.heartRate ?? '—'} hint="bpm" />
                <StatTile
                  label="SpO₂"
                  value={vitals.spo2 !== null ? `${vitals.spo2}%` : '—'}
                  tone={vitals.spo2 !== null && vitals.spo2 < 95 ? 'warning' : 'success'}
                />
                <StatTile label="Temp" value={vitals.temperature !== null ? `${vitals.temperature}°C` : '—'} />
              </div>
            )}

            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Record new observations
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['systolic', 'Systolic'],
                  ['diastolic', 'Diastolic'],
                  ['heartRate', 'Heart rate'],
                  ['spo2', 'SpO₂ %'],
                  ['temperature', 'Temp °C'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    type="number"
                    step={key === 'temperature' ? '0.1' : '1'}
                    value={obs[key]}
                    onChange={(e) => setObs((o) => ({ ...o, [key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-3 w-full"
              loading={recording}
              onClick={saveVitals}
            >
              Save observations
            </Button>
          </SectionCard>

          {labs.length > 0 && (
            <SectionCard title="Recent labs" description="Reports for this patient." icon={<FlaskConical />} delay={0.15}>
              <ul className="space-y-2.5">
                {labs.slice(0, 4).map((lab) => (
                  <li key={lab.id} className="rounded-lg border border-border px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[12.5px] font-medium">{lab.test}</p>
                      <Badge variant={FLAG_TONE[lab.flag]}>{lab.flag}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {formatDate(lab.reportedOn)} · {lab.reviewed ? 'Reviewed' : 'Awaiting review'}
                    </p>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="mt-3 w-full">
                <Link to="/doctor/labs">Open lab results</Link>
              </Button>
            </SectionCard>
          )}

          <SectionCard title="Recent history" delay={0.2}>
            {historyEntries.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-muted-foreground">
                No history recorded for this patient.
              </p>
            ) : (
              <ul className="space-y-3">
                {historyEntries.slice(0, 4).map((entry) => (
                  <li key={entry.id} className="border-l-2 border-border pl-3">
                    <p className="text-[12.5px] font-medium leading-snug">{entry.title}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {entry.type} · {formatDate(entry.date)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline" className="mt-3 w-full">
              <Link to={`/patients/${patient.id}`}>Full medical history</Link>
            </Button>
          </SectionCard>

          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3.5 py-3 text-[12px] text-muted-foreground">
            <Check className="size-4 shrink-0 text-success" />
            Saving records the encounter and writes the prescription against it.
          </div>
        </aside>
      </div>
    </form>
  )
}
