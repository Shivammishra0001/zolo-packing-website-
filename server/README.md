# Arogya Rehab — Rehabilitation Centre HMS

A production-quality Hospital Management System front-end built for a **rehabilitation centre**, not a
general hospital. One application, one login page, eight role-based dashboards.

> **Demonstration build.** Everything runs on realistic sample data held in `src/data/`. There is no
> backend, and the AI assistant is a scripted demo — it produces no diagnoses or treatment advice.

---

## Getting started

```bash
npm install
```

```bash
npm run dev
```

The app runs at **http://localhost:5173**.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check then production build |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only, no emit |

---

## Demo accounts

Every role signs in at the same page — `/login`. The platform reads the role after authentication and
routes to the right dashboard. Click any card in the **Demo Accounts** panel to fill the form.

**Shared password: `arogya@2026`**

| Role | Email | Lands on |
| --- | --- | --- |
| Hospital Owner | `owner@rehab.com` | `/owner/dashboard` |
| Administrator | `admin@rehab.com` | `/admin/dashboard` |
| Doctor | `doctor@rehab.com` | `/doctor/dashboard` |
| Therapist | `therapist@rehab.com` | `/therapist/dashboard` |
| Nurse | `nurse@rehab.com` | `/nurse/dashboard` |
| Pharmacist | `pharmacy@rehab.com` | `/pharmacist/dashboard` |
| Receptionist | `reception@rehab.com` | `/reception/dashboard` |
| Accountant | `accounts@rehab.com` | `/accountant/dashboard` |

Once signed in, the avatar menu has a **Demo — switch role** grid so you can hop between dashboards
without signing out.

---

## What each role sees

- **Owner** — revenue/expense/profit trend, department mix, patient volume, occupancy gauge, therapist
  workload, package utilisation, and the alerts that matter (low stock, near expiry, outstanding debt).
- **Administrator** — staff directory with approve/suspend, the live permission matrix, departments,
  branch setup, system configuration, and an audit log.
- **Doctor** — today's clinic timeline, a large "next patient" card, pending items, and a full
  consultation screen (complaint → examination → diagnosis → prescription → follow-up).
- **Therapist** — today's therapy list, assigned-patient progress cards, and a session-entry screen with
  sliders for pain, mobility and strength that feed the progress chart.
- **Nurse** — patients grouped by ward → room → bed, prioritised task list, vitals rounds with
  out-of-range highlighting, and a discharge checklist gated on billing clearance.
- **Pharmacist** — dispensing queue that checks live stock, inventory register, stock/expiry alerts with
  reorder suggestions, and a working point-of-sale with cart, discount, GST and receipt.
- **Receptionist** — quick actions, appointment list with inline check-in, a token-based queue board, a
  walk-in registration form, and live bed availability.
- **Accountant** — today's collections, payment-method breakdown, ageing analysis of outstanding
  invoices, expense categorisation, and a monthly P&L statement.

Shared across roles (subject to permission): **Patient 360**, patients directory, appointments, beds,
rehab plans, invoices, reports and preferences.

---

## Patient 360

The central record, at `/patients/:patientId`. Ten tabs: Overview, Medical History, Appointments, Rehab
Plan, Therapy Sessions, Vitals, Prescriptions, Billing, Documents and Progress.

The rehabilitation progress section shows overall completion, sessions completed/remaining, animated
score rings for pain, mobility, strength, attendance and adherence, a weekly trend chart plotting
mobility and strength against pain on a second axis, and a milestone timeline.

Try **PT-10248 (Raj Kumar)** for an on-track plan and **PT-10251 (Simran Kaur)** for a plateaued one.

---

## Global patient search

In the top bar, or press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd> anywhere. Searches by name,
patient ID and phone number, with a command-palette dropdown, arrow-key navigation and Enter to open
Patient 360.

Sample queries: `Raj Kumar` · `PT-10263` · `98201` · `Neuro Rehabilitation`

---

## Role-based access

Access is driven by a permission matrix rather than hard-coded role checks:

```
src/lib/permissions.ts   ROLE_PERMISSIONS: Record<Role, Permission[]>
src/lib/navigation.ts    NAVIGATION: Record<Role, NavSection[]>   (each item carries a permission)
```

Nothing in the UI branches on `role === 'doctor'`. Navigation items, route guards and in-page actions
all resolve through `can()` / `useAuth().has()`, so what a person can see and what they can open never
drift apart. Menu entries a user lacks permission for are not rendered at all.

Because the matrix is plain data, a real backend can return the same `{ role, permissions[] }` shape
from `/api/session` and the UI keeps working unchanged.

---

## Tech stack

React 18 · TypeScript (strict) · Vite 6 · Tailwind CSS 3 · shadcn/ui-style components on Radix
primitives · Lucide icons · Framer Motion · Recharts.

Every page is code-split, so the landing page ships ~22 kB of route code rather than the whole app, and
Recharts loads only on screens that draw charts.

---

## Project structure

```
src/
├── components/
│   ├── ui/            Button, Card, Badge, Input, Select, Dialog, Sheet, Tabs,
│   │                  DataTable (responsive → cards), Toast, ConfirmDialog, StatusBadge…
│   ├── layout/        AppShell, Sidebar, Topbar, MobileNav, GlobalSearch,
│   │                  NotificationsMenu, AIAssistant, PageHeader, RouteGuards
│   ├── dashboard/     KpiCard, SectionCard, StatTile, AlertList, ActivityTimeline, BedBoard
│   ├── charts/        RevenueTrend, Donut, BarSeries, RehabProgress, OccupancyGauge, chart-theme
│   ├── patients/      PatientHeader, VitalsGrid
│   ├── appointments/  AppointmentTimeline
│   ├── rehab/         RehabProgressPanel
│   └── pharmacy/      PrescriptionDetail
├── pages/             Landing, Login, NotFound + owner/ admin/ doctor/ therapist/
│                      nurse/ pharmacist/ reception/ accountant/ shared/
├── data/              patients, appointments, therapy, medicines, billing,
│                      operations, analytics, notifications, users
├── context/           AuthContext, ThemeContext, NotificationContext
├── hooks/             useCountUp, useMediaQuery, useLocalStorage
├── lib/               permissions, navigation, icons, utils
└── types/             Domain model
```

---

## Design system

Tokens live in `src/index.css` as HSL triples and are consumed through Tailwind. Light theme is
near-white with deep-navy text and a teal clinical accent; dark theme is a desaturated navy surface set,
tuned per token rather than inverted, so chart series, status colours and borders all stay legible.

Theme preference (light / dark / system) persists to `localStorage` under `arogya.theme`; the sidebar
collapsed state persists under `arogya.sidebar.collapsed`.

Charts read the CSS custom properties at runtime and re-sample them on theme change — Recharts writes
colours into SVG presentation attributes, which do not resolve `var()`.

---

## Responsive behaviour

| Breakpoint | Layout |
| --- | --- |
| Desktop (≥1024px) | Fixed collapsible sidebar (262px ↔ 76px icons-only) + full dashboard grids |
| Tablet | Sidebar becomes a drawer; search moves to its own row; grids reflow to two columns |
| Mobile (<768px) | Bottom navigation with the four top destinations + More drawer; every `DataTable` renders as stacked cards instead of a table |

---

## Notes and limitations

- All data is in-memory. Actions such as dispensing, check-in, task completion and invoice payment
  update React state and show a toast; a refresh restores the seed data.
- The AI assistant matches keywords against pre-written summaries of the sample data. It is labelled
  **AI Demo** in the UI and refuses nothing because it attempts nothing clinical.
- No compliance or certification claims are made anywhere in the product copy.
#   h m s - w e b s i t e -  
 #   h m s - w e b s i t e -  
 #   h m s - w e b s i t e -  
 #   h m s - w e b s i t e -  
 #   h m s - w e b s i t e -  
 