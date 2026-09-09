import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BedDouble, Calendar, Mail, MapPin, Phone, ShieldCheck, Stethoscope, HeartPulse } from 'lucide-react'
import type { Patient } from '@/types'
import { StatusBadge } from '@/components/ui/status'
import { Badge } from '@/components/ui/badge'
import { InitialsAvatar } from '@/components/ui/misc'
import { formatDate, inr } from '@/lib/utils'

export function PatientHeader({ patient }: { patient: Patient }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
    >
      <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between lg:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <InitialsAvatar
            initials={patient.initials}
            color={patient.avatarColor}
            className="size-16 text-lg sm:size-[72px] sm:text-xl"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-[22px] font-bold tracking-tight lg:text-2xl">{patient.name}</h1>
              <StatusBadge status={patient.status} />
              {patient.allergies.length > 0 && (
                <Badge variant="danger">
                  {patient.allergies.length} allerg{patient.allergies.length === 1 ? 'y' : 'ies'}
                </Badge>
              )}
            </div>

            <p className="num mt-1 text-[13px] text-muted-foreground">
              {patient.id} · {patient.age} yrs · {patient.gender} · Blood group {patient.bloodGroup}
            </p>

            <p className="mt-2 text-[13.5px] font-medium">{patient.primaryCondition}</p>

            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                <a href={`tel:${patient.phone}`} className="num hover:text-foreground">
                  {patient.phone}
                </a>
              </li>
              <li className="flex items-center gap-1.5">
                <Mail className="size-3.5" />
                <a href={`mailto:${patient.email}`} className="hover:text-foreground">
                  {patient.email}
                </a>
              </li>
              <li className="flex min-w-0 items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{patient.address}</span>
              </li>
            </ul>
          </div>
        </div>

        <dl className="grid shrink-0 grid-cols-2 gap-3 lg:w-[420px] lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/35 px-3.5 py-2.5">
            <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Stethoscope className="size-3" />
              Assigned doctor
            </dt>
            <dd className="mt-1 truncate text-[13px] font-medium">{patient.assignedDoctor}</dd>
          </div>

          <div className="rounded-lg border border-border bg-muted/35 px-3.5 py-2.5">
            <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <HeartPulse className="size-3" />
              Assigned therapist
            </dt>
            <dd className="mt-1 truncate text-[13px] font-medium">{patient.assignedTherapist}</dd>
          </div>

          <div className="rounded-lg border border-border bg-muted/35 px-3.5 py-2.5">
            <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {patient.bed ? <BedDouble className="size-3" /> : <Calendar className="size-3" />}
              {patient.bed ? 'Bed' : 'Next appointment'}
            </dt>
            <dd className="mt-1 truncate text-[13px] font-medium">
              {patient.bed ? (
                `${patient.ward} · ${patient.bed}`
              ) : patient.nextAppointment ? (
                patient.nextAppointment.replace(' ', ' at ')
              ) : (
                <span className="text-muted-foreground">Not scheduled</span>
              )}
            </dd>
          </div>

          <div className="rounded-lg border border-border bg-muted/35 px-3.5 py-2.5">
            <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3" />
              Outstanding
            </dt>
            <dd
              className={`num mt-1 truncate text-[13px] font-medium ${
                patient.outstandingAmount > 0 ? 'text-destructive' : 'text-success'
              }`}
            >
              {patient.outstandingAmount > 0 ? inr(patient.outstandingAmount) : 'Cleared'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border bg-muted/25 px-5 py-2.5 text-[12px] text-muted-foreground lg:px-6">
        <span>Registered {formatDate(patient.registeredOn)}</span>
        <span>Last visit {formatDate(patient.lastVisit)}</span>
        {patient.admittedOn && <span>Admitted {formatDate(patient.admittedOn)}</span>}
        {patient.insurance && (
          <span>
            {patient.insurance.provider} · <span className="num">{patient.insurance.policyNo}</span>
          </span>
        )}
        <Link to="/patients" className="ml-auto font-medium text-accent hover:underline">
          All patients
        </Link>
      </div>
    </motion.section>
  )
}
