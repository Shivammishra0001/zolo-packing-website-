# Rehabilitation Centre HMS — Backend

FastAPI + PostgreSQL backend for the Arogya Rehabilitation Centre HMS.

**Status: Step 10 — nursing, IPD and admissions complete.** Foundation, 39-table
schema, migrations, JWT authentication with database-backed RBAC, Patients,
Appointments, the clinical record (consultations, medical history, vitals, labs,
prescription writing), Rehabilitation (plans, milestones, therapy sessions,
exercises, progress), the Pharmacy (batch inventory, FEFO dispensing and the
point of sale), and Nursing — wards, beds, admissions, the task list and the
discharge workflow. Billing and dashboards arrive in later steps.

---

## Requirements

| Component | Version | Notes |
| --- | --- | --- |
| Python | 3.12+ | Verified on 3.14.3 — see the psycopg note below |
| PostgreSQL | 14+ | Verified on 16.4; database name `rehab_hms` |
| Node.js | 18+ | Only for the existing frontend, in the repository root |
| Docker | optional | `docker compose up` replaces the manual setup entirely |

### A note on `psycopg`

`requirements.txt` pins the **pure-Python** `psycopg`, which needs `libpq`
available at runtime. That is because `psycopg-binary` has no wheel for Python
3.14 yet.

- **Python ≤ 3.13** — install the self-contained driver instead and skip the
  `PGBIN` setting entirely:
  ```bash
  pip install "psycopg[binary]==3.3.4"
  ```
- **Python 3.14 on Windows** — point `PGBIN` at any PostgreSQL `bin` directory
  (see `.env.example`). The app adds it to `PATH` at import time so `uvicorn`,
  `pytest` and `alembic` all work without per-shell setup.
- **Docker** — not applicable; the image runs Python 3.12 with `psycopg[binary]`.

---

## Local setup

### 1. Virtual environment

```bash
cd backend
python -m venv .venv
```

Activate it — **Windows (PowerShell)**:

```powershell
.\.venv\Scripts\Activate.ps1
```

**Windows (Git Bash)**:

```bash
source .venv/Scripts/activate
```

**macOS / Linux**:

```bash
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure

```bash
cp .env.example .env
```

Then edit `.env` — at minimum `DATABASE_URL`, and a real `JWT_SECRET`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`.env` is gitignored. Never commit it.

### 4. PostgreSQL

Any PostgreSQL 14+ works. Create the database once:

```bash
createdb -U postgres rehab_hms
```

<details>
<summary>No PostgreSQL and no Docker on this machine? Use the project-local cluster.</summary>

A self-contained PostgreSQL 16.4 lives in `%LOCALAPPDATA%\rehab-hms-pg` — no
system install, no administrator rights. Manage it with:

```powershell
.\scripts\pg.ps1 start
.\scripts\pg.ps1 status
.\scripts\pg.ps1 psql
.\scripts\pg.ps1 stop
```

To recreate it from scratch, download the PostgreSQL 16 **binaries zip**,
extract to `%LOCALAPPDATA%\rehab-hms-pg` (so `pgsql\bin` exists), then:

```powershell
$R="$env:LOCALAPPDATA\rehab-hms-pg"
Set-Content "$R\pw.txt" "postgres" -NoNewline -Encoding ascii
& "$R\pgsql\bin\initdb.exe" -D "$R\data" -U postgres --auth=scram-sha-256 --pwfile="$R\pw.txt" -E UTF8
Remove-Item "$R\pw.txt"
& "$R\pgsql\bin\pg_ctl.exe" -D "$R\data" -l "$R\postgres.log" -o "-p 5432" start
& "$R\pgsql\bin\createdb.exe" -U postgres -h localhost -p 5432 rehab_hms
```

Delete the folder to remove it completely.
</details>

### 5. Migrations

```bash
alembic upgrade head
```

### 6. Run

```bash
uvicorn app.main:app --reload
```

| URL | What |
| --- | --- |
| http://localhost:8000/ | Service banner |
| http://localhost:8000/api/health | Health + live database check |
| http://localhost:8000/docs | Swagger UI |
| http://localhost:8000/redoc | ReDoc |

---

## Docker

```bash
docker compose up --build
```

Brings up PostgreSQL (persistent named volume `rehab_hms_postgres_data`) and the
API, which waits for the database healthcheck, runs `alembic upgrade head`, then
serves on port 8000.

The compose credentials (`postgres` / `postgres` / `rehab_hms`) are
**development-only defaults**. Override them anywhere else.

---

## Authentication

```
POST /api/auth/login     email + password + remember  ->  JWT + user + permissions
GET  /api/auth/me        bearer token                 ->  user + live permissions
POST /api/auth/logout    bearer token                 ->  client discards the token
```

### Seed the demo accounts

```bash
python seed.py
```

Creates the 33 permissions, the role matrix, 3 branches, 14 departments and 10
staff accounts.

> **DEVELOPMENT ONLY.** Every seeded account shares the password **`Rehab@123`**.
> Never run `seed.py` against an environment holding real data.

| Email | Role | Permissions |
| --- | --- | --- |
| `owner@rehab.com` | owner | 10 |
| `admin@rehab.com` | admin | 20 |
| `doctor@rehab.com` | doctor | 13 |
| `therapist@rehab.com` | therapist | 8 |
| `nurse@rehab.com` | nurse | 8 |
| `pharmacy@rehab.com` | pharmacist | 5 |
| `reception@rehab.com` | receptionist | 9 |
| `accounts@rehab.com` | accountant | 7 |

Two extra accounts exercise the rejection paths: `imran.qureshi@rehab.com`
(pending) and `aakash.verma@rehab.com` (suspended). Both return **403**.

### Guarding a route

```python
from app.core.dependencies import CurrentUser, require_permission, require_role

@router.get("/patients/{patient_id}")
def read_patient(user=Depends(require_permission("patient.clinical.view"))):
    ...

@router.get("/reports/pnl")
def profit_and_loss(user=Depends(require_role("owner", "accountant"))):
    ...
```

### Design decisions

**Passwords use Argon2id.** `argon2-cffi` defaults, which follow RFC 9106.
Hashes are salted per password and transparently upgraded on sign-in when the
parameters change. A wrong password and an unknown email take the same time,
because the unknown-email path still performs a hash.

**The token proves identity, nothing more.** Its claims are `sub`, `role`,
`type`, `iat`, `nbf`, `exp`, `jti` — no patient data and **no permission list**.
Role, account status and permissions are re-read from PostgreSQL on every
request, so suspending a user or editing the role matrix takes effect on their
next call rather than when their token expires. A forged `role` claim changes
nothing: the database value wins.

**Account enumeration is not possible.** An unknown email and a wrong password
return byte-identical `401` responses. Only an account that exists *and*
authenticates *and* is not active gets a distinguishable `403`, which is what
lets the login screen keep its three error states.

**Logout is client-side.** Access tokens are stateless JWTs, so `POST
/api/auth/logout` records the event and tells the client to discard its token —
it does **not** revoke it. A captured copy stays valid until `exp`
(`ACCESS_TOKEN_EXPIRE_MINUTES`, default 60). Real revocation needs a denylist or
short-lived tokens plus refresh; neither is built. A test pins this behaviour so
it cannot change silently.

**Demo mode is opt-in and separate.** `DEMO_MODE` (backend) and
`VITE_DEMO_MODE` (frontend) default to **false**. When on, the avatar menu's
role switcher performs a *real* sign-in with seeded credentials. It never
fabricates a session, and the backend never accepts a role from the client.

---

## Patients

```
GET  /api/patients              paginated, filtered and sorted in PostgreSQL
GET  /api/patients/search?q=    ranked lookup for the command palette
GET  /api/patients/{id}         accepts a UUID or a PT-##### code
GET  /api/patients/{id}/360     one call for the whole Patient 360 screen
POST /api/patients              register — the backend allocates the number
PUT  /api/patients/{id}         edit
```

There is deliberately **no DELETE**: the frontend has no destructive patient
action, and clinical history should not be erasable through the API.

### Seed patient data

```bash
python seed_patients.py
```

14 patients with vitals, medical history and documents, taken from the
frontend's original sample data so the screens look unchanged once they read
from PostgreSQL. Run `seed.py` first.

### Design decisions

**Patient numbers come from a sequence.** `nextval('patient_number_seq')` is
atomic, so two simultaneous registrations cannot collide — which a
`MAX(number) + 1` read would allow under load. Sequences may leave gaps on
rollback; for a display identifier that is the right trade. A client-supplied
number is ignored, never honoured.

**Out-of-branch patients return 404, not 403.** A 403 would confirm the record
exists, letting someone enumerate other branches' patients by changing the URL.
Cross-branch access requires `branches.manage` or `analytics.business`, using
the existing permission vocabulary rather than a new one.

**Patient 360 is permission-aware.** `vitals` and `medicalHistory` need
`patient.clinical.view`. Without it they come back empty *and* are named in
`restrictedSections`, so the UI can say the record is restricted instead of
implying the patient has none. Demographics stay visible — admin can still
administrate without reading clinical notes.

**Unbuilt modules return empty, never fabricated.** Anything still listed in
`pendingModules` comes back empty until its own step lands. `appointments` left
that list in Step 6 and `admissions` in Step 10; both now carry real rows. Only
`invoices` is still pending.

**Filtering happens in SQL.** Search, status, scope, sort and paging are all
expressed as `WHERE`/`ORDER BY`/`LIMIT`; no endpoint loads the table into
Python to filter it there. Name search matches
`first_name || ' ' || last_name`, which is exactly the expression the trigram
index covers.

---

## Appointments

```
GET  /api/appointments                    the diary — filtered and paged in SQL
POST /api/appointments                    book; number + token generated here
GET  /api/appointments/{id}               accepts a UUID or an APT-YYYY-##### code
PUT  /api/appointments/{id}               reschedule or amend (never status)

POST /api/appointments/{id}/check-in      Scheduled      -> Waiting
POST /api/appointments/{id}/start         Waiting        -> In Consultation
POST /api/appointments/{id}/complete      In Consultation -> Completed
POST /api/appointments/{id}/cancel        -> Cancelled, slot released
POST /api/appointments/{id}/no-show       -> No Show, slot released
```

There is deliberately **no DELETE**. An appointment is clinical history: it is
cancelled or marked no-show, never erased.

### Seed the diary

```bash
python seed_appointments.py
```

12 appointments taken from the frontend's original sample data. Run `seed.py`
and `seed_patients.py` first.

### Design decisions

**Status moves only through the workflow endpoints.** `PUT` accepts a new time,
clinician, type, room or notes — never a status. Each workflow endpoint runs the
move through a state machine in `appointment_service.ALLOWED_TRANSITIONS`;
anything not listed there returns **409**, so no client can drive an appointment
into an impossible state.

```
SCHEDULED ──▶ CHECKED_IN ──▶ IN_PROGRESS ──▶ COMPLETED
     │             │
     ├──▶ CANCELLED ◀┤
     └──▶ NO_SHOW  ◀─┘
```

**Double-booking is refused by the database, not just the API.** Two
`EXCLUDE USING gist` constraints make an overlapping slot for the same doctor or
therapist physically impossible. The service also runs a friendly pre-check so
the usual case gets a readable message, but two concurrent bookings can both
pass that check and only one survives the `INSERT` — the `IntegrityError` is
translated to the same 409. Slots are half-open: 09:00–09:30 and 09:30–10:00 do
not clash.

**Tokens restart daily and are shared across clinicians**, which is what the
reception board displays. Allocation takes `pg_advisory_xact_lock` for the date,
so two receptionists booking at the same instant cannot be handed the same
token. The appointment number and the token are allocated in the same
transaction as the insert, so a rejected booking leaves neither behind.

**Waiting time is never stored.** The API returns `checkedInAt` as a clock time
and the queue board derives the elapsed wait from it, so a stale "12 minutes"
can never be persisted. `checked_in_at` itself is a UTC timestamp stamped
server-side; it is rendered in `CLINIC_TIMEZONE` on the way out.

**Nobody gets the whole diary by default.** Results are limited to branches the
caller can see (via the patient's branch), and `scope=auto` narrows doctors and
therapists to their own list. The clinician filter is resolved from the
authenticated user — a client cannot ask for somebody else's diary by passing an
id. `scope=branch` is the clinic-wide view reception works from.

**Starting and completing a visit is restricted.** The assigned clinician can
always do it; so can front-desk staff holding `appointment.checkin`, because the
check-in board is where the queue is driven. What is refused is one clinician
moving another's appointment.

---

## Clinical record

Consultations, medical history, vitals, labs and prescriptions. Everything here
is gated on `patient.clinical.view` at minimum — being able to see a patient's
name is never permission to read their medical record.

```
GET  /api/consultations                        the doctor's own encounters
GET  /api/consultations/follow-ups             follow-ups now due, one per patient
POST /api/consultations                        record an encounter
GET  /api/consultations/{id}
PUT  /api/consultations/{id}                   author only

GET  /api/patients/{id}/consultations          this patient's full encounter history
GET  /api/patients/{id}/medical-history
POST /api/patients/{id}/medical-history
GET  /api/patients/{id}/vitals                 newest first
GET  /api/patients/{id}/vitals/latest          one row, not a history to filter
POST /api/patients/{id}/vitals

GET  /api/labs                                 ?patient= ?reviewed= ?flag=
GET  /api/labs/{id}                            UUID or LAB-#### code
POST /api/labs/{id}/review                     sign-off

GET  /api/prescriptions                        ?patient= ?status= ?scope=
POST /api/prescriptions                        writing only — no dispensing
GET  /api/prescriptions/{id}                   UUID or RX-#### code
GET  /api/prescriptions/medicines              the prescribable catalogue
```

There is no lab-creation endpoint and no DELETE anywhere in this module. The
frontend has no lab-entry screen, so exposing a public creation workflow would
be inventing one; and a consultation, an observation or a history entry is part
of the medical record, not something to erase.

### Seed the clinical data

```bash
python seed_clinical.py
```

20 medicines with batches, 5 lab reports with their analytes, and 8
prescriptions — all from the frontend's original sample data. Run `seed.py` and
`seed_patients.py` first.

Consultations are deliberately **not** seeded. The frontend never had any mock
encounters, and inventing clinical notes would be fabricating a medical record.
They appear as doctors record them.

### Design decisions

**The author is always the authenticated user.** `ConsultationCreate` and
`PrescriptionCreate` have no `doctorId` field, and lab review does not accept
`reviewedBy` or `reviewedAt`. A clinical record has to be attributable to
whoever was actually signed in, so none of it is a value the browser can choose.

**A doctor edits their own encounters, and only their own.** There is
deliberately no override permission. `patient.clinical.edit` looks like one but
is not — the frontend grants it to *every* doctor, so treating it as oversight
would let any doctor rewrite any colleague's notes, which is exactly what
ownership is meant to prevent. If an administrator ever needs that power it gets
its own key, granted deliberately.

**The consultation list is a work queue, not the clinic's record.** A doctor
always sees their own encounters there; `scope=all` is refused rather than
silently narrowed, so the caller is never misled about what they received.
Reading a colleague's notes happens through `/patients/{id}/consultations` — a
deliberate, patient-scoped act rather than a bulk listing.

**An encounter can only be recorded against an appointment that is ready.** The
appointment must belong to the same patient, be booked with the caller, and be
checked in or further along — not a slot the patient never attended. One
consultation per appointment, enforced by a partial unique index.

**Prescriptions are atomic.** Every medicine is resolved against the catalogue
*before* anything is inserted, and the prescription, its items and the audit
entry share one transaction. An unknown medicine fails the whole request rather
than leaving a header with missing lines.

**Prescribing never touches stock.** An out-of-stock medicine is still a valid
prescription — substitution is the pharmacy's decision, in a later module. A
test asserts that writing a prescription leaves every batch quantity unchanged.

**Vitals ranges mirror the database CHECK constraints,** so an impossible
reading is a 422 from validation rather than a 503 from a constraint violation.
At least one reading is required: a row with nothing measured says nothing.

**The medicine catalogue is deliberately thin.** `/prescriptions/medicines`
returns a name, a strength and a stock signal — what the consultation form's
dropdown needs to prescribe and to show its existing out-of-stock note. Prices,
batches and quantities belong to the pharmacy module and are not exposed;
`status` is derived from batches per request and is never stored.

**Nothing logs clinical content.** Audit entries and log lines carry record
identifiers and counts — never a diagnosis, a set of readings, a prescribed
medicine or a lab value.

---

## Rehabilitation

Plans, milestones, therapy sessions, the exercise library and progress. The
module's central rule: **everything the UI shows as progress is derived from
therapy sessions** — completed count, attendance, adherence and trend are all
recomputed inside the transaction that changed a session, so a plan's figures
can never disagree with the sessions behind them.

```
GET  /api/rehab/caseload                       the therapist's own patients
GET  /api/rehab/plans                          ?patient= ?status= ?trend= ?scope=
POST /api/rehab/plans                          plan + milestones, one transaction
GET  /api/rehab/plans/{id}
PUT  /api/rehab/plans/{id}
POST /api/rehab/plans/{id}/complete|hold|resume|cancel

GET  /api/rehab/plans/{id}/milestones
POST /api/rehab/plans/{id}/milestones
PUT  /api/rehab/milestones/{id}
POST /api/rehab/milestones/{id}/complete       timestamp is server-set

GET  /api/rehab/plans/{id}/progress            chart-ready
POST /api/rehab/plans/{id}/progress            one weekly review
GET  /api/rehab/plans/{id}/sessions

GET  /api/therapy/sessions                     ?patient= ?plan= ?date= ?status=
POST /api/therapy/sessions                     session + exercises, one transaction
GET  /api/therapy/sessions/{id}                UUID or TS-#### code
PUT  /api/therapy/sessions/{id}
POST /api/therapy/sessions/{id}/start|complete|no-show

GET  /api/exercises                            ?search= ?category= ?active=
POST /api/exercises                            settings.manage only
PUT  /api/exercises/{id}                       including retiring one

GET  /api/patients/{id}/rehab-plans
GET  /api/patients/{id}/therapy-sessions
GET  /api/patients/{id}/progress
```

There is no DELETE anywhere in this module. A plan is cancelled, a session is
marked missed, an exercise is retired — none of it is erased.

### Seed the rehabilitation data

```bash
python seed_rehab.py
```

55 exercises, 14 plans with 50 milestones, 84 weekly progress points and 229
therapy sessions. Run `seed.py` and `seed_patients.py` first.

### Design decisions

**Progress is derived, never asserted.** `RehabPlanCreate` has no
`completedSessions`, `attendanceRate`, `adherenceRate` or `trend` field, so a
client cannot claim progress that did not happen. The plan's columns are a cache
of `recalculate()`, and nothing else writes them.

**The seeded history is real.** The frontend's mock data claimed "18 of 24
sessions completed" with no sessions behind it. Since the counters are derived,
that history has to exist — so the seed lays down the delivered sessions each
plan implies, including enough missed ones to reproduce the attendance rate the
mock displayed. Nine of the fourteen trends then come out matching the mock's
hand-picked label; the other five differ because they are now computed from the
data rather than asserted.

**Attendance and adherence measure different things.** Attendance is delivered
÷ expected sessions. Adherence is the home-programme compliance recorded at each
weekly review, averaged — which is what the frontend's `ProgressPoint.adherence`
has always meant. Conflating them would have made one of the two meaningless.

**A therapist works a caseload, and only that.** Plans, sessions and milestones
they are not assigned to return **404**, not 403 — a 403 would confirm the record
exists and let someone map a colleague's caseload by trying ids. `scope=all` is
refused outright rather than silently narrowed, so the caller is never misled
about what they received.

**The caseload is a query, not a filter.** `/rehab/caseload` derives the
therapist's patients from their active plans. Filtering a patient list in the
browser would have been both slower and wrong — a caseload *is* the set of
active assignments.

**Completion is an explicit clinical decision.** Reaching the session budget does
not finish a programme; a therapist calling `/complete` does. Sessions cannot be
recorded or completed against a plan that is on hold or cancelled.

**A started plan keeps its start date** once sessions have been recorded against
it — moving it would silently rewrite the baseline those sessions were measured
against. The session total cannot be cut below the number already delivered.

**Session numbering is server-side and twice-identified.** `TS-####` is the code
the UI shows; `sequence_in_plan` is the position in the programme, allocated
under an advisory lock and unique per plan (a partial unique index, since a
session with no plan has no position).

**Exercises are resolved before anything is written.** An unknown or retired
exercise fails the whole request rather than leaving a session with missing
lines. Retiring an exercise keeps it on the sessions that already used it but
removes it from the picker.

**The exercise library is shared configuration.** Every therapist reads it;
editing needs `settings.manage`, so protocol lists cannot drift per person.

**Nothing logs clinical content.** Audit entries and log lines carry record
identifiers and counts — never a therapist's notes, a patient's scores or a
plan's goals.

---

## Pharmacy

Batch-based inventory, prescription dispensing and the counter till.

```
GET  /api/pharmacy/dashboard                   every card, counted in SQL
GET  /api/pharmacy/inventory                   ?status=
GET  /api/pharmacy/inventory/low-stock         the reorder list
GET  /api/pharmacy/inventory/near-expiry       45-day window

GET  /api/medicines                            ?search= ?category= ?status=
POST /api/medicines                            catalogue entry + opening batch
GET  /api/medicines/{id}                       UUID or MED-#### code
PUT  /api/medicines/{id}
GET  /api/medicines/{id}/batches
POST /api/medicines/{id}/batches
PUT  /api/medicine-batches/{id}

POST /api/prescriptions/{id}/dispense          FEFO, one transaction

GET  /api/pharmacy/pos/products
POST /api/pharmacy/pos/sale
GET  /api/pharmacy/pos/sales
GET  /api/pharmacy/pos/sales/{id}              UUID or POS-#### code
```

There is no DELETE. A medicine is retired, a batch corrected — both sit behind
dispense records and sale lines that have to stay auditable.

### Design decisions

**Stock lives on batches; the medicine holds none.** A medicine's quantity is
`SUM(batch.quantity)` over unexpired batches, computed per request. The
frontend's flat `Medicine` shape — one quantity, one batch, one expiry — is
produced by aggregating in the API, so no screen has to understand the
normalised structure.

**Stock can never go negative.** Every deduction reads its batches with
`SELECT … FOR UPDATE` and checks the total before writing anything. Two
pharmacists dispensing the same stock therefore serialise: the first succeeds,
the second sees the reduced figure and gets a **409**. A test proves it with two
real threads on one batch of 10 — one takes 8, the other is refused, and 2
remain.

**Expired stock is never issued.** Expired batches are excluded by the query
that selects them, not filtered afterwards, so no code path can reach one. A
medicine whose only stock has expired reports `expired_stock` rather than a
misleading "insufficient".

**FEFO, always.** `lock_dispensable_batches` orders by expiry, so 15 units drawn
against a 10-unit batch expiring in September and a 50-unit batch expiring in
December become 10 + 5. Each draw becomes its own dispense record, so the audit
trail says exactly where the stock went.

**Dispensing is one transaction.** Prescription locked → lines validated against
remaining quantity → stock checked → batches drawn → dispense records written →
`quantity_dispensed` updated → status recomputed. Any failure rolls all of it
back; a bad third line leaves the first two unissued.

**Status is recomputed, never set.** `Pending → Partially Dispensed → Dispensed`
falls out of the lines' issued totals. There is no path back to Pending —
dispensing is one-way until a reversal workflow exists.

**No money comes from the request.** The POS request carries medicines,
quantities, a discount percentage and a payment method. Prices are read from the
batch being drawn, and the subtotal, discount, 12% GST and total are computed in
`NUMERIC` — never floating point. A test sends `unitPrice: 0.01` and gets charged
the real MRP.

**MRP is what the till charges,** because that is what the POS cart has always
totalled; `selling_price` is the wholesale figure behind it.

**A walk-in needs no patient record.** `patient_id` is nullable on a sale — the
pharmacy does not require a hospital registration to sell over the counter.

**POS sales are their own table, not invoices.** A counter sale is a completed
transaction, not an account receivable. `pharmacy_sales` stores its money in
full so the billing module can later reference these rows rather than replace
them.

**The near-expiry window is 45 days,** taken from the frontend's original
`NEAR_EXPIRY_DAYS` — not the 30 a fresh implementation would pick, which would
silently reclassify stock the pharmacist already knows about. The inventory
screen's own label says "Within 45 days".

**Inventory value is returned twice,** at cost and at retail, rather than the API
guessing which the card means. The inventory screen labels its tile "At cost
price", so that is what it reads.

**Low stock and the Low Stock badge answer different questions.** The badge is
exclusive — near-expiry outranks low-stock — while `/inventory/low-stock` is the
reorder list: everything at or below its threshold, including stock that is also
near expiry, and including out-of-stock.

---

## Nursing, beds and admissions

Wards, the bed board, inpatient admissions, the nurse's task list and the
discharge workflow. The module's central rule: **a bed's occupancy is a
consequence of an admission, never something a client sets** — the board reads
its occupant from the admissions table, so the two cannot disagree.

| Method | Path | Permission | What |
| --- | --- | --- | --- |
| `GET` | `/api/wards` | `beds.view` | Wards with bed counts derived from the beds themselves |
| `POST` | `/api/wards` | `beds.manage` | Create a ward; defaults to the caller's own branch |
| `PATCH` | `/api/wards/{id}` | `beds.manage` | Rename a ward |
| `GET` | `/api/beds` | `beds.view` | The bed board — `?ward=` `?status=` `?type=` |
| `GET` | `/api/beds/summary` | `beds.view` | Total, occupied, available, reserved, cleaning and the occupancy rate |
| `PATCH` | `/api/beds/{id}/status` | `beds.manage` | Housekeeping only — Available, Reserved or Cleaning |
| `GET` | `/api/admissions` | `beds.view` | Admissions, newest first — `?patient=` `?ward=` `?status=` `?active=` |
| `POST` | `/api/admissions` | `beds.manage` | Admit a patient to a bed, in one transaction |
| `GET` | `/api/admissions/{id}` | `beds.view` | One stay, with its discharge checklist |
| `PATCH` | `/api/admissions/{id}` | `beds.manage` | Amend the expected discharge date or the attending doctor |
| `POST` | `/api/admissions/{id}/discharge-pending` | `beds.manage` | Begin a discharge; the bed stays occupied |
| `PATCH` | `/api/admissions/checklist/{itemId}` | `beds.manage` | Tick or untick one item; returns the whole admission |
| `POST` | `/api/admissions/{id}/discharge` | `beds.manage` | Close the stay and release the bed, in one transaction |
| `GET` | `/api/nursing/dashboard` | `nursing.tasks` | Every figure the nurse dashboard shows, counted in SQL |
| `GET` | `/api/nursing/ipd-patients` | `beds.view` | Open stays ordered by ward and bed — the ward round's list |
| `GET` | `/api/nursing/tasks` | `nursing.tasks` | The task list — `?patient=` `?ward=` `?bed=` `?done=` `?priority=` `?type=` `?mine=` |
| `POST` | `/api/nursing/tasks/{id}/complete` | `nursing.tasks` | Tick a task; the completer is the authenticated user |
| `POST` | `/api/nursing/tasks/{id}/reopen` | `nursing.tasks` | Undo a tick made by mistake and clear who completed it |
| `PATCH` | `/api/nursing/tasks/{id}` | `nursing.tasks` | Amend a task's label, priority, due time or assignment |
| `POST` | `/api/nursing/admissions/{id}/vitals` | `vitals.record` | Record observations against an open stay |

The vitals route also accepts `patient.clinical.edit`, so a doctor writing on
the ward round is not refused. No other key is introduced: `beds.view`,
`beds.manage`, `nursing.tasks` and `vitals.record` are the four the frontend
already defines.

There is no DELETE. A stay is discharged, a bed is released, a task is reopened
— an admission is the record that a patient occupied a bed on a given date, and
that is not something to erase.

### Seed the wards and beds

```bash
./.venv/Scripts/python.exe seed_nursing.py
```

Wards, beds, current admissions and the nursing task list, taken from the
frontend's original sample data. Run `seed.py` and `seed_patients.py` first.

> **DEVELOPMENT / DEMO ONLY.** Never run it against an environment holding real
> data.

### Design decisions

**Step 10 needed no migration.** `wards`, `beds`, `admissions`,
`discharge_checklist_items` and `nursing_tasks` were all created by the Step 4
schema migration, and so were both partial unique indexes. This step adds routes,
services and repositories over a schema that already existed, so `alembic heads`
is unchanged.

**Admitting is atomic.** The bed row is read with `SELECT … FOR UPDATE` and held
for the rest of the transaction, so two staff admitting to the same bed
serialise rather than race: the bed's state is checked, the admission and its
six checklist items are written, the bed is marked Occupied and the patient
becomes an inpatient — or none of it happens.

The database is the backstop, not the check. `uq_admissions_active_bed` and
`uq_admissions_active_patient` are partial unique indexes over `bed_id` and
`patient_id` where `status = 'ADMITTED'`, so a second active stay for the same
bed or the same patient is refused by PostgreSQL even if it slips past the
service. That `IntegrityError` is translated into the same **409** the friendly
pre-check returns, so the caller sees one behaviour rather than two.

**Discharging is atomic too.** The admission is locked, then the bed — always in
that order, so two concurrent discharges cannot deadlock. The checklist is
re-read *after* the lock rather than trusted from the copy loaded before it;
every item must be ticked, which is the frontend's own rule, since its discharge
button stays disabled until the checklist reaches 100%. The stay is closed, the
discharge date stamped and the bed released in the same transaction. A failure
anywhere rolls all of it back, so a discharged patient never keeps occupying a
bed and a released bed never belongs to a stay that is still open.

**Occupied is not a settable state.** `PATCH /beds/{id}/status` accepts
Available, Reserved and Cleaning only, and refuses to move an occupied bed at
all until the patient leaves. A bed becomes Occupied by admitting someone to it
and is freed by discharging them; a direct write would let the board drift away
from the admissions it reports. After a discharge the bed goes to Cleaning by
default — the board has a cleaning column, and a bed a patient has just left is
not immediately re-lettable.

**Discharge Pending still holds the bed.** It is the state the ward's checklist
works in, not a release: the patient is still in the bed, so the bed stays
occupied until `/discharge` completes.

**Vitals are not duplicated.** The ward round posts to
`/nursing/admissions/{id}/vitals`, and the reading lands in the single vitals
table Step 7 created — nursing keeps no second copy, and the observation appears
on the patient's record and on the ward round alike. Posting through the
admission is also what narrows the permission: the stay has to exist, sit inside
the caller's branch scope and still be open, so holding `vitals.record` is not
on its own a licence to write vitals for an arbitrary patient id.

**Occupancy is counted, never stored.** A ward's bed counts and the summary's
occupancy rate are computed from the beds themselves on each request, so no
figure can go stale against the board beside it.

**The bed board is flat because the frontend's `Bed` is flat.** The API
aggregates the real `Branch → Ward → Bed` relationship into the one-row shape
the board renders, and reads the occupant from the active admission. No screen
has to understand the normalised structure.

**A task carries `done`, not a status enum,** because that is what the frontend's
`NursingTask` has always carried. Completing one goes through its own endpoint,
which stamps who did it and when; `PATCH` accepts `done` only to reopen a task
ticked by mistake. A `completedBy` in the request body is never read — nobody
signs work off in someone else's name.

**Unassigned tasks stay in `mine=true`.** They are everybody's work, and hiding
them behind a personal filter is how ward work goes undone.

**The inpatient list is `beds.view`, not `nursing.tasks`.** The ward round's
patient list is read by doctors and reception as well as by nurses; only the
task list and the dashboard are nurse-only.

**Nothing logs clinical content.** Audit entries and log lines carry patient
numbers, bed numbers and record identifiers — never a set of readings, a
diagnosis or the detail of a nursing task.

---

## Billing and finance

Invoices, their line items, payments, expenses and the finance dashboard. Two
rules run through the whole module.

**Money is never a float.** Every amount is a PostgreSQL `NUMERIC(12,2)` bound
to a Python `Decimal`. Line totals, subtotals, tax and balances are all computed
on the server from the stored lines; the request schemas have no total field to
send.

**An invoice's status is a consequence, not an input.** It is derived from the
payments recorded against the bill, which is what makes the forbidden
`Paid → Unpaid` transition impossible rather than merely guarded — `InvoiceUpdate`
has no status field for a client to set.

| Method | Path | Permission | What |
| --- | --- | --- | --- |
| `GET` | `/api/invoices` | `billing.view` | Invoices, newest first — `?patient=` `?status=` `?department=` `?outstanding=` `?date_from=` `?date_to=` `?search=` |
| `POST` | `/api/invoices` | `billing.manage` | Raise an invoice and its lines in one transaction |
| `GET` | `/api/invoices/{id}` | `billing.view` | One invoice, with its line items and derived balance |
| `PUT` | `/api/invoices/{id}` | `billing.manage` | Amend it; refused once money has been collected against it |
| `GET` | `/api/invoices/{id}/payments` | `billing.view` | Everything collected against one bill |
| `POST` | `/api/invoices/{id}/payments` | `billing.manage` | Record a payment, in one locked transaction |
| `GET` | `/api/payments` | `billing.view` | The payment ledger — `?invoice=` `?patient=` `?method=` `?status=` `?date_from=` `?date_to=` |
| `GET` | `/api/payments/{id}` | `billing.view` | One payment |
| `PATCH` | `/api/payments/{id}/status` | `payments.manage` | Settle or fail a transfer taken as Processing |
| `GET` | `/api/expenses` | `billing.view` | Costs, newest first — `?category=` `?status=` `?date_from=` `?date_to=` |
| `POST` | `/api/expenses` | `expenses.manage` | Record a cost against a branch |
| `GET` | `/api/expenses/{id}` | `billing.view` | One expense |
| `PUT` | `/api/expenses/{id}` | `expenses.manage` | Amend it, including categorising a bank-feed entry |
| `GET` | `/api/billing/dashboard` | `billing.view` | Every figure the finance screens show, aggregated in SQL |
| `GET` | `/api/billing/ageing` | `billing.view` | Outstanding money in the four bands the outstanding screen draws |
| `GET` | `/api/billing/reports/revenue` | `finance.reports` | Collections against expenses, month by month |
| `GET` | `/api/billing/reports/expenses` | `finance.reports` | Expenses by category |
| `GET` | `/api/billing/reports/departments` | `finance.reports` | Collected revenue by the department that raised the bill |
| `GET` | `/api/patients/{id}/invoices` | `billing.view` | A patient's own bills |

No permission key is introduced. `billing.view`, `billing.manage`,
`payments.manage`, `expenses.manage` and `finance.reports` are the five the
frontend already defines, and no clinical role holds any of them — a doctor,
therapist or nurse gets a 403 from every route above, and Patient 360 reports
`invoices` in `restrictedSections` rather than returning an empty list that
would read as "no bills".

There is no DELETE, no cancellation endpoint and no refund workflow. The
frontend's `Invoice` status is Paid, Partially Paid, Unpaid or Overdue — there
is no cancelled state anywhere in the UI, and no refund screen — so none of the
three is invented here.

### Seed the ledger

```bash
./.venv/Scripts/python.exe seed_billing.py
```

Invoices, line items, payments and expenses from the frontend's original sample
data, plus eleven closed months of summary billing so the profit-and-loss chart
has a year of real shape to aggregate. Run `seed.py` and `seed_patients.py`
first.

> **DEVELOPMENT / DEMO ONLY.** Never run it against an environment holding real
> data.

### Design decisions

**Revenue is collected money, not billed money.** An unpaid invoice is a claim
on the future; counting it as income would overstate every figure on the page.
`GET /api/billing/dashboard` sums settled payments — a bank transfer still
Processing has not paid anything, and a failed one never will.

**A payment is taken under a row lock.** `POST /api/invoices/{id}/payments`
runs `BEGIN → lock the invoice → sum settled payments → validate against the
outstanding balance → insert → re-derive the status → COMMIT`. That lock is
what makes the overpayment rule hold under concurrency: two tills each taking
the last ₹5,000 of a ₹5,000 balance serialise on it, the first commits, and the
second re-reads a zero balance and gets a 409. Without it both would read
₹5,000 outstanding, both would pass the check, and the invoice would end up
₹5,000 over-collected with no way to tell which payment was the mistake.

**Overpayments are refused outright.** There is no reversal workflow in this
module, so accepting money the bill does not owe would create a credit balance
nothing here could discharge.

**Invoice numbers are allocated on the server.** `INV-YYYY-####` is issued
under an advisory lock held for the rest of the transaction, and from `MAX` of
the numeric suffix rather than `COUNT`, so a gap left by a rolled-back
transaction cannot produce a duplicate. React never generates one.

**A pharmacy sale is counted exactly once.** POS sales live in their own table
and are never mirrored into `invoices` — Step 9 kept the two apart deliberately,
and a walk-in customer has no patient to bill at all. The dashboard therefore
adds settled invoice payments and counter takings from two sources that cannot
overlap. `test_pharmacy_sale_not_double_counted` pins that: a ₹500 sale moves
the day's takings by ₹500, not ₹1,000.

**Every figure is aggregated in PostgreSQL.** The dashboard, the ageing bands,
the monthly series and both category breakdowns are `SUM`/`GROUP BY` queries,
not rows fetched and added up in Python. A clinic's payment table grows without
bound; a dashboard that loads it to total one day's takings gets slower every
week it runs.

**Overdue is derived, not stored.** A bill becomes overdue by the calendar
rather than by an event, so a stored status goes stale on its own. The column is
kept in step on every write, and the value the API returns is computed against
today's date in the clinic's timezone.

**Step 11 needed no migration.** `invoices`, `invoice_items`, `payments` and
`expenses` were all created by the Step 4 schema, with the money columns already
`NUMERIC(12,2)`.

---

## Administration

Staff accounts, the role-to-permission matrix, branches, system configuration
and the audit trail. One rule runs through all of it: **the backend is the
authority**. A role, an account status and a branch assignment are read from
PostgreSQL on every request — `resolve_token_user` re-loads the account and
`permissions_for_role` re-reads the matrix — so nothing a client holds in a
token or in local storage can grant it anything.

| Method | Path | Permission | What |
| --- | --- | --- | --- |
| `GET` | `/api/users` | `staff.manage` | Staff directory — `?search=` `?role=` `?status=` `?branch=`, filtered in SQL |
| `POST` | `/api/users` | `staff.manage` | Invite a staff member; the account starts `pending` |
| `GET` | `/api/users/clinicians` | `appointment.view` | Active doctors and therapists, as a name and an id |
| `GET` | `/api/users/{id}` | `staff.manage` | One account |
| `PUT` | `/api/users/{id}` | `staff.manage` | Name, email, role, designation, phone, department, branch |
| `POST` | `/api/users/{id}/approve` | `staff.manage` | `pending` to `active` |
| `POST` | `/api/users/{id}/activate` | `staff.manage` | `suspended` to `active` |
| `POST` | `/api/users/{id}/suspend` | `staff.manage` | Takes effect on their very next request |
| `GET` | `/api/roles` | `roles.manage` | The eight roles, their permissions and their headcount |
| `GET` | `/api/roles/permissions` | `roles.manage` | The permission catalogue the matrix is drawn from |
| `GET` | `/api/roles/{role}` | `roles.manage` | One role |
| `PUT` | `/api/roles/{role}/permissions` | `roles.manage` | Replace a role's whole permission set, transactionally |
| `GET` | `/api/branches` | `branches.manage` | Branches, with live staff and patient counts |
| `POST` | `/api/branches` | `branches.manage` | Create a branch |
| `GET` | `/api/branches/{id}` | `branches.manage` | One branch |
| `PUT` | `/api/branches/{id}` | `branches.manage` | Amend it — there is no delete |
| `GET` | `/api/settings` | `settings.manage` | System configuration, with each value's type preserved |
| `PUT` | `/api/settings` | `settings.manage` | Save it |
| `GET` | `/api/audit-logs` | `audit.view` | The trail — `?actor=` `?action=` `?category=` `?search=` `?date_from=` `?date_to=` |
| `GET` | `/api/admin/dashboard` | `staff.manage` | Headcount, branches, departments and patients, counted in SQL |

No permission key is introduced. `staff.manage`, `roles.manage`,
`branches.manage`, `settings.manage`, `audit.view` and `appointment.view` are
the six the frontend already defines.

### Design decisions

**A suspension bites immediately, not at token expiry.** Every request re-reads
the account, so a suspended user's next call is refused with a 403 while their
token is still perfectly valid and unexpired.
`test_suspended_user_cannot_access_api` pins that with a live token.

**A permission change needs no restart and no re-login.** Permissions are
resolved per request from `role_permissions`; there is no cache, so there is
nothing to invalidate. `test_a_removed_permission_stops_working_immediately`
strips `patient.view` from therapists and watches an existing therapist token
lose access on the next call.

**Status is not settable through `PUT /api/users/{id}`.** `UserUpdate` has no
status field, so approve, suspend and activate are the only ways an account
changes state and the transition rules live in one place. A client sending
`{"status": "active"}` changes nothing.

**The permission matrix is replaced, never patched.** The screen sends the whole
set a role should end up with. Every key is resolved before anything is deleted,
so an unknown one fails the request rather than leaving the role stripped, and
the delete and the inserts share one transaction.

**The owner role is the owner's to edit.** The Roles screen lets an
administrator select any role, so the guard is on the server. As seeded the
owner holds neither `staff.manage` nor `roles.manage`, which makes the owner
role effectively frozen — a stronger protection than asked for, and one an
administrator can deliberately and audibly relax through the matrix.

**An administrator cannot suspend themselves.** The staff screen offers Suspend
on every active row, including their own, so the refusal is explicit rather than
incidental.

**Invitations are pending accounts with a one-time password.** The invite dialog
says an onboarding link is sent, and this build has no mail server — inventing
one is out of scope. So the server generates a policy-satisfying password,
hashes it with Argon2 and returns the plaintext **once** to the administrator,
flagged `developmentOnly`. It is never stored readable and never logged;
`test_the_trail_records_no_credential` checks the audit trail for it.

**No response model carries a credential.** `UserResponse` has no password, hash
or token field, so there is nothing to accidentally serialise.

**Settings keep their types.** The `settings` value column is JSONB, so a toggle
comes back a boolean and a rate comes back a number. Only the thirteen keys the
configuration screen actually has are accepted; anything else is refused rather
than stored. No secret is served and none can be — the JWT secret, the database
password and every other credential live in the environment, not in this table.

**The audit trail is append-only by construction.** There is no update or delete
handler anywhere in the module, so the router answers 405 for a method it never
registered. That is not a permission check that could be misconfigured — the
code to rewrite history does not exist.

**Step 12 needed no migration.** `users`, `permissions`, `role_permissions`,
`branches` and `settings` were all created by the Step 4 schema, and `settings`
already had the JSONB value column this module needed.

**On `switchRole()`.** The demo affordance in `AuthContext` is gated on
`VITE_DEMO_MODE` and works by signing in through the real login endpoint with a
seeded account's real credentials. It cannot fabricate a role, because there is
no path by which a client asserts one —
`test_frontend_role_cannot_override_backend_role` forges role headers on a
therapist's token and watches every administrative route still answer 403.

---

## AI layer

Five assistants, none of which the rest of the application depends on. Delete
`app/ai/` and `app/api/ai.py`, drop the two lines that register them in
`app/api/router.py`, and every clinical, billing and scheduling feature works
exactly as before — the 500 tests that predate this layer all still pass, which
is how that claim was checked rather than assumed.

**The model never sees the database.** The path is fixed:

```
request
  -> permission check (the same key the underlying data needs)
  -> app/ai/retrieval.py           authorised, branch-scoped, column-limited
  -> deterministic computation     timeline / totals / dates, in SQL and Decimal
  -> [optional] the model          shown that context, asked for prose
  -> Pydantic validation           reject -> repair once -> reject for good
  -> human approval                for anything that becomes a record
  -> response
```

There is no tool-use loop, no SQL generation and no retrieval the model can
steer. It is handed a small, already-authorised context and asked to write
about it.

### Running with no provider

That is the default, and it is a supported state rather than a broken one.
`AI_PROVIDER` and `AI_API_KEY` are blank, `settings.ai_enabled` is false, and a
`NullProvider` declines every request. Each agent then answers from its
deterministic half and marks the run `DEGRADED`; the response carries
`meta.degraded: true` and a notice saying so. A recap still returns its full
timeline, an invoice check still finds every arithmetic error, and the finance
report is identical — what is missing is the sentence on top.

The same path runs on a timeout, a refusal, or output that fails validation.
That is deliberate: the degraded branch is the one exercised on every developer
machine and in CI, rather than the one nobody tries until production.

### Permissions

There is no `ai.use` key. One permission covering five features would let a
receptionist read consultation notes through the recap endpoint that the
patients module refuses them. Each agent needs the key its data needs:

| Agent | Permission | Roles holding it |
| --- | --- | --- |
| Patient recap | `patient.clinical.view` | doctor, therapist, nurse |
| Clinical documentation | `patient.clinical.edit` | doctor |
| Billing accuracy | `billing.view` | owner, admin, pharmacist, receptionist, accountant |
| Follow-up reminders | `appointment.create` | admin, doctor, receptionist |
| Finance insights | `finance.reports` | owner, admin, accountant |

`GET /api/ai/status` returns only the agents the caller holds a key for, so the
frontend never draws a control the backend will refuse.

### What each agent computes rather than generates

- **Recap** — the timeline is a query across appointments, consultations,
  therapy sessions, labs, prescriptions and admissions, ordered in SQL. The
  model is never asked to work out what happened when.
- **Documentation** — OCR text is transcribed into fields. Uncertainty is
  preserved: `?ligament strain` stays in `uncertain` and never becomes a
  diagnosis. Approval writes a **medical history entry**, not a prescription —
  a misread strength on a phone photo must not be dispensable.
- **Billing** — every total is recomputed in `Decimal` from the stored lines
  before the model is called, and the route has no write path. Findings that
  would increase a bill are reported exactly like findings that would reduce
  one; nothing is applied.
- **Follow-ups** — the date comes from the clinician who wrote one down, or
  from the clinic's standard interval. The model is never asked when a patient
  should return; it may only word the sentence carrying the date, and its
  output is rejected if it contains clinical terms or the wrong date.
- **Finance** — all arithmetic is `Decimal` over SQL aggregates. `drivers` says
  *where* revenue moved; `unexplained` states, whenever anything material moved,
  that the records do not say *why*. No cause is offered that the data does not
  carry.

### Consent and delivery

`patients.contact_consent` defaults to false. Holding a phone number is not
permission to use it, so a patient with no recorded consent is returned by name
in `skipped` for the front desk to ring, and no draft is written. Consent is
re-checked at approval, because it can be withdrawn in between.

A message a gateway accepts becomes `SENT`, never `DELIVERED`. This build has
no delivery callback, and reporting one as the other is how a clinic convinces
itself it reminded a patient it did not. With no gateway configured an approved
message stays `PENDING` and says so.

### Audit and payloads

Every run writes one `ai_audit_logs` row: who, which agent, which entity, which
model, which prompt version, how it ended, how long it took. Never the clinical
content it reasoned over — the recap lives in the record it summarised.

`AI_STORE_PAYLOADS` is off by default and is a development switch. When on,
prompts and completions are redacted of emails, phone numbers and long digit
strings before being written. That is a reduction, not anonymisation: a prompt
still contains clinical context, which is why the default is off.

### Configuration

```
AI_PROVIDER=            # blank = off, which is the shipping default
AI_API_KEY=             # never committed; .env is gitignored
AI_MODEL=
AI_BASE_URL=            # any OpenAI /chat/completions-compatible endpoint
AI_TIMEOUT_SECONDS=30
AI_RATE_LIMIT_PER_HOUR=60
AI_STORE_PAYLOADS=false

OCR_PROVIDER=           # blank = plain-text files only; images are stored unread
OCR_API_KEY=
OCR_ENDPOINT=

MESSAGING_PROVIDER=     # blank = reminders queue and are never marked sent
MESSAGING_API_KEY=
MESSAGING_SENDER_ID=
MESSAGING_ENDPOINT=
```

The rate limit counts only runs that reached a provider. Throttling the
deterministic path would be throttling PostgreSQL on behalf of a service that
was never called.

### Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/ai/status` | any signed-in user |
| POST | `/api/ai/patients/{id}/recap` | `patient.clinical.view` |
| POST | `/api/ai/documents` | `patient.clinical.edit` |
| GET | `/api/ai/documents` | `patient.clinical.edit` |
| GET | `/api/ai/documents/{id}` | `patient.clinical.edit` |
| GET | `/api/ai/documents/{id}/file` | `patient.clinical.edit` |
| POST | `/api/ai/documents/{id}/review` | `patient.clinical.edit` |
| POST | `/api/ai/invoices/{id}/check` | `billing.view` |
| POST | `/api/ai/followups/generate` | `appointment.create` |
| GET | `/api/ai/messages` | `appointment.create` |
| POST | `/api/ai/messages/{id}/approve` | `appointment.create` |
| POST | `/api/ai/finance/insights` | `finance.reports` |

---

## Tests

```bash
pytest
```

**473 tests.** Foundation (11) covers the health contract, OpenAPI, CORS and the
error envelope. Schema (38) covers every database constraint against real
PostgreSQL — partial unique indexes, GiST exclusion constraints and native
enums have no SQLite equivalent, so they are never faked. Authentication (46)
covers hashing, tokens, login, `/me`, role guards, permission guards and that
editing the matrix changes access immediately. Patients (44) covers pagination,
search, CRUD, patient-number uniqueness, clinical-permission gating and branch
isolation. Appointments (27) covers booking, backend-generated numbers and
tokens, conflict detection at both the service and the constraint level, every
state-machine transition including the refusals, cancellation over deletion,
and role-aware visibility. Clinical (46) covers consultations and their
ownership rules, medical history and its vocabulary, vitals recording and range
validation, lab review and its server-set attribution, prescription
transactionality, and that non-clinical roles are refused every clinical route.
Rehabilitation (57) covers plan creation and its date rules, the plan lifecycle,
therapist assignment and caseload isolation, milestones, session numbering and
the delivery workflow, exercise resolution and retirement, derived progress, and
that a therapist cannot reach another's plans or another branch's patients.
Pharmacy (50) covers the catalogue and its search, batch receipt and duplicate
refusal, inventory aggregation and the three alert lists, dispensing in every
shape (partial, full, insufficient, expired, FEFO), the POS including its
arithmetic and that prices cannot be sent, transactional rollback on both paths,
and — with two real threads on one batch — that concurrent dispensing cannot
drive stock negative. Nursing (54) covers the bed board and its summary, the
housekeeping transitions and the two that are refused, admission including
every way it can be blocked, the discharge checklist as a gate, discharge
releasing the bed, task attribution, the ward round's vitals, and — with two
real threads on one bed — that a bed can never hold two active admissions.
Billing (49) covers invoice totals computed from lines and never from a client,
invoice-number uniqueness under five concurrent tills, partial and full payment,
the overpayment refusal, money in flight not settling a balance, expense
categorisation and branch isolation, the dashboard's revenue, outstanding,
expense and net-revenue arithmetic, that a pharmacy sale is counted exactly
once, and that no clinical role can reach a financial route at all.
Administration (51) covers staff invitation and email uniqueness, the three
status transitions and the ones that are refused, a live token losing access the
instant its account is suspended or its role's permissions change, the
transactional permission replacement, owner-role protection, branch isolation,
typed settings, and — by forging role headers on a therapist's token — that the
frontend can never override the backend's idea of who someone is.

Tests that write to the database clean up after themselves, so a run leaves the
seeded demo data exactly as it found it.

Database-dependent tests skip automatically when PostgreSQL is unreachable, and
auth tests skip when the demo accounts have not been seeded.

---

## Project layout

```
backend/
├── app/
│   ├── main.py                 FastAPI app, CORS, lifespan, root endpoint
│   ├── api/
│   │   ├── router.py           Central router; domain routers register here
│   │   └── health.py           GET /api/health
│   ├── core/
│   │   ├── config.py           pydantic-settings, env-driven
│   │   ├── security.py         Argon2 hashing, JWT issue/verify
│   │   ├── permissions.py      The 33 permission codes and role matrix
│   │   ├── database.py         Engine, Base, get_db, health probe
│   │   ├── dependencies.py     DbSession, pagination
│   │   ├── enums.py            DisplayEnum (DB value ⇄ UI label)
│   │   ├── errors.py           Error envelope + handlers
│   │   ├── ids.py              PT-/APT-/RX-/INV- code formats
│   │   └── logging_config.py   Logging + credential redaction
│   ├── ai/
│   │   ├── provider.py         AIProvider ABC, null + chat-completions
│   │   ├── ocr.py              OCRProvider ABC, plain-text default
│   │   ├── messaging.py        MessagingProvider ABC; no agent imports it
│   │   ├── retrieval.py        Permission-aware, column-limited reads
│   │   ├── orchestrator.py     Rate limit, validate/repair, redact, audit
│   │   ├── schemas.py          Model-facing and client-facing contracts
│   │   ├── prompts/            Five versioned prompt modules
│   │   └── agents/             recap, documentation, billing, followup, finance
│   ├── models/                 42 SQLAlchemy models across 15 modules
│   ├── schemas/                auth, patient, appointment, clinical, lab,
│   │                           prescription, rehab, therapy, pharmacy, nursing
│   ├── services/               auth, patient, appointment, consultation, clinical,
│   │                           lab, prescription, rehab, therapy, pharmacy,
│   │                           nursing, scoping, avatars
│   └── repositories/           user, patient, appointment, clinical, rehab,
│                               pharmacy, nursing
├── seed.py                     Development data (permissions, roles, 18 staff)
├── seed_patients.py            14 patients with vitals, history and documents
├── seed_appointments.py        12 appointments across three doctors
├── seed_clinical.py            20 medicines, 5 lab reports, 8 prescriptions
├── seed_rehab.py               55 exercises, 14 plans, 229 therapy sessions
├── seed_nursing.py             Wards, beds, current admissions, nursing tasks
├── alembic/                    env.py targets Base.metadata
├── scripts/pg.ps1              Local PostgreSQL control
├── tests/test_health.py
├── requirements.txt            Direct dependencies
├── requirements.lock.txt       Full pinned tree
├── Dockerfile
└── docker-compose.yml
```

---

## Design decisions

**Sessions are per-request.** `get_db()` yields one session per request and
always closes it, rolling back if the request raised. There is no global
session. Services own their own transactions.

**Health checks tell the truth.** `/api/health` runs a real `SELECT 1`. It
returns `503` with `"database": "disconnected"` when PostgreSQL is unreachable —
never `connected` without a successful round trip. The probe uses its own
pool-free connection with a short timeout, so a dead database is reported in a
few seconds instead of blocking on TCP retries.

**Errors never leak internals.** Every failure returns
`{"detail": "...", "code": "..."}`. Database and unhandled errors return a
generic message plus a `reference` id; the real exception, with its stack trace,
goes to the log under that same id. A redaction filter scrubs DSN passwords and
`token=`/`secret=` patterns from log records.

**CORS is an explicit allow-list.** Origins come from `FRONTEND_URL` (plus
optional `EXTRA_CORS_ORIGINS`); `allow_origins=["*"]` is never used, and a test
asserts it.

**Migrations are the schema.** Alembic reads `DATABASE_URL` from settings rather
than `alembic.ini`, so credentials stay out of tracked files, and targets
`Base.metadata` with `compare_type` on. A naming convention is set on the
metadata so autogenerated constraint names stay stable.

**Startup is resilient.** The app retries the database connection on boot
(`DB_CONNECT_RETRIES`) but still starts if it fails, so the container serves and
reports `unhealthy` rather than crash-looping.

---

## Not built yet

No delivery callbacks: a reminder a gateway accepts is recorded as `SENT` and
never advances to `DELIVERED`, because nothing tells this system that it
arrived. No OCR engine ships configured, so a scanned image is stored unread
rather than guessed at. `patients.contact_consent` has no registration UI yet —
it can be set in the database and defaults to false, so reminders for patients
registered through the app are queued to the front desk by name rather than
sent.

The model is never asked to choose a follow-up date. The specification allows a
model suggestion as a third tier behind the clinician's date and the clinic's
rule; it is not implemented, because the first two tiers always produce a date
for anyone who qualifies and the third would be an untested path whose only job
is to invent one.

The pharmacy POS still records its own sales rather than raising invoices, which
is what keeps counter money and account receivables from being counted twice;
the finance dashboard reads both tables and adds each rupee once. Nursing still
stops at the ward: the discharge checklist has a "Billing cleared with accounts"
item, but ticking it is a ward-clerk statement rather than a settlement —
nothing in that module touches money.

Refunds, insurance claims, tax filing, payroll and a general ledger are all
absent by design. The frontend has no screen for any of them, and inventing
financial reversal logic without one would be guessing at how money is supposed
to move back.
