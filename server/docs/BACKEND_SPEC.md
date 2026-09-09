# Backend Specification — derived from the existing frontend

**Status:** Analysis only. No backend code, no database, no frontend changes.
**Purpose:** Input specification for Step 2 (FastAPI + PostgreSQL setup).
**Method:** Every statement below was read out of the existing source tree, not assumed.

---

## 1. Frontend technology

| Concern | What is actually there |
| --- | --- |
| Framework | React 18.3.1 (function components + hooks only) |
| Language | TypeScript 5.7, `strict: true`, `noUnusedLocals`, `noUnusedParameters` |
| Build | Vite 6.0, alias `@/* → src/*`, route-level `React.lazy` code splitting |
| Routing | `react-router-dom` 6.29 — `BrowserRouter` in `main.tsx`, one `<Routes>` table in `App.tsx` |
| Styling | Tailwind CSS 3.4, `darkMode: 'class'`, HSL design tokens in `src/index.css` |
| Components | shadcn/ui-style, hand-written on Radix primitives (`src/components/ui/`) |
| Charts | Recharts 2.15 (`src/components/charts/`) |
| Animation | Framer Motion 11 |
| Icons | lucide-react |
| State | React Context only — `AuthContext`, `ThemeContext`, `NotificationContext`, plus local `useState`. **No Redux, Zustand, React Query or SWR.** |
| Data layer | **None.** `grep` for `fetch(`, `axios`, `XMLHttpRequest`, `VITE_API` across `src/` returns zero matches. |
| Persistence | `localStorage` / `sessionStorage` only, three keys (§9) |

**Headline finding:** there is no HTTP layer of any kind. Every screen imports TypeScript
constants directly from `src/data/*.ts`. A centralised API client has to be created from scratch,
and there is no existing service directory to slot into.

---

## 2. Existing routes

53 `<Route>` entries in `src/App.tsx`. Guards come from `RequireAuth` in
`src/components/layout/RouteGuards.tsx`; each guarded route declares one permission.

### Public

| Path | Component | Guard |
| --- | --- | --- |
| `/` | `Landing` | none |
| `/login` | `Login` | `RedirectIfAuthenticated` → sends signed-in users to `ROLE_HOME[role]` |
| `*` | `NotFound` | none |

### Authenticated (all nested inside `<AppShell />`)

| Path | Required permission |
| --- | --- |
| `/owner/dashboard` | `analytics.business` |
| `/owner/analytics` | `analytics.business` |
| `/owner/revenue` | `analytics.business` |
| `/owner/occupancy` | `beds.view` |
| `/owner/therapy` | `therapy.progress.view` |
| `/admin/dashboard` | `staff.manage` |
| `/admin/staff` | `staff.manage` |
| `/admin/roles` | `roles.manage` |
| `/admin/departments` | `settings.manage` |
| `/admin/branches` | `branches.manage` |
| `/admin/configuration` | `settings.manage` |
| `/admin/audit` | `audit.view` |
| `/doctor/dashboard` | `consultation.manage` |
| `/doctor/appointments` | `appointment.view` |
| `/doctor/consultations` | `consultation.manage` |
| `/doctor/consultations/:patientId` | `consultation.manage` |
| `/doctor/prescriptions` | `prescription.create` |
| `/doctor/labs` | `patient.clinical.view` |
| `/therapist/dashboard` | `therapy.session.manage` |
| `/therapist/sessions` | `therapy.session.manage` |
| `/therapist/sessions/:sessionId` | `therapy.session.manage` |
| `/therapist/progress` | `therapy.progress.view` |
| `/nurse/dashboard` | `nursing.tasks` |
| `/nurse/tasks` | `nursing.tasks` |
| `/nurse/vitals` | `vitals.record` |
| `/nurse/discharges` | `nursing.tasks` |
| `/pharmacist/dashboard` | `pharmacy.inventory` |
| `/pharmacy/prescriptions` | `prescription.dispense` |
| `/pharmacy/inventory` | `pharmacy.inventory` |
| `/pharmacy/pos` | `pharmacy.pos` |
| `/pharmacy/alerts` | `pharmacy.inventory` |
| `/reception/dashboard` | `appointment.checkin` |
| `/reception/queue` | `appointment.checkin` |
| `/reception/register` | `patient.create` |
| `/accountant/dashboard` | `payments.manage` |
| `/accountant/payments` | `payments.manage` |
| `/accountant/outstanding` | `payments.manage` |
| `/accountant/expenses` | `expenses.manage` |
| `/accountant/pnl` | `finance.reports` |
| `/patients` | `patient.view` |
| `/patients/:patientId` | `patient.view` |
| `/appointments` | `appointment.view` |
| `/beds` | `beds.view` |
| `/rehab/plans` | `rehab.plan.view` |
| `/billing/invoices` | `billing.view` |
| `/reports` | authenticated only |
| `/settings` | authenticated only |
| `/dashboard` | redirect → `/` |

---

## 3. Existing roles

`src/types/index.ts` defines **8 lowercase role literals**:

```
'owner' | 'admin' | 'doctor' | 'therapist' | 'nurse' | 'pharmacist' | 'receptionist' | 'accountant'
```

`src/lib/permissions.ts` defines **33 permissions** and a `ROLE_PERMISSIONS` matrix:

| Role | Permissions granted | Home route |
| --- | --- | --- |
| owner | 10 | `/owner/dashboard` |
| admin | 20 | `/admin/dashboard` |
| doctor | 13 | `/doctor/dashboard` |
| therapist | 8 | `/therapist/dashboard` |
| nurse | 8 | `/nurse/dashboard` |
| pharmacist | 5 | `/pharmacist/dashboard` |
| receptionist | 9 | `/reception/dashboard` |
| accountant | 7 | `/accountant/dashboard` |

Full permission vocabulary (grouped as the Roles screen groups them):

```
patients      patient.view  patient.create  patient.edit
              patient.clinical.view  patient.clinical.edit
scheduling    appointment.view  appointment.create  appointment.checkin
clinical      consultation.manage  prescription.create  prescription.dispense
              vitals.record  nursing.tasks
rehab         rehab.plan.view  rehab.plan.manage
              therapy.session.manage  therapy.progress.view
pharmacy      pharmacy.inventory  pharmacy.pos
finance       billing.view  billing.manage  payments.manage
              expenses.manage  finance.reports
operations    beds.view  beds.manage  analytics.business  analytics.operational
system        staff.manage  roles.manage  branches.manage  audit.view  settings.manage
```

`src/lib/navigation.ts` maps each role to its sidebar sections; every `NavItem` carries an
optional `permission`, and the sidebar filters on it. **Static badge counts are hardcoded in this
file** (e.g. doctor Appointments `9`, pharmacist Stock Alerts `8`, accountant Outstanding `12`) —
these are `MOCK → NEEDS API`.

---

## 4. Pages by role

| Role | Frontend Pages | Main Actions | Data Required |
| --- | --- | --- | --- |
| **OWNER** | `/owner/dashboard`, `/owner/analytics`, `/owner/revenue`, `/owner/occupancy`, `/owner/therapy`, `/patients`, `/patients/:id`, `/reports`, `/admin/audit`, `/settings` | Read-only. Filter report period (6m/12m). Export report pack (stub). | 6 KPIs (today revenue, monthly revenue, profit, occupancy %, total patients, therapy utilisation) each with a % delta; 12-month revenue/expenses/profit series; department revenue split; 6-month new-vs-returning volume; bed summary counts; therapist workload (booked/capacity/utilisation); package utilisation (sold/consumed/revenue); alert list (low stock, near expiry, outstanding total) |
| **ADMIN** | `/admin/dashboard`, `/admin/staff`, `/admin/roles`, `/admin/departments`, `/admin/branches`, `/admin/configuration`, `/admin/audit`, `/patients`, `/appointments`, `/beds`, `/pharmacy/inventory`, `/reports`, `/settings` | Invite staff (form); approve / suspend / reinstate account; toggle 33 permissions per role and save; edit branch details + service toggles; edit scheduling/billing/notification config; filter + export audit log | Staff directory (name, email, role, designation, department, branch, status, lastLogin); pending-approval list; service health list; activity feed; department list with staff/rooms/revenue/utilisation; branch config with services; config toggles |
| **DOCTOR** | `/doctor/dashboard`, `/doctor/appointments`, `/doctor/consultations`, `/doctor/consultations/:patientId`, `/doctor/prescriptions`, `/doctor/labs`, `/patients`, `/patients/:id`, `/rehab/plans`, `/reports`, `/settings` | Open/record a consultation (chief complaint, examination, diagnosis, care plan, notes, prescription lines, follow-up date) → **submits**; mark lab result reviewed | Today's appointments for *this* doctor with status + check-in time; next-patient card; pending-items list (lab results, overdue follow-ups, unconfirmed prescriptions, plateaued plans); patient summary + latest vitals + rehab plan + recent history in the consultation sidebar; medicine catalogue with live stock for the prescription picker; lab results with analyte rows |
| **THERAPIST** | `/therapist/dashboard`, `/therapist/sessions`, `/therapist/sessions/:sessionId`, `/therapist/progress`, `/patients`, `/patients/:id`, `/rehab/plans`, `/reports`, `/settings` | Record a therapy session (type, duration, tolerance, exercise checklist, pain before/after, mobility, strength, notes, next session date/time) → **submits** | Today's sessions for *this* therapist; in-progress/next session card; assigned-patient cards with plan %, sessions done/total, pain delta, attendance; alerts for plateaued/at-risk plans and missed sessions; per-patient weekly progress series; exercise library by therapy type; plan milestones |
| **NURSE** | `/nurse/dashboard`, `/nurse/tasks`, `/nurse/vitals`, `/nurse/discharges`, `/patients`, `/patients/:id`, `/beds`, `/settings` | Tick/untick nursing task; record a vitals observation (6 fields) → **submits**; tick discharge checklist items; complete a discharge (gated on 100% checklist) | IPD patients grouped ward → room → bed; nursing tasks with type/priority/due; latest + historical vitals per patient with out-of-range highlighting; discharge queue with blockers and billing balance |
| **PHARMACIST** | `/pharmacist/dashboard`, `/pharmacy/prescriptions`, `/pharmacy/inventory`, `/pharmacy/pos`, `/pharmacy/alerts`, `/patients`, `/reports`, `/settings` | Dispense a prescription (stock-checked); raise a reorder / reorder-all; complete a POS sale (cart, qty, discount %, payment method) → **submits** | Prescription queue with items, quantities, priority, status; full stock register (batch, qty, threshold, unit/MRP price, expiry, rack, status); derived Low Stock / Near Expiry / Out of Stock buckets; today's sales + orders + AOV; 7-day sales series |
| **RECEPTIONIST** | `/reception/dashboard`, `/reception/queue`, `/reception/register`, `/patients`, `/patients/:id`, `/appointments`, `/beds`, `/billing/invoices`, `/settings` | Register a patient (16-field form incl. emergency contact + optional insurance + first appointment) → **submits**; book an appointment → **submits**; check in; send to consultation; mark visit done; create an invoice → **submits**; record full payment | Today's appointment list with doctor/type/check-in/status; token-ordered queue with wait minutes; bed availability by ward; doctor list for booking; patient list for invoice/appointment pickers; consultation fee by appointment type |
| **ACCOUNTANT** | `/accountant/dashboard`, `/accountant/payments`, `/accountant/outstanding`, `/accountant/expenses`, `/accountant/pnl`, `/billing/invoices`, `/patients`, `/reports`, `/settings` | Retry a failed payment; send reminder / remind-all; categorise + approve an expense; record an expense → **submits**; create invoice, record payment | Today's collections; payment-method breakdown; payment ledger with collector + status; outstanding invoices with days-overdue and ageing buckets; expense list with pending-categorisation flag; 6-month revenue/expense/profit series; P&L comparison table |

---

## 5. Entities / data models

Twenty-two shapes are declared in `src/types/index.ts`; three more are declared page-locally.
`?` marks optional.

| Entity | Fields | Relationships | Used By |
| --- | --- | --- | --- |
| **User** | id, name, email, role, designation, department, avatarColor, initials, branch, phone, lastLogin, status(`active\|suspended\|pending`) | belongs to Branch; referenced by Appointment.doctor, RehabPlan.primaryTherapist, TherapySession.therapist, Vitals.recordedBy, Payment.collectedBy — **all by display name string, not id** | AuthContext, Topbar, Sidebar, admin/Staff, admin/Roles, admin/Dashboard, reception/Register, shared/Appointments, Settings, Login |
| **Patient** | id, name, age, gender, phone, email, address, bloodGroup, avatarColor, initials, status, registeredOn, primaryCondition, assignedDoctor, assignedTherapist, department, ward?, room?, bed?, admittedOn?, expectedDischarge?, emergencyContact{name,relation,phone}, insurance?{provider,policyNo,validTill}, allergies[], vitals[], history[], rehabPlan?, progress[], documents[], lastVisit, nextAppointment?, outstandingAmount | 1→N Vitals, MedicalHistoryEntry, ProgressPoint, DocumentRecord; 1→0..1 RehabPlan; referenced by Appointment, TherapySession, Prescription, Invoice, Bed, NursingTask | Patients, Patient360, GlobalSearch, all clinical screens, POS, Invoices, Outstanding |
| **Vitals** | recordedAt, recordedBy, systolic, diastolic, heartRate, temperature, spo2, respiratoryRate | N→1 Patient; recordedBy → User (name) | Patient360 (Vitals tab, Overview), nurse/Vitals, nurse/Dashboard, doctor/Consultation |
| **MedicalHistoryEntry** | id, date, type(`Diagnosis\|Surgery\|Injury\|Allergy\|Chronic Condition\|Lab Result`), title, detail, clinician | N→1 Patient | Patient360 (History + Overview), doctor/Consultation sidebar |
| **ProgressPoint** | week, pain, mobility, strength, adherence | N→1 Patient (weekly rollup) | RehabProgressChart, RehabProgressPanel, therapist/Progress, therapist/Dashboard, Patient360 |
| **RehabPlan** | id, title, goal, startDate, targetEndDate, totalSessions, completedSessions, frequencyPerWeek, primaryTherapist, modalities[], trend(`On Track\|Ahead of Plan\|Plateaued\|At Risk\|Completed`), attendanceRate, adherenceRate, milestones[{label,done,date}] | 1→1 Patient; 1→N TherapySession; 1→N milestone | RehabPlans, RehabProgressPanel, therapist/*, doctor/Dashboard, Patient360 |
| **TherapySession** | id, patientId, patientName, date, time, durationMinutes, type(7 TherapyTypes), therapist, therapistId, status(`Scheduled\|In Progress\|Completed\|Missed`), exercises[], painBefore?, painAfter?, mobilityScore?, strengthScore?, notes?, room | N→1 Patient; N→1 RehabPlan (implicit — **no `rehabPlanId` field exists today**); N→1 therapist User | therapist/Sessions, SessionEntry, therapist/Dashboard, Patient360 |
| **Appointment** | id, patientId, patientName, patientAge, patientGender, time, date, doctor, doctorId, type(6), department, status(7), checkedInAt?, tokenNumber, notes? | N→1 Patient; N→1 doctor User | doctor/Appointments, doctor/Dashboard, doctor/Consultations, reception/*, shared/Appointments, Patient360, AppointmentTimeline |
| **Prescription** | id, patientId, patientName, doctor, date, items[], status(`Pending\|Partially Dispensed\|Dispensed\|Cancelled`), priority(`Routine\|Urgent`) | N→1 Patient; N→1 doctor; 1→N PrescriptionItem | doctor/Prescriptions, pharmacist/Prescriptions, PrescriptionDetail, Patient360 |
| **PrescriptionItem** | medicine, strength, dosage, frequency, duration, quantity, instructions | N→1 Prescription; medicine matched to Medicine **by name string** | same as above |
| **Medicine** | id, name, genericName, category, batch, quantity, threshold, unitPrice, mrp, expiry, manufacturer, rackLocation, status(`In Stock\|Low Stock\|Near Expiry\|Out of Stock`) | **flat — batch is embedded, not a separate entity** | pharmacist/Inventory, StockAlerts, POS, Prescriptions, doctor/Consultation, owner/Dashboard |
| **Invoice** | id, patientId, patientName, date, dueDate, amount, paid, status(`Paid\|Partially Paid\|Unpaid\|Overdue`), department(`OPD\|IPD\|Pharmacy\|Therapy\|Diagnostics`), items[{label,qty,rate}], method? | N→1 Patient; 1→N line items; related to Payment by `invoiceId` | shared/Invoices, owner/Revenue, accountant/*, nurse/Discharges, Patient360 |
| **PaymentRecord** | id, invoiceId, patientName, amount, method, date, collectedBy, status(`Settled\|Processing\|Failed`) | N→1 Invoice; collectedBy → User (name) | accountant/Payments, accountant/Dashboard, owner/Revenue |
| **Expense** | id, date, vendor, category(7), amount, method, status(`Recorded\|Pending Categorisation\|Approved`), reference | belongs to Branch (implied, no field) | accountant/Expenses, accountant/Dashboard |
| **Bed** | id, ward, room, bed, type(`General\|Semi-Private\|Private\|ICU\|Rehab Suite`), status(`Available\|Occupied\|Reserved\|Cleaning`), patientId?, patientName?, since?, dailyRate | N→1 Ward (ward is a **string**, no Ward entity); 0..1 Patient | shared/Beds, BedBoard, owner/Occupancy, reception/Dashboard, nurse/Dashboard |
| **NursingTask** | id, patientId, patientName, ward, bed, type(`Vitals\|Medication\|Doctor Instruction\|Care Task\|Therapy Prep`), label, due, priority(`Routine\|High\|Critical`), done | N→1 Patient | nurse/Tasks, nurse/Dashboard |
| **DocumentRecord** | id, name, type(`Report\|Scan\|Consent\|Insurance\|Discharge Summary`), size, uploadedOn, uploadedBy | N→1 Patient | Patient360 (Documents tab) |
| **Notification** | id, role, title, body, time, icon(6), severity(`info\|warning\|critical\|success`), read, href | targeted by **role**, not user id | NotificationsMenu, NotificationContext |
| **ActivityEvent** (audit) | id, actor, action, target, time, category(`auth\|staff\|patient\|pharmacy\|billing\|system`) | actor → User (name string) | admin/AuditLog, admin/Dashboard, ActivityTimeline |
| **LabResult** *(page-local, `doctor/Labs.tsx`)* | id, patientId, patientName, test, reportedOn, flag(`Normal\|Abnormal\|Critical`), summary, values[{analyte,value,reference,abnormal?}], reviewed | N→1 Patient | doctor/Labs, doctor/Dashboard pending list |
| **Department** *(page-local, `admin/Departments.tsx`)* | id, name, type(`Clinical\|Therapy\|Support`), head, staff, rooms, monthlyRevenue, utilisation | N→1 Branch | admin/Departments |
| **BranchConfig** *(page-local, `admin/Branches.tsx`)* | id, name, city, beds, address, phone, opensAt, closesAt, configured, services[] | 1→N Department, Ward, User | admin/Branches |
| **Organisation** *(`data/users.ts`)* | name, shortName, tagline, branches[{id,name,city,beds}] | 1→N Branch | Topbar branch switcher, Landing, Login |
| **NavItem / NavSection** | label, to, icon, badge?, permission? | — | Sidebar, MobileNav — **config, not persisted data** |

### Enum vocabularies the API must honour exactly

| Domain | Frontend literals (display strings) |
| --- | --- |
| Role | `owner` `admin` `doctor` `therapist` `nurse` `pharmacist` `receptionist` `accountant` |
| User status | `active` `suspended` `pending` |
| PatientStatus | `Active - OPD` `Admitted - IPD` `In Rehabilitation` `Discharge Pending` `Discharged` `Follow-up` |
| AppointmentStatus | `Scheduled` `Waiting` `In Consultation` `Completed` `Follow-up` `Cancelled` `No Show` |
| Appointment type | `New Consultation` `Follow-up` `Therapy Review` `Post-op Review` `Assessment` `Walk-in` |
| RehabTrend | `On Track` `Ahead of Plan` `Plateaued` `At Risk` `Completed` |
| TherapyType | `Physiotherapy` `Occupational Therapy` `Speech Therapy` `Neuro Rehabilitation` `Physical Rehabilitation` `Hydrotherapy` `Cardiac Rehabilitation` |
| Session status | `Scheduled` `In Progress` `Completed` `Missed` |
| StockStatus | `In Stock` `Low Stock` `Near Expiry` `Out of Stock` |
| Prescription status | `Pending` `Partially Dispensed` `Dispensed` `Cancelled` |
| Invoice status | `Paid` `Partially Paid` `Unpaid` `Overdue` |
| PaymentMethod | `Cash` `UPI` `Card` `Bank Transfer` `Insurance` |
| Payment status | `Settled` `Processing` `Failed` |
| Bed status | `Available` `Occupied` `Reserved` `Cleaning` |
| Expense status | `Recorded` `Pending Categorisation` `Approved` |
| Task priority | `Routine` `High` `Critical` |

---

## 6. Existing mock data

### 6a. Shared mock modules — `src/data/` (2,808 lines, all `MOCK → NEEDS API`)

| File | Lines | Exports the UI consumes |
| --- | --- | --- |
| `patients.ts` | 1,249 | `PATIENTS` (14 records), `PATIENT_BY_ID`, `getPatient()`, `searchPatients()`, `rehabCompletion()`, `IPD_PATIENTS`, `ACTIVE_PATIENTS`. Vitals/progress series are generated by a seeded PRNG. |
| `therapy.ts` | 298 | `THERAPY_SESSIONS` (14), `EXERCISE_LIBRARY`, `sessionsForTherapist()`, `sessionsForPatient()`, `THERAPIST_WORKLOAD` (5), `PACKAGE_UTILISATION` (5) |
| `billing.ts` | 293 | `INVOICES` (14), `PAYMENTS` (10), `EXPENSES` (10), `outstandingOf()`, `daysOverdue()`, `OUTSTANDING_INVOICES`, `TOTAL_OUTSTANDING`, `TODAYS_COLLECTIONS`, `PAYMENT_BREAKDOWN`, `PENDING_EXPENSES` |
| `users.ts` | 282 | `ORGANISATION` (3 branches), `DEMO_PASSWORD`, `DEMO_USERS`, `STAFF_DIRECTORY` (18), `findUserByEmail()` |
| `appointments.ts` | 220 | `TODAY` (`'2026-08-24'`), `APPOINTMENTS` (12), `TODAYS_APPOINTMENTS`, `appointmentsForDoctor()`, `CHECK_IN_QUEUE` |
| `medicines.ts` | 212 | `MEDICINES` (20), `PRESCRIPTIONS` (8), derived `LOW_STOCK`/`OUT_OF_STOCK`/`NEAR_EXPIRY`, `searchMedicines()`, `daysToExpiry()`, `PHARMACY_SALES_TODAY`, `PHARMACY_SALES_TREND` |
| `operations.ts` | 109 | `BEDS` (20), `BED_SUMMARY`, `OCCUPANCY_RATE`, `NURSING_TASKS` (12), `DISCHARGE_PENDING` (2), `ACTIVITY_FEED` (10), `PENDING_APPROVALS`, `SYSTEM_STATUS` |
| `analytics.ts` | 91 | `REVENUE_TREND` (12 mo), `DEPARTMENT_REVENUE`, `PATIENT_VOLUME`, `OCCUPANCY_TREND`, `THERAPY_UTILISATION_TREND`, `OWNER_KPIS`, `DOCTOR_PENDING`, `MONTHLY_PNL`, `EXPENSE_BREAKDOWN` — **entirely hardcoded dashboard numbers** |
| `notifications.ts` | 54 | `NOTIFICATIONS` (24), `notificationsForRole()` |

### 6b. Page-local mock data — also `MOCK → NEEDS API`

| Location | Constant | Note |
| --- | --- | --- |
| `doctor/Labs.tsx` | `RESULTS` (5 lab results) | Entity has no table anywhere yet |
| `admin/Departments.tsx` | `DEPARTMENTS` (11) | Includes revenue + utilisation → partly computed |
| `admin/Branches.tsx` | `BRANCHES` (3) | Address, hours, service toggles |
| `admin/Configuration.tsx` | `INITIAL_TOGGLES` (8) + GST/slot/prefix/grace fields | System settings |
| `admin/AuditLog.tsx` | `EXTENDED` (18 events) | Superset of `ACTIVITY_FEED` |
| `nurse/Discharges.tsx` | `BASE_CHECKLIST` (6 items) | Discharge workflow definition |
| `reception/Register.tsx` | `DEPARTMENTS`, `APPOINTMENT_TYPES`, `CONSULT_FEE` | Fee schedule |
| `shared/Settings.tsx` | `NOTIFICATION_PREFS` (4) | Per-user preferences |
| `shared/Reports.tsx` | `REPORT_LIBRARY` (6) | Report catalogue |
| `lib/navigation.ts` | badge numbers | Hardcoded counts |
| `components/layout/AIAssistant.tsx` | `CANNED` (9 regex→reply) | Explicitly a scripted demo; out of scope for now |

### 6c. Presentation constants — **stay client-side, no API**

`TONE_*` / `ICON_*` / `SEVERITY_*` maps, `PRIORITY_ORDER`, `TABS`, filter option lists
(`STATUSES`, `TRENDS`, `METHODS`, `CATEGORIES`, `TASK_TYPES`), `chart-theme.ts` palettes,
Landing page copy (`ROLE_CARDS`, `JOURNEY`, `REHAB_FEATURES`, `PREVIEW_*`), `RehabVisual`
sparkline, `GlobalSearch` `SUGGESTIONS`, `Roles.tsx` `GROUPS` + `PERMISSION_LABEL`.

---

## 7. API requirements

Derived strictly from screens that exist. Nothing added for completeness' sake.

```
Authentication
  POST   /api/auth/login
  GET    /api/auth/me
  POST   /api/auth/logout

Users / Staff                                 (admin/Staff, admin/Roles)
  GET    /api/users                           ?role=&status=&q=
  POST   /api/users                           invite
  PATCH  /api/users/{id}/status                approve | suspend | reinstate
  GET    /api/roles                           role → permission matrix
  PUT    /api/roles/{role}/permissions

Organisation                                   (admin/Branches, admin/Departments, Topbar)
  GET    /api/branches
  PUT    /api/branches/{id}
  GET    /api/departments
  GET    /api/settings                        config toggles + GST/slot/prefix/grace
  PUT    /api/settings

Patients
  GET    /api/patients                        ?page=&limit=&status=&scope=mine|all&q=
  POST   /api/patients                        reception/Register
  GET    /api/patients/{id}
  PUT    /api/patients/{id}
  GET    /api/patients/search?q=               GlobalSearch (name | patient no | phone)
  GET    /api/patients/{id}/360                Patient360 aggregate

Appointments
  GET    /api/appointments                    ?date=&doctorId=&status=
  POST   /api/appointments
  GET    /api/appointments/{id}
  PUT    /api/appointments/{id}
  PATCH  /api/appointments/{id}/status         check-in | send-in | complete | cancel

Consultations
  GET    /api/consultations                   ?doctorId=&date=
  POST   /api/consultations                   doctor/Consultation submit
  GET    /api/consultations/{id}
  PUT    /api/consultations/{id}
  GET    /api/patients/{id}/consultations

Rehabilitation
  GET    /api/rehab/plans                     ?trend=&therapistId=
  POST   /api/rehab/plans
  GET    /api/rehab/plans/{id}
  PUT    /api/rehab/plans/{id}
  GET    /api/rehab/plans/{id}/progress        weekly ProgressPoint series

Therapy
  GET    /api/therapy/sessions                ?date=&therapistId=&patientId=
  POST   /api/therapy/sessions
  GET    /api/therapy/sessions/{id}
  PUT    /api/therapy/sessions/{id}            SessionEntry submit → completes session
  GET    /api/therapy/exercise-library         keyed by therapy type

Nursing
  POST   /api/vitals
  GET    /api/patients/{id}/vitals
  GET    /api/nursing/tasks                   ?ward=&done=
  PATCH  /api/nursing/tasks/{id}               toggle done
  GET    /api/nursing/discharges               queue + blockers + balance
  POST   /api/nursing/discharges/{patientId}   complete discharge

Wards & beds
  GET    /api/beds                            ?ward=
  GET    /api/beds/summary                    available/occupied/reserved/cleaning

Pharmacy
  GET    /api/medicines                       ?q=&status=
  POST   /api/medicines
  PUT    /api/medicines/{id}
  GET    /api/medicines/{id}/batches
  POST   /api/medicines/{id}/batches
  GET    /api/medicines/alerts                low stock + near expiry + out of stock
  POST   /api/medicines/reorder               single or bulk
  GET    /api/prescriptions                   ?status=&doctorId=&patientId=
  POST   /api/prescriptions
  GET    /api/prescriptions/{id}
  POST   /api/prescriptions/{id}/dispense
  POST   /api/pharmacy/sales                  POS checkout

Billing
  GET    /api/invoices                        ?status=&patientId=
  POST   /api/invoices
  GET    /api/invoices/{id}
  PUT    /api/invoices/{id}
  GET    /api/invoices/outstanding            + ageing buckets
  GET    /api/payments
  POST   /api/payments
  POST   /api/payments/{id}/retry
  GET    /api/expenses                        ?status=
  POST   /api/expenses
  PATCH  /api/expenses/{id}/categorise

Labs                                           (doctor/Labs)
  GET    /api/labs/results                    ?reviewed=
  PATCH  /api/labs/results/{id}/review

Dashboards
  GET    /api/dashboard/owner
  GET    /api/dashboard/admin
  GET    /api/dashboard/doctor
  GET    /api/dashboard/therapist
  GET    /api/dashboard/nurse
  GET    /api/dashboard/pharmacist
  GET    /api/dashboard/receptionist
  GET    /api/dashboard/accountant

Reports                                        all accept ?from=&to=
  GET    /api/reports/revenue
  GET    /api/reports/patient-volume
  GET    /api/reports/department-revenue
  GET    /api/reports/occupancy
  GET    /api/reports/therapy-utilisation
  GET    /api/reports/payment-breakdown
  GET    /api/reports/profit-loss
  GET    /api/reports/therapist-workload
  GET    /api/reports/package-utilisation

Notifications
  GET    /api/notifications
  PUT    /api/notifications/{id}/read
  PUT    /api/notifications/read-all

Audit
  GET    /api/audit/logs                      ?category=&q=&page=
```

**Endpoints deliberately NOT proposed** (no screen needs them): patient delete (no delete UI
exists — `/patients` has no destructive action), user delete, appointment delete, medicine delete,
refunds, document upload (Documents tab is read + download only).

---

## 8. Frontend → API → Database mapping

```
Login form (email, password, remember me)
        ↓  POST /api/auth/login
        ↓  users  (email lookup, bcrypt verify, last_login update)
        ↓  audit_logs  (LOGIN)
        ↓  PostgreSQL

Global patient search (Ctrl+K — name | PT-code | phone)
        ↓  GET /api/patients/search?q=
        ↓  patients  (trigram / prefix index on name, patient_number, phone)
        ↓  PostgreSQL

Patient registration form (reception/Register)
        ↓  POST /api/patients
        ↓  patients + patient_emergency_contact + patient_insurance
        ↓  appointments        (first appointment, same transaction)
        ↓  invoices            (consultation fee from settings)
        ↓  audit_logs (PATIENT_CREATED)
        ↓  PostgreSQL

Patient 360 screen (10 tabs)
        ↓  GET /api/patients/{id}/360
        ↓  patients ⟕ appointments ⟕ medical_records ⟕ consultations
                    ⟕ rehab_plans ⟕ therapy_sessions ⟕ vitals
                    ⟕ prescriptions ⟕ prescription_items
                    ⟕ admissions ⟕ invoices ⟕ payments ⟕ documents
        ↓  PostgreSQL

Doctor consultation form
        ↓  POST /api/consultations
        ↓  consultations + medical_records
        ↓  prescriptions + prescription_items   (same transaction)
        ↓  appointments  (status → COMPLETED)
        ↓  appointments  (follow-up row created)
        ↓  audit_logs (CONSULTATION_CREATED, PRESCRIPTION_CREATED)
        ↓  PostgreSQL

Therapist session entry form
        ↓  PUT /api/therapy/sessions/{id}
        ↓  therapy_sessions  (scores, exercises, notes, status → COMPLETED)
        ↓  rehab_plans       (completed_sessions += 1, trend recomputed)
        ↓  rehab_progress_points (weekly rollup upsert)
        ↓  therapy_sessions  (next session row created)
        ↓  audit_logs (THERAPY_SESSION_CREATED)
        ↓  PostgreSQL          — single transaction

Nurse vitals form
        ↓  POST /api/vitals
        ↓  vitals
        ↓  nursing_tasks  (matching Vitals task → done)
        ↓  PostgreSQL

Reception check-in  /  queue actions
        ↓  PATCH /api/appointments/{id}/status
        ↓  appointments  (status + checked_in_at)
        ↓  PostgreSQL

Pharmacy dispense
        ↓  POST /api/prescriptions/{id}/dispense
        ↓  medicine_batches  (FEFO deduction, CHECK quantity >= 0)
        ↓  dispense_records
        ↓  prescriptions  (status → DISPENSED | PARTIALLY_DISPENSED)
        ↓  audit_logs (MEDICINE_DISPENSED)
        ↓  PostgreSQL          — single transaction, rollback on insufficient stock

Pharmacy POS checkout
        ↓  POST /api/pharmacy/sales
        ↓  medicine_batches (deduct) + invoices + invoice_items + payments
        ↓  PostgreSQL          — single transaction

Accountant records a payment
        ↓  POST /api/payments
        ↓  payments
        ↓  invoices  (paid recomputed from SUM(payments), status recomputed)
        ↓  audit_logs (PAYMENT_RECORDED)
        ↓  PostgreSQL          — single transaction

Expense categorisation
        ↓  PATCH /api/expenses/{id}/categorise
        ↓  expenses (category + status → APPROVED)
        ↓  PostgreSQL

Nurse discharge completion
        ↓  POST /api/nursing/discharges/{patientId}
        ↓  admissions (discharge_date, status → DISCHARGED)
        ↓  beds       (status → CLEANING)
        ↓  patients   (status → DISCHARGED)
        ↓  PostgreSQL          — single transaction

Owner dashboard (6 KPIs + 4 charts + alerts)
        ↓  GET /api/dashboard/owner
        ↓  aggregate over invoices, payments, expenses, patients,
           beds, admissions, therapy_sessions, medicine_batches
        ↓  PostgreSQL          — no stored KPI values

Admin staff table / approve / suspend
        ↓  GET /api/users  ·  PATCH /api/users/{id}/status
        ↓  users (+ audit_logs USER_UPDATED)
        ↓  PostgreSQL

Admin role permission matrix save
        ↓  PUT /api/roles/{role}/permissions
        ↓  role_permissions
        ↓  PostgreSQL

Notification bell
        ↓  GET /api/notifications  ·  PUT /api/notifications/{id}/read
        ↓  notifications (user_id scoped)
        ↓  PostgreSQL

Audit log screen
        ↓  GET /api/audit/logs?category=&q=
        ↓  audit_logs ⟕ users
        ↓  PostgreSQL
```

---

## 9. Authentication requirements

### What exists today (`src/context/AuthContext.tsx`, `src/pages/Login.tsx`)

| Aspect | Current implementation |
| --- | --- |
| Form fields | `email` (type=email, required), `password` (required), `remember` (checkbox, default **true**) |
| Submit | `signIn(email, password, remember)` |
| Verification | `await sleep(650)` → `findUserByEmail()` over `STAFF_DIRECTORY` → **plaintext compare** `password !== DEMO_PASSWORD` |
| Failure modes already handled by the UI | *"No account found for that email address."* · *"Incorrect password. Demo password is …"* · *"This account is suspended. Contact your administrator."* |
| Token | **None issued.** |
| State stored | The whole `User` object, JSON, under key `arogya.session` |
| Storage choice | `remember === true` → `localStorage`, else `sessionStorage`; the other store is cleared on write |
| Rehydration | On mount, `sessionStorage` is read **first**, then `localStorage` |
| Sign out | Removes the key from both stores, clears context |
| Permissions | Computed **client-side**: `permissionsForRole(user.role)` |
| Route protection | `RequireAuth` — `!ready` → skeleton; `!user` → `<Navigate to="/login" state={{from}}>`; `permission && !has(permission)` → `<Forbidden />` |
| Post-login redirect | `navigate(redirectTo ?? ROLE_HOME[user.role], { replace: true })` — role-based routing **already exists** |
| Extra demo affordance | `switchRole(role)` in the avatar menu re-writes the session with a different demo user — **must be removed or gated once real auth lands** |

### What the dashboard reads off `user` after login

`id`, `name`, `email`, `role`, `designation`, `department`, `avatarColor`, `initials`, `branch`,
`phone`, `lastLogin`, `status` — consumed by `Topbar` (avatar, role badge, branch chip),
`Sidebar` (navigation set + "Signed in as"), `Settings` (profile form), and every
`user.name`-keyed data filter (`appointmentsForDoctor(user.name)`, `sessionsForTherapist(user.name)`).

> **Note:** filtering by display name is fragile and should become id-based during integration.

### Proposed login response (fits the existing frontend without UI changes)

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "USR-1004",
    "name": "Meera Iyer",
    "email": "therapist@rehab.com",
    "role": "therapist",
    "designation": "Senior Physiotherapist",
    "department": "Physiotherapy",
    "avatarColor": "bg-accent/15 text-accent",
    "initials": "MI",
    "branch": "Andheri West — Main Campus",
    "phone": "+91 98195 77341",
    "lastLogin": "Today, 08:12 AM",
    "status": "active"
  },
  "permissions": ["patient.view", "therapy.session.manage", "..."]
}
```

Three deliberate decisions embedded above, each flagged in §11:

1. **`role` is lowercase**, not `THERAPIST`. The frontend keys `ROLE_HOME`, `ROLE_LABEL`,
   `ROLE_ACCENT` and `NAVIGATION` off lowercase literals. Serialising uppercase would break
   navigation for all 8 roles.
2. **`permissions` is returned by the server.** Today the client derives them. Returning them
   lets `AuthContext` stop owning the matrix while `can()` / `<RequireAuth>` keep working unchanged.
3. **`avatarColor` and `initials` are returned**, because the UI renders them directly. They can be
   stored or computed server-side, but they must be present in the payload.

Token storage should reuse the existing `remember` semantics: `localStorage` when checked,
`sessionStorage` otherwise, under a new `arogya.token` key alongside the cached user.

---

## 10. Proposed PostgreSQL schema

Conventions: `uuid` primary keys (`gen_random_uuid()`), `timestamptz` timestamps,
`numeric(12,2)` money, native `enum` types, `ON DELETE RESTRICT` by default and `CASCADE` only
for owned children.

| Table | Columns | Keys / Indexes |
| --- | --- | --- |
| `branches` | id, name, city, address, phone, email, opens_at, closes_at, licensed_beds, is_configured, services `text[]`, created_at, updated_at | PK id · UNIQUE(name) |
| `departments` | id, branch_id, name, type, head_user_id, rooms, created_at | PK id · FK branch_id → branches · FK head_user_id → users · UNIQUE(branch_id, name) |
| `users` | id, first_name, last_name, email, phone, password_hash, role `user_role`, designation, department_id, branch_id, avatar_color, status `user_status`, is_active, last_login, created_at, updated_at | PK id · UNIQUE(email) · FK branch_id, department_id · INDEX(role), INDEX(status) |
| `permissions` | id, code, group_name, label | PK id · UNIQUE(code) — seeds the 33 codes |
| `role_permissions` | role `user_role`, permission_id | PK(role, permission_id) · FK permission_id CASCADE |
| `patients` | id, patient_number, first_name, last_name, date_of_birth, gender, phone, email, address, blood_group, status `patient_status`, primary_condition, department_id, assigned_doctor_id, assigned_therapist_id, branch_id, registration_date, last_visit_at, created_at, updated_at | PK id · UNIQUE(patient_number) · FK assigned_doctor_id, assigned_therapist_id → users · INDEX(status) · **INDEX gin_trgm on (first_name‖last_name)** · INDEX(phone) |
| `patient_emergency_contacts` | id, patient_id, name, relation, phone | PK id · FK patient_id CASCADE · UNIQUE(patient_id) |
| `patient_insurance` | id, patient_id, provider, policy_no, valid_till | PK id · FK patient_id CASCADE |
| `patient_allergies` | id, patient_id, label | PK id · FK patient_id CASCADE |
| `patient_documents` | id, patient_id, name, doc_type, size_bytes, storage_key, uploaded_by, uploaded_at | PK id · FK patient_id CASCADE |
| `wards` | id, branch_id, name | PK id · FK branch_id · UNIQUE(branch_id, name) |
| `beds` | id, ward_id, room, bed_number, bed_type, status `bed_status`, daily_rate, created_at | PK id · FK ward_id · UNIQUE(ward_id, bed_number) · INDEX(status) |
| `admissions` | id, patient_id, bed_id, admitted_by, admission_date, expected_discharge, discharge_date, status | PK id · FK patient_id, bed_id · INDEX(status) · **partial UNIQUE(bed_id) WHERE status='ADMITTED'** |
| `appointments` | id, appointment_number, patient_id, doctor_id, therapist_id, department_id, appointment_date, start_time, end_time, appointment_type, status `appointment_status`, token_number, checked_in_at, notes, created_by, created_at, updated_at | PK id · UNIQUE(appointment_number) · FK patient_id, doctor_id, therapist_id · INDEX(appointment_date, doctor_id) · **EXCLUDE constraint on (doctor_id, tstzrange) for conflict detection** |
| `consultations` | id, patient_id, doctor_id, appointment_id, chief_complaint, examination_notes, diagnosis, care_plan, notes, follow_up_date, created_at, updated_at | PK id · FK patient_id, doctor_id, appointment_id · INDEX(patient_id, created_at DESC) |
| `medical_records` | id, patient_id, doctor_id, consultation_id, entry_type, title, detail, recorded_on, created_at | PK id · FK patient_id CASCADE · INDEX(patient_id, recorded_on DESC) |
| `lab_results` | id, patient_id, ordered_by, test_name, reported_on, flag, summary, reviewed, reviewed_by, reviewed_at | PK id · FK patient_id · INDEX(reviewed) |
| `lab_result_values` | id, lab_result_id, analyte, value, reference_range, is_abnormal | PK id · FK lab_result_id CASCADE |
| `rehab_plans` | id, patient_id, therapist_id, plan_name, goal, start_date, target_end_date, total_sessions, completed_sessions, frequency_per_week, modalities `text[]`, trend `rehab_trend`, status, created_at, updated_at | PK id · FK patient_id, therapist_id · INDEX(trend) · CHECK(completed_sessions ≤ total_sessions) |
| `rehab_milestones` | id, rehab_plan_id, label, target_date, achieved_on, is_done, sort_order | PK id · FK rehab_plan_id CASCADE |
| `rehab_progress_points` | id, rehab_plan_id, week_start, week_label, pain, mobility, strength, adherence | PK id · FK rehab_plan_id CASCADE · UNIQUE(rehab_plan_id, week_start) |
| `therapy_sessions` | id, session_number, rehab_plan_id, patient_id, therapist_id, session_date, start_time, duration_minutes, session_type `therapy_type`, room, status `session_status`, pain_before, pain_after, mobility_score, strength_score, tolerance, therapist_notes, created_at, updated_at | PK id · UNIQUE(session_number) · FK rehab_plan_id, patient_id, therapist_id · INDEX(session_date, therapist_id) |
| `therapy_session_exercises` | id, therapy_session_id, exercise_name | PK id · FK therapy_session_id CASCADE |
| `exercise_library` | id, session_type, exercise_name | PK id · UNIQUE(session_type, exercise_name) |
| `vitals` | id, patient_id, nurse_id, admission_id, systolic, diastolic, heart_rate, temperature, spo2, respiratory_rate, recorded_at | PK id · FK patient_id CASCADE, nurse_id · INDEX(patient_id, recorded_at DESC) |
| `nursing_tasks` | id, patient_id, admission_id, assigned_to, task_type, label, due_label, priority, is_done, completed_by, completed_at, created_at | PK id · FK patient_id · INDEX(is_done, priority) |
| `discharge_checklist_items` | id, admission_id, label, is_done, sort_order | PK id · FK admission_id CASCADE |
| `medicines` | id, name, generic_name, category, manufacturer, rack_location, reorder_level, is_active, created_at, updated_at | PK id · UNIQUE(name) · INDEX gin_trgm(name, generic_name) |
| `medicine_batches` | id, medicine_id, batch_number, quantity, purchase_price, selling_price, mrp, expiry_date, received_on | PK id · FK medicine_id CASCADE · UNIQUE(medicine_id, batch_number) · **CHECK(quantity >= 0)** · INDEX(expiry_date) |
| `prescriptions` | id, prescription_number, patient_id, doctor_id, consultation_id, priority, status `prescription_status`, created_at, updated_at | PK id · UNIQUE(prescription_number) · FK patient_id, doctor_id, consultation_id · INDEX(status) |
| `prescription_items` | id, prescription_id, medicine_id, strength, dosage, frequency, duration, quantity, quantity_dispensed, instructions | PK id · FK prescription_id CASCADE, medicine_id · CHECK(quantity_dispensed ≤ quantity) |
| `dispense_records` | id, prescription_item_id, medicine_batch_id, quantity, dispensed_by, dispensed_at | PK id · FK all three · INDEX(dispensed_at) |
| `invoices` | id, invoice_number, patient_id, branch_id, department, subtotal, discount, tax, total, status `invoice_status`, due_date, issued_at, created_by, created_at, updated_at | PK id · UNIQUE(invoice_number) · FK patient_id · INDEX(status), INDEX(due_date) |
| `invoice_items` | id, invoice_id, label, quantity, rate, amount | PK id · FK invoice_id CASCADE |
| `payments` | id, payment_number, invoice_id, amount, payment_method `payment_method`, transaction_reference, status `payment_status`, collected_by, paid_at | PK id · UNIQUE(payment_number) · FK invoice_id · INDEX(paid_at), INDEX(status) |
| `expenses` | id, branch_id, category `expense_category`, vendor, amount, description, reference, payment_method, expense_date, status `expense_status`, recorded_by, approved_by, created_at | PK id · FK branch_id · INDEX(status), INDEX(expense_date) |
| `notifications` | id, user_id, title, message, notif_type, severity, href, is_read, created_at | PK id · FK user_id CASCADE · INDEX(user_id, is_read, created_at DESC) |
| `audit_logs` | id, user_id, action, entity_type, entity_id, summary, ip_address `inet`, user_agent, created_at | PK id · FK user_id SET NULL · INDEX(created_at DESC), INDEX(entity_type, entity_id), INDEX(action) |
| `settings` | id, branch_id, key, value `jsonb`, updated_by, updated_at | PK id · UNIQUE(branch_id, key) |
| `consultation_fees` | id, appointment_type, amount, branch_id | PK id · UNIQUE(branch_id, appointment_type) |

### Values computed, never stored

`Patient.outstandingAmount`, `Medicine.status` + `quantity` (sum over batches),
`Invoice.paid` + `status`, rehab plan completion %, all dashboard KPIs, all report series,
`Bed`/occupancy summaries, ageing buckets, `daysOverdue`, `daysToExpiry`.

### Enum mapping — DB canonical ⇄ frontend display

The DB should use conventional SCREAMING_SNAKE enums; the Pydantic **response** schema maps them
to the display literals the UI already switches on (§5). Example for appointments:

| DB `appointment_status` | API / frontend |
| --- | --- |
| `SCHEDULED` | `Scheduled` |
| `CHECKED_IN` | `Waiting` |
| `IN_PROGRESS` | `In Consultation` |
| `COMPLETED` | `Completed` |
| `FOLLOW_UP` | `Follow-up` |
| `CANCELLED` | `Cancelled` |
| `NO_SHOW` | `No Show` |

Equivalent tables are needed for patient status, session status, stock status, invoice status,
payment status, bed status, expense status and rehab trend.

---

## 11. Questions / ambiguities

### A. Contract decisions the frontend forces (need a ruling before Step 2)

1. **Identifier exposure.** The UI routes on `/patients/PT-10248` and renders `PT-10248`,
   `INV-2026-4412`, `RX-7712`, `TS-5501`, `APT-8801` as visible text. Recommendation: UUID PK
   internally, human code in a unique column, API serialises the code as `id`, and detail routes
   resolve either. Confirm.
2. **Role casing.** Frontend needs lowercase; your earlier example showed `"THERAPIST"`. Confirm
   lowercase-in-API.
3. **Enum casing.** Confirm DB-canonical + display mapping in the response schema, rather than
   changing the 16 union types in `src/types/index.ts`.
4. **Relative timestamps.** `Notification.time` and `ActivityEvent.time` are pre-formatted strings
   (`"2 minutes ago"`, `"Yesterday, 18:40"`). Return ISO timestamps and format client-side, or
   keep the server formatting them?
5. **Name-based joins.** Appointments/sessions/plans currently reference staff by display name
   (`appointmentsForDoctor(user.name)`). Confirm these become id-based during integration.

### B. Business rules the frontend does not answer

6. **Therapist patient scope.** `/patients` has a "My caseload / All patients" toggle and the
   therapist holds a global `patient.view`. Should the API hard-scope therapists to assigned
   patients, or is the toggle genuine?
7. **Nurse ward scope.** The nurse demo user is "Ward In-charge — Ward A" but the dashboard lists
   Ward A *and* Ward B. Are nurses ward-scoped or centre-wide?
8. **Consultation ownership.** Nothing stops a doctor opening another doctor's patient. May a
   doctor edit a consultation authored by someone else?
9. **Admin vs clinical data.** Admin has `patient.view` but **not** `patient.clinical.view`, yet
   `Patient360` renders the History / Vitals / Prescriptions tabs with no inner permission check.
   Should the backend redact clinical tabs from the `/360` payload for admin and owner?
10. **Receptionist financial reach.** Receptionist currently holds `billing.manage` and can create
    invoices and mark them fully paid. Intended, or should that narrow to invoice creation only?
11. **"Completed" therapy session.** Does saving the session form imply completion (and therefore
    `completed_sessions += 1`), or is there a separate confirmation step?
12. **`RehabTrend` derivation.** Is `On Track / Plateaued / At Risk` computed by the server from
    progress deltas and attendance (if so, what thresholds?), or set manually by the therapist?
13. **Session → weekly rollup.** Sessions carry point-in-time scores; `ProgressPoint` is weekly.
    What is the rollup rule — last session in the week, or an average?
14. **`attendanceRate` / `adherenceRate`.** Attendance is derivable (attended ÷ scheduled).
    Adherence is not — where does it come from?
15. **POS sale without a patient.** POS allows a "Walk-in customer". Should that create an invoice
    with a null patient, or a separate counter-sale record?
16. **Dispensing and billing.** Dispensing a prescription currently creates no invoice. Should it?
17. **Reserved beds.** `Bed.patientName` holds strings like `"Nikhil Bharadwaj (admission 25 Aug)"`
    for people who are not in the patient list. Do reservations reference a real patient row?
18. **Nursing task origin.** There is no create-task UI. Are tasks generated by the system (from
    medication schedules and doctor instructions), or seeded by another role?
19. **Discharge checklist.** The 6 items are hardcoded. Fixed for all discharges, or configurable
    per branch?
20. **Branch scoping.** Users have a branch; patients, invoices and appointments do not. Are
    patients branch-scoped, and should non-owner roles see only their own branch?
21. **Notification origin.** Which of the 24 notification examples are system-generated by rules
    (stock threshold, overdue invoice, session reminder) versus stored rows?
22. **`Medicine.batch` is singular.** The frontend models one batch per medicine; the target schema
    has many. Confirm the API returns an aggregated view (total quantity, earliest expiry) so
    `Inventory.tsx` and `POS.tsx` keep working unchanged.
23. **Department revenue / utilisation.** `admin/Departments.tsx` shows `monthlyRevenue` and
    `utilisation` per department. Computed from invoices and appointments, or manually maintained?
24. **Demo role switcher.** `switchRole()` in the avatar menu bypasses authentication entirely.
    Remove it, or keep it behind a `DEMO_MODE` flag?

---

## 12. Recommended backend folder structure

```
backend/
├── app/
│   ├── main.py                    FastAPI app, CORS, routers, exception handlers, /docs tags
│   │
│   ├── core/
│   │   ├── config.py              pydantic-settings; DATABASE_URL, JWT_*, FRONTEND_URL
│   │   ├── database.py            engine, SessionLocal, Base, get_db
│   │   ├── security.py            bcrypt hash/verify, JWT encode/decode
│   │   ├── dependencies.py        get_current_user, require_permission(...), require_role(...)
│   │   ├── enums.py               DB enums + display-literal mapping (§10)
│   │   ├── ids.py                 PT-/APT-/RX-/INV-/TS- code generators
│   │   └── errors.py              AppError hierarchy → RFC-style {"detail": ...}
│   │
│   ├── models/                    SQLAlchemy 2.0 declarative
│   │   ├── base.py                UUIDMixin, TimestampMixin
│   │   ├── organisation.py        Branch, Department, Setting, ConsultationFee
│   │   ├── user.py                User, Permission, RolePermission
│   │   ├── patient.py             Patient, EmergencyContact, Insurance, Allergy, Document
│   │   ├── appointment.py
│   │   ├── consultation.py        Consultation, MedicalRecord, LabResult, LabResultValue
│   │   ├── rehab.py               RehabPlan, RehabMilestone, RehabProgressPoint
│   │   ├── therapy.py             TherapySession, SessionExercise, ExerciseLibrary
│   │   ├── vitals.py
│   │   ├── ward.py                Ward, Bed, Admission, NursingTask, DischargeChecklistItem
│   │   ├── pharmacy.py            Medicine, MedicineBatch, Prescription, PrescriptionItem, DispenseRecord
│   │   ├── billing.py             Invoice, InvoiceItem, Payment, Expense
│   │   ├── notification.py
│   │   └── audit.py
│   │
│   ├── schemas/                   Pydantic v2 — request + camelCase response models
│   │   └── (one module per model group, plus dashboard.py, report.py, common.py)
│   │
│   ├── repositories/              pure data access, no business rules
│   ├── services/                  business rules, transactions, cross-entity writes
│   │   ├── auth_service.py        login, token issue, last_login, LOGIN audit
│   │   ├── patient_service.py     registration transaction, 360 aggregate
│   │   ├── appointment_service.py conflict detection, status transitions
│   │   ├── consultation_service.py
│   │   ├── rehab_service.py       completion %, trend derivation, weekly rollup
│   │   ├── therapy_service.py     session completion transaction
│   │   ├── nursing_service.py     vitals, tasks, discharge transaction
│   │   ├── pharmacy_service.py    FEFO dispense transaction, stock status, alerts
│   │   ├── billing_service.py     invoice recalculation, payment transaction, ageing
│   │   ├── dashboard_service.py   eight role aggregates
│   │   ├── report_service.py      date-filtered chart series
│   │   ├── notification_service.py
│   │   └── audit_service.py
│   │
│   ├── api/                       thin routers, one per Swagger tag
│   │   └── auth · users · patients · appointments · consultations · rehab · therapy
│   │       · nursing · pharmacy · billing · dashboard · reports · notifications · audit · labs
│   │
│   ├── ai/                        isolated, optional, not a dependency of anything above
│   └── utils/                     pagination, date ranges, code formatting
│
├── alembic/  ├── env.py  └── versions/
├── tests/                         conftest + auth · rbac · patients · appointments
│                                  · rehab · pharmacy · billing
├── seed.py
├── requirements.txt
├── .env.example
├── Dockerfile
├── docker-compose.yml             postgres + backend
└── README.md
```

Plus, on the frontend side during Step 3 (integration only, no UI changes):

```
src/services/api.ts         base URL, auth header, 401 handling, typed error envelope
src/services/<domain>.ts    one module per API tag
src/hooks/useApi.ts         request state (data / loading / error) + cache
.env.example                VITE_API_URL=http://localhost:8000
```

---

## Environment note

The workstation currently has **Python 3.14.3 and pip**, but **no PostgreSQL server and no Docker**.
Step 2 will need one of: a local PostgreSQL install, Docker Desktop, or portable PostgreSQL
binaries run as a project-local cluster. Worth deciding before setup begins.
