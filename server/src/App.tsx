import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Permission } from '@/types'
import { AppShell } from '@/components/layout/AppShell'
import { RedirectIfAuthenticated, RequireAuth } from '@/components/layout/RouteGuards'
import { FullPageSkeleton } from '@/components/layout/PageSkeleton'

/**
 * Every page is code-split. The shell itself is eager, so switching screens
 * swaps only the page chunk and the sidebar/topbar never remount.
 */
const Landing = lazy(() => import('@/pages/Landing'))
const Login = lazy(() => import('@/pages/Login'))
const NotFound = lazy(() => import('@/pages/NotFound'))

const OwnerDashboard = lazy(() => import('@/pages/owner/Dashboard'))
const OwnerAnalytics = lazy(() => import('@/pages/owner/Analytics'))
const OwnerRevenue = lazy(() => import('@/pages/owner/Revenue'))
const OwnerOccupancy = lazy(() => import('@/pages/owner/Occupancy'))
const OwnerTherapy = lazy(() => import('@/pages/owner/TherapyUtilisation'))

const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'))
const AdminStaff = lazy(() => import('@/pages/admin/Staff'))
const AdminRoles = lazy(() => import('@/pages/admin/Roles'))
const AdminDepartments = lazy(() => import('@/pages/admin/Departments'))
const AdminBranches = lazy(() => import('@/pages/admin/Branches'))
const AdminConfiguration = lazy(() => import('@/pages/admin/Configuration'))
const AdminAudit = lazy(() => import('@/pages/admin/AuditLog'))

const DoctorDashboard = lazy(() => import('@/pages/doctor/Dashboard'))
const DoctorAppointments = lazy(() => import('@/pages/doctor/Appointments'))
const DoctorConsultations = lazy(() => import('@/pages/doctor/Consultations'))
const Consultation = lazy(() => import('@/pages/doctor/Consultation'))
const DoctorPrescriptions = lazy(() => import('@/pages/doctor/Prescriptions'))
const DoctorLabs = lazy(() => import('@/pages/doctor/Labs'))

const TherapistDashboard = lazy(() => import('@/pages/therapist/Dashboard'))
const TherapistSessions = lazy(() => import('@/pages/therapist/Sessions'))
const TherapySessionEntry = lazy(() => import('@/pages/therapist/SessionEntry'))
const TherapistProgress = lazy(() => import('@/pages/therapist/Progress'))

const NurseDashboard = lazy(() => import('@/pages/nurse/Dashboard'))
const NurseTasks = lazy(() => import('@/pages/nurse/Tasks'))
const NurseVitals = lazy(() => import('@/pages/nurse/Vitals'))
const NurseDischarges = lazy(() => import('@/pages/nurse/Discharges'))

const PharmacistDashboard = lazy(() => import('@/pages/pharmacist/Dashboard'))
const PharmacyPrescriptions = lazy(() => import('@/pages/pharmacist/Prescriptions'))
const PharmacyInventory = lazy(() => import('@/pages/pharmacist/Inventory'))
const PharmacyPOS = lazy(() => import('@/pages/pharmacist/POS'))
const PharmacyAlerts = lazy(() => import('@/pages/pharmacist/StockAlerts'))

const ReceptionDashboard = lazy(() => import('@/pages/reception/Dashboard'))
const ReceptionQueue = lazy(() => import('@/pages/reception/Queue'))
const ReceptionRegister = lazy(() => import('@/pages/reception/Register'))

const AccountantDashboard = lazy(() => import('@/pages/accountant/Dashboard'))
const AccountantPayments = lazy(() => import('@/pages/accountant/Payments'))
const AccountantOutstanding = lazy(() => import('@/pages/accountant/Outstanding'))
const AccountantExpenses = lazy(() => import('@/pages/accountant/Expenses'))
const AccountantPnl = lazy(() => import('@/pages/accountant/ProfitAndLoss'))

const Patients = lazy(() => import('@/pages/shared/Patients'))
const Patient360 = lazy(() => import('@/pages/shared/Patient360'))
const AppointmentsPage = lazy(() => import('@/pages/shared/Appointments'))
const Beds = lazy(() => import('@/pages/shared/Beds'))
const RehabPlans = lazy(() => import('@/pages/shared/RehabPlans'))
const Invoices = lazy(() => import('@/pages/shared/Invoices'))
const Reports = lazy(() => import('@/pages/shared/Reports'))
const Settings = lazy(() => import('@/pages/shared/Settings'))
const AiAssistant = lazy(() => import('@/pages/shared/AiAssistant'))

/** Route element with the permission required to open it. */
const guarded = (element: React.ReactNode, permission?: Permission | Permission[]) => (
  <RequireAuth permission={permission}>{element}</RequireAuth>
)

export default function App() {
  return (
    <Suspense fallback={<FullPageSkeleton />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <Login />
            </RedirectIfAuthenticated>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          {/* ------------------------------- Owner ------------------------------ */}
          <Route path="/owner/dashboard" element={guarded(<OwnerDashboard />, 'analytics.business')} />
          <Route path="/owner/analytics" element={guarded(<OwnerAnalytics />, 'analytics.business')} />
          <Route path="/owner/revenue" element={guarded(<OwnerRevenue />, 'analytics.business')} />
          <Route path="/owner/occupancy" element={guarded(<OwnerOccupancy />, 'beds.view')} />
          <Route path="/owner/therapy" element={guarded(<OwnerTherapy />, 'therapy.progress.view')} />

          {/* ------------------------------- Admin ------------------------------ */}
          <Route path="/admin/dashboard" element={guarded(<AdminDashboard />, 'staff.manage')} />
          <Route path="/admin/staff" element={guarded(<AdminStaff />, 'staff.manage')} />
          <Route path="/admin/roles" element={guarded(<AdminRoles />, 'roles.manage')} />
          <Route path="/admin/departments" element={guarded(<AdminDepartments />, 'settings.manage')} />
          <Route path="/admin/branches" element={guarded(<AdminBranches />, 'branches.manage')} />
          <Route path="/admin/configuration" element={guarded(<AdminConfiguration />, 'settings.manage')} />
          <Route path="/admin/audit" element={guarded(<AdminAudit />, 'audit.view')} />

          {/* ------------------------------ Doctor ------------------------------ */}
          <Route path="/doctor/dashboard" element={guarded(<DoctorDashboard />, 'consultation.manage')} />
          <Route path="/doctor/appointments" element={guarded(<DoctorAppointments />, 'appointment.view')} />
          <Route path="/doctor/consultations" element={guarded(<DoctorConsultations />, 'consultation.manage')} />
          <Route path="/doctor/consultations/:patientId" element={guarded(<Consultation />, 'consultation.manage')} />
          <Route path="/doctor/prescriptions" element={guarded(<DoctorPrescriptions />, 'prescription.create')} />
          <Route path="/doctor/labs" element={guarded(<DoctorLabs />, 'patient.clinical.view')} />

          {/* ----------------------------- Therapist ---------------------------- */}
          <Route path="/therapist/dashboard" element={guarded(<TherapistDashboard />, 'therapy.session.manage')} />
          <Route path="/therapist/sessions" element={guarded(<TherapistSessions />, 'therapy.session.manage')} />
          <Route
            path="/therapist/sessions/:sessionId"
            element={guarded(<TherapySessionEntry />, 'therapy.session.manage')}
          />
          <Route path="/therapist/progress" element={guarded(<TherapistProgress />, 'therapy.progress.view')} />

          {/* ------------------------------- Nurse ------------------------------ */}
          <Route path="/nurse/dashboard" element={guarded(<NurseDashboard />, 'nursing.tasks')} />
          <Route path="/nurse/tasks" element={guarded(<NurseTasks />, 'nursing.tasks')} />
          <Route path="/nurse/vitals" element={guarded(<NurseVitals />, 'vitals.record')} />
          <Route path="/nurse/discharges" element={guarded(<NurseDischarges />, 'nursing.tasks')} />

          {/* ----------------------------- Pharmacist --------------------------- */}
          <Route path="/pharmacist/dashboard" element={guarded(<PharmacistDashboard />, 'pharmacy.inventory')} />
          <Route path="/pharmacy/prescriptions" element={guarded(<PharmacyPrescriptions />, 'prescription.dispense')} />
          <Route path="/pharmacy/inventory" element={guarded(<PharmacyInventory />, 'pharmacy.inventory')} />
          <Route path="/pharmacy/pos" element={guarded(<PharmacyPOS />, 'pharmacy.pos')} />
          <Route path="/pharmacy/alerts" element={guarded(<PharmacyAlerts />, 'pharmacy.inventory')} />

          {/* ---------------------------- Receptionist -------------------------- */}
          <Route path="/reception/dashboard" element={guarded(<ReceptionDashboard />, 'appointment.checkin')} />
          <Route path="/reception/queue" element={guarded(<ReceptionQueue />, 'appointment.checkin')} />
          <Route path="/reception/register" element={guarded(<ReceptionRegister />, 'patient.create')} />

          {/* ----------------------------- Accountant --------------------------- */}
          <Route path="/accountant/dashboard" element={guarded(<AccountantDashboard />, 'payments.manage')} />
          <Route path="/accountant/payments" element={guarded(<AccountantPayments />, 'payments.manage')} />
          <Route path="/accountant/outstanding" element={guarded(<AccountantOutstanding />, 'payments.manage')} />
          <Route path="/accountant/expenses" element={guarded(<AccountantExpenses />, 'expenses.manage')} />
          <Route path="/accountant/pnl" element={guarded(<AccountantPnl />, 'finance.reports')} />

          {/* ------------------------------- Shared ----------------------------- */}
          <Route path="/patients" element={guarded(<Patients />, 'patient.view')} />
          <Route path="/patients/:patientId" element={guarded(<Patient360 />, 'patient.view')} />
          <Route path="/appointments" element={guarded(<AppointmentsPage />, 'appointment.view')} />
          <Route path="/beds" element={guarded(<Beds />, 'beds.view')} />
          <Route path="/rehab/plans" element={guarded(<RehabPlans />, 'rehab.plan.view')} />
          <Route path="/billing/invoices" element={guarded(<Invoices />, 'billing.view')} />
          <Route path="/reports" element={guarded(<Reports />)} />
          <Route path="/settings" element={guarded(<Settings />)} />
          {/* No permission on the route itself: the page shows only the panels the
              caller's existing keys unlock, and hides itself entirely when that
              is none of them. */}
          <Route path="/ai" element={guarded(<AiAssistant />)} />

          <Route path="/dashboard" element={<Navigate to="/" replace />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
