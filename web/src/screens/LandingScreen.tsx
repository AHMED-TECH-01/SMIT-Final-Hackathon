import { useEffect, useState } from 'react'
import { Link, useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import {
  IconBot,
  IconBuilding,
  IconCalendarCheck,
  IconCalendarClock,
  IconChart,
  IconCheckCircle,
  IconHistory,
  IconList,
  IconMegaphone,
  IconSettings,
  IconTeam,
  IconUserPlus,
  IconUsers,
  IconWallet,
  IconX,
  LeafLogo,
} from '../components/icons'
import { Badge, Button, Modal } from '../components/ui'

/**
 * Home / landing page: the public face at `/`.
 *
 * Two rules shape everything here.
 *  1. Nothing is faked. Every number is a property of this codebase (26 named
 *     permissions, 9 modules), the dashboard panel is labelled a preview, and
 *     there are no customer counts, uptime figures, certifications or
 *     testimonials.
 *  2. Nothing is dead. A link either navigates through the router or scrolls to
 *     a section that exists on this page, and the cards open public product
 *     information, never protected application data.
 */

const SECTIONS = {
  features: 'features',
  modules: 'modules',
  about: 'about',
  contact: 'contact',
} as const

/** Feature cards, each carrying the public detail shown when it is opened. */
const FEATURES: {
  id: string
  title: string
  summary: string
  icon: typeof IconUsers
  details: string[]
}[] = [
  {
    id: 'employees',
    title: 'Employee Management',
    summary: 'One record per person: profile, department, designation, status and history.',
    icon: IconUsers,
    details: [
      'A directory with search, filters and per-employee profiles.',
      'Departments, designations and employment types are configured in one place.',
      'Joining, transfer, probation and exit information stays with the record.',
      'Archiving keeps history without keeping the person in the active roster.',
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance Management',
    summary: 'Check in, check out, late marks and a day board the whole team can read.',
    icon: IconCalendarCheck,
    details: [
      'Self check-in and check-out from the employee view.',
      'Lateness is computed against the company working start and grace minutes.',
      'A daily board shows present, absent, late, remote and half-day statuses.',
      'Weekends and holidays come from the company calendar, not hardcoded rules.',
    ],
  },
  {
    id: 'leave',
    title: 'Leave Management',
    summary: 'Apply, approve and balance, with leave types and a working-day calendar.',
    icon: IconCalendarClock,
    details: [
      'Employees apply against their own leave types and see their balances.',
      'Approvals are queued for HR, and decisions are recorded with a reason.',
      'Balances use working days, holidays and the company time zone.',
      'Approved leave is reflected in attendance automatically.',
    ],
  },
  {
    id: 'payroll',
    title: 'Payroll Management',
    summary: 'Salary structures, monthly runs, and downloadable payslips.',
    icon: IconWallet,
    details: [
      'Per-employee salary structures with basic, allowances and deductions.',
      'A run is built from live attendance and leave, then reviewed before finalising.',
      'Runs move through draft, processed and finalised states with permissions on each step.',
      'Payslips are generated as PDFs the employee can download.',
    ],
  },
  {
    id: 'analytics',
    title: 'HR Analytics',
    summary: 'Headcount, attendance and leave dashboards built from the same data.',
    icon: IconChart,
    details: [
      'Workforce composition by department and designation.',
      'Attendance and leave trends for the selected period.',
      'Payroll totals once a run has been processed.',
      'Every figure is computed from stored records, nothing is sampled or simulated.',
    ],
  },
  {
    id: 'assistant',
    title: 'AI HR Assistant',
    summary: 'Ask a question in plain language and get an answer from your own data.',
    icon: IconBot,
    details: [
      'Answered through a fixed set of tools, not free-form database access.',
      'Each tool re-checks the caller’s effective permissions before it returns rows.',
      'Employees only ever reach their own records; HR and admin reach company data.',
      'The assistant can write nothing; it is read-only by construction.',
    ],
  },
  {
    id: 'announcements',
    title: 'Announcements',
    summary: 'Publish company news and reach every signed-in employee with it.',
    icon: IconMegaphone,
    details: [
      'Draft, publish and archive with priority levels.',
      'Delivered as in-app notifications with an unread count in the header.',
      'Readers see only published items; authors see their own drafts.',
    ],
  },
  {
    id: 'access',
    title: 'Role-Based Access Control',
    summary: 'Three roles, 26 named permissions, and an audit trail behind the privileged ones.',
    icon: IconCheckCircle,
    details: [
      'Administrator, HR and employee roles map to explicit permission sets.',
      'Every API route is guarded server-side; the UI only hides what is already refused.',
      'A password change or reset bumps a token version, which invalidates older sessions.',
      'Privileged actions are written to an audit log administrators can read.',
    ],
  },
  {
    id: 'organization',
    title: 'Organization Setup',
    summary: 'Working hours, time zone, currency, holidays and leave types in one settings page.',
    icon: IconBuilding,
    details: [
      'Company profile, working start and grace period.',
      'Leave types with their own annual entitlements.',
      'Holidays that attendance and leave calculations both respect.',
      'Departments and designations that the directory and payroll depend on.',
    ],
  },
]

/** The nine modules advertised on the page, matched to screens that exist. */
const MODULES: { title: string; description: string; icon: typeof IconUsers }[] = [
  {
    title: 'Organization Management',
    description: 'Company profile, departments, designations, holidays, leave types.',
    icon: IconBuilding,
  },
  {
    title: 'Employee Directory',
    description: 'Profiles, status, assignments and search across the workforce.',
    icon: IconTeam,
  },
  {
    title: 'Attendance Tracking',
    description: 'Check in and out, the daily board, and late-day reports.',
    icon: IconCalendarCheck,
  },
  {
    title: 'Leave & Approvals',
    description: 'Applications, balances, and the approval queue for HR.',
    icon: IconCalendarClock,
  },
  {
    title: 'Payroll Processing',
    description: 'Salary structures, monthly runs, and PDF payslips.',
    icon: IconWallet,
  },
  {
    title: 'Reports & Analytics',
    description: 'Workforce, attendance, leave and payroll dashboards.',
    icon: IconChart,
  },
  {
    title: 'AI Assistant',
    description: 'Questions answered from live data, inside the caller’s permissions.',
    icon: IconBot,
  },
  {
    title: 'Notifications & Announcements',
    description: 'Company news, approval alerts and an unread count.',
    icon: IconMegaphone,
  },
  {
    title: 'Security & Audit Logs',
    description: 'Roles, permissions, sessions and a record of privileged actions.',
    icon: IconHistory,
  },
]

const STEPS = [
  {
    title: 'Create your company account',
    description:
      'Register the organization and its first administrator. That account is signed in immediately.',
  },
  {
    title: 'Set up your workforce and HR policies',
    description:
      'Add departments, designations, leave types and holidays, then bring in employees and their salary structures.',
  },
  {
    title: 'Run HR from one dashboard',
    description:
      'Attendance, leave approvals, payroll runs, announcements and reports all read the same records.',
  },
]

const REASONS = [
  'Centralized employee information',
  'Simplified HR workflows',
  'Role-based access for administrator, HR and employee',
  'Attendance and leave automation',
  'Payroll visibility with downloadable payslips',
  'Data-driven HR insights',
  'AI-assisted HR operations within your permissions',
]

/** Smooth scroll to a section on this page; the header offset is handled by scroll-mt. */
function scrollToSection(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

interface SectionLinkProps {
  id: string
  label: string
  className?: string
  onActivate?: () => void
}

/** An anchor to an id on this page: real fragment, real scroll, no dead link. */
function SectionLink({ id, label, className = '', onActivate }: SectionLinkProps) {
  return (
    <a
      href={`#${id}`}
      className={className}
      onClick={(event) => {
        event.preventDefault()
        scrollToSection(id)
        onActivate?.()
      }}
    >
      {label}
    </a>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0">
      <LeafLogo className="w-7 h-7" />
      <span className="text-[18px] font-extrabold tracking-tight">
        <span className="text-ink">HCM </span>
        <span className="text-primary">Lite</span>
      </span>
    </Link>
  )
}

function NavBar() {
  const [open, setOpen] = useState(false)
  const { session } = useSession()

  const links = [
    { id: SECTIONS.features, label: 'Features' },
    { id: SECTIONS.modules, label: 'Modules' },
    { id: SECTIONS.about, label: 'About' },
    { id: SECTIONS.contact, label: 'Contact' },
  ]

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between gap-4">
        <Brand />

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          <Link
            to="/"
            className="px-3 py-2 rounded-ctrl text-[13px] font-medium text-ink/80 hover:bg-surface-muted"
          >
            Home
          </Link>
          {links.map((link) => (
            <SectionLink
              key={link.id}
              id={link.id}
              label={link.label}
              className="px-3 py-2 rounded-ctrl text-[13px] font-medium text-ink/80 hover:bg-surface-muted"
            />
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2">
          {session ? (
            <Link
              to="/"
              className="inline-flex items-center rounded-ctrl bg-primary-light px-3 py-2 text-[13px] font-semibold text-primary-dark"
            >
              Continue in your workspace
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="inline-flex items-center rounded-ctrl border border-line bg-white px-3.5 py-2 text-[13px] font-medium text-ink/80 hover:bg-surface-muted"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="inline-flex items-center rounded-ctrl bg-primary px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-primary-dark"
              >
                Get Started
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-ctrl border border-line text-ink/70 hover:bg-surface-muted"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <IconX className="w-4 h-4" /> : <IconList className="w-4 h-4" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-line bg-white px-5 py-4 space-y-3">
          <nav className="grid gap-1" aria-label="Mobile">
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-ctrl text-[13px] font-medium text-ink/80 hover:bg-surface-muted"
            >
              Home
            </Link>
            {links.map((link) => (
              <SectionLink
                key={link.id}
                id={link.id}
                label={link.label}
                className="px-3 py-2 rounded-ctrl text-[13px] font-medium text-ink/80 hover:bg-surface-muted"
                onActivate={() => setOpen(false)}
              />
            ))}
          </nav>

          <div className="flex flex-wrap gap-2 pt-1">
            {session ? (
              <Link
                to="/"
                onClick={() => setOpen(false)}
                className="inline-flex items-center rounded-ctrl bg-primary-light px-3.5 py-2 text-[13px] font-semibold text-primary-dark"
              >
                Continue in your workspace
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center rounded-ctrl border border-line bg-white px-3.5 py-2 text-[13px] font-medium text-ink/80"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center rounded-ctrl bg-primary px-3.5 py-2 text-[13px] font-semibold text-white"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

/** A labelled mock of the signed-in dashboard, built from the design tokens. */
function DashboardPreview() {
  const bars = [
    { label: 'Engineering', value: 24, max: 30 },
    { label: 'Human Resources', value: 12, max: 30 },
    { label: 'Finance', value: 9, max: 30 },
  ]

  return (
    <div className="relative">
      <div
        className="absolute -inset-4 rounded-card bg-primary-light/70 -z-10"
        aria-hidden="true"
      />

      <div className="card shadow-pop overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line bg-surface-muted/60">
          <div className="flex items-center gap-2">
            <LeafLogo className="w-4 h-4" />
            <span className="text-[12.5px] font-semibold text-ink">Your company</span>
            <Badge tone="primary">Dashboard</Badge>
          </div>
          <span className="text-[11px] text-ink-secondary">Today</span>
        </div>

        <div className="grid grid-cols-3 gap-3 p-4">
          {[
            { label: 'Present today', value: '38' },
            { label: 'On leave', value: '4' },
            { label: 'Late marks', value: '2' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-ctrl border border-line px-3 py-2.5">
              <div className="text-[10.5px] uppercase tracking-wide text-ink-secondary font-semibold">
                {stat.label}
              </div>
              <div className="text-[20px] font-bold text-ink leading-tight">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="px-4 pb-4 space-y-2.5">
          {bars.map((bar) => (
            <div key={bar.label} className="space-y-1">
              <div className="flex justify-between text-[11.5px]">
                <span className="text-ink/80">{bar.label}</span>
                <span className="text-ink-secondary">{bar.value} people</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/80"
                  style={{ width: `${Math.round((bar.value / bar.max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 pb-4 flex items-center justify-between gap-3 border-t border-line/70 pt-3">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-full bg-gradient-to-br from-primary to-[#0bbf6f] text-white text-[10px] font-bold">
              AR
            </span>
            <span className="grid place-items-center w-7 h-7 -ml-3 rounded-full bg-gradient-to-br from-info to-[#6aa8dd] text-white text-[10px] font-bold">
              SK
            </span>
            <span className="text-[11.5px] text-ink-secondary">+36 employees</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-primary-dark">
            <IconCalendarCheck className="w-4 h-4" /> Check in
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-ink-secondary text-center">
        Illustrative preview of the signed-in dashboard. Every figure above is a placeholder.
      </p>
    </div>
  )
}

function Hero() {
  const { navigate } = useRouter()

  return (
    <section className="bg-gradient-to-b from-primary-light/60 via-app to-app">
      <div className="mx-auto max-w-6xl px-5 py-14 lg:py-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-line px-3 py-1 text-[11.5px] font-semibold text-primary-dark">
            <LeafLogo className="w-3.5 h-3.5" /> Smarter HR. Happier Teams.
          </span>

          <h1 className="mt-5 text-[34px] sm:text-[44px] font-extrabold leading-[1.1] tracking-tight text-ink">
            Smart HR Management for a Better Tomorrow.
          </h1>

          <p className="mt-4 text-[15px] leading-relaxed text-ink-secondary max-w-xl">
            Manage your workforce, simplify HR operations, automate everyday tasks, and make smarter
            decisions with HCM Lite.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button onClick={() => navigate('/signup')} className="px-4 py-2.5 text-[13.5px]">
              Get Started Free
            </Button>
            <button
              type="button"
              onClick={() => scrollToSection(SECTIONS.features)}
              className="inline-flex items-center gap-1.5 rounded-ctrl border border-line bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink/80 hover:bg-surface-muted transition-colors"
            >
              Explore Features
            </button>
          </div>

          <p className="mt-5 text-[12px] text-ink-secondary">
            One sign-up creates the company and its first administrator. Already have a workspace?{' '}
            <Link to="/login" className="font-medium text-primary hover:text-primary-dark">
              Sign in
            </Link>
            .
          </p>
        </div>

        <DashboardPreview />
      </div>
    </section>
  )
}

function StatsBand() {
  const stats = [
    { value: '25+', label: 'HR functionalities', hint: '26 named permissions in one system' },
    { value: '9', label: 'Integrated HR modules', hint: 'From organization setup to audit logs' },
    {
      value: 'One',
      label: 'Centralized HR platform',
      hint: 'One record per person, shared by every module',
    },
  ]

  return (
    <section className="mx-auto max-w-6xl px-5">
      <div className="grid sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card px-5 py-5 text-center">
            <div className="text-[30px] font-extrabold text-primary tracking-tight">{stat.value}</div>
            <div className="text-[13px] font-semibold text-ink mt-0.5">{stat.label}</div>
            <div className="text-[11.5px] text-ink-secondary mt-1">{stat.hint}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Features() {
  const [openId, setOpenId] = useState<string | null>(null)
  const { navigate } = useRouter()
  const feature = FEATURES.find((entry) => entry.id === openId) ?? null

  return (
    <section id={SECTIONS.features} className="mx-auto max-w-6xl px-5 py-16 scroll-mt-20">
      <div className="max-w-2xl">
        <h2 className="text-[28px] font-extrabold text-ink tracking-tight">
          Everything You Need to Manage Your Workforce
        </h2>
        <p className="mt-2 text-[13.5px] text-ink-secondary leading-relaxed">
          Each area below is a screen in the product. Open a card for what it actually does; no
          protected data is shown on this page.
        </p>
      </div>

      <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FEATURES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setOpenId(entry.id)}
              className="card text-left p-5 group hover:shadow-pop hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <span className="grid place-items-center w-10 h-10 rounded-lg bg-primary-light text-primary">
                <Icon className="w-5 h-5" />
              </span>
              <h3 className="mt-3.5 text-[14px] font-semibold text-ink group-hover:text-primary-dark">
                {entry.title}
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{entry.summary}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                What it does
                <IconUserPlus className="w-3.5 h-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </button>
          )
        })}
      </div>

      {feature && (
        <Modal
          title={feature.title}
          description="Public product information. No company data is loaded for this."
          onClose={() => setOpenId(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpenId(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setOpenId(null)
                  navigate('/signup')
                }}
              >
                Get Started
              </Button>
            </>
          }
        >
          <ul className="space-y-2">
            {feature.details.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[13px] text-ink/85">
                <IconCheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                {line}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  )
}

function Modules() {
  return (
    <section id={SECTIONS.modules} className="bg-surface-muted/70 py-16 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-2xl">
          <h2 className="text-[28px] font-extrabold text-ink tracking-tight">
            Nine Modules, One Set of Records
          </h2>
          <p className="mt-2 text-[13.5px] text-ink-secondary leading-relaxed">
            Attendance, leave and payroll read the same employee record, so a day never has to be
            entered twice.
          </p>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((entry) => {
            const Icon = entry.icon
            return (
              <div key={entry.title} className="card p-5 hover:shadow-pop transition-shadow">
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center w-9 h-9 rounded-lg bg-white border border-line text-primary shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="text-[13.5px] font-semibold text-ink">{entry.title}</h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
                      {entry.description}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const { navigate } = useRouter()

  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="max-w-2xl">
        <h2 className="text-[28px] font-extrabold text-ink tracking-tight">How It Works</h2>
        <p className="mt-2 text-[13.5px] text-ink-secondary">
          Three steps from an empty deployment to a running HR workspace.
        </p>
      </div>

      <ol className="mt-8 grid lg:grid-cols-3 gap-4 list-none p-0">
        {STEPS.map((step, index) => (
          <li key={step.title} className="card p-5">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-primary text-white text-[14px] font-bold">
              {index + 1}
            </span>
            <h3 className="mt-3 text-[14px] font-semibold text-ink">{step.title}</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{step.description}</p>
            {index === 0 && (
              <div className="mt-4">
                <Button onClick={() => navigate('/signup')}>Create Account</Button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function About() {
  return (
    <section id={SECTIONS.about} className="bg-surface-muted/70 py-16 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 grid lg:grid-cols-[1fr_0.85fr] gap-10">
        <div>
          <h2 className="text-[28px] font-extrabold text-ink tracking-tight">Why Choose HCM Lite?</h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-secondary">
            HCM Lite is a human capital management system built on MongoDB, Express, React and
            TypeScript. It keeps the employee lifecycle in one place, from joining through
            attendance, leave and payroll to announcements and exit, with an audit trail behind the
            changes that matter.
          </p>

          <ul className="mt-6 space-y-2.5 list-none p-0">
            {REASONS.map((reason) => (
              <li key={reason} className="flex items-start gap-2.5 text-[13px] text-ink/85">
                <IconCheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                {reason}
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-6 h-fit">
          <h3 className="text-[15px] font-semibold text-ink">
            One deployment carries one organization
          </h3>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">
            Registration creates the company and its first administrator. That administrator then
            creates HR and employee accounts, and everyone signs in through the same session cookie,
            so there are no separate databases to keep in step.
          </p>
          <dl className="mt-5 space-y-3">
            {[
              { term: 'Roles', detail: 'Administrator, HR, employee' },
              { term: 'Sessions', detail: 'HttpOnly cookie, revocable per account' },
              { term: 'Passwords', detail: 'bcrypt hash only, strength enforced server-side' },
              { term: 'Audit', detail: 'Privileged actions recorded with actor and IP' },
            ].map((row) => (
              <div
                key={row.term}
                className="flex items-start justify-between gap-4 border-b border-line/70 pb-2.5"
              >
                <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">
                  {row.term}
                </dt>
                <dd className="text-[12.5px] text-ink/85 text-right">{row.detail}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11.5px] leading-relaxed text-ink-secondary">
            This instance was built for the Saylani AI Hackathon and ships with seeded demo data, not
            real personal records.
          </p>
        </div>
      </div>
    </section>
  )
}

function FinalCallToAction() {
  const { navigate } = useRouter()

  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="rounded-card bg-gradient-to-br from-primary to-[#045c35] text-white px-6 py-10 sm:px-10 text-center">
        <h2 className="text-[26px] sm:text-[30px] font-extrabold tracking-tight">
          Ready to Simplify Your HR Operations?
        </h2>
        <p className="mt-3 text-[13.5px] text-white/85 max-w-xl mx-auto leading-relaxed">
          Bring your people, processes, and workforce insights together with HCM Lite.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/signup')}
            className="inline-flex items-center rounded-ctrl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-primary-dark hover:bg-primary-light transition-colors"
          >
            Create Your Free Account
          </button>
          <button
            type="button"
            onClick={() => scrollToSection(SECTIONS.features)}
            className="inline-flex items-center rounded-ctrl border border-white/40 px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-white/10 transition-colors"
          >
            Review the Features
          </button>
        </div>
      </div>
    </section>
  )
}

function Contact() {
  return (
    <section id={SECTIONS.contact} className="bg-surface-muted/70 py-14 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 grid lg:grid-cols-2 gap-8 items-start">
        <div>
          <h2 className="text-[24px] font-extrabold text-ink tracking-tight">Contact</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary max-w-lg">
            This page is the public front of a single HCM Lite deployment, and no support inbox has
            been configured for it. Day-to-day help comes from your organization’s HCM Lite
            administrator, and account access, resets and role changes all go through them.
          </p>
        </div>

        <div className="card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-primary-light text-primary shrink-0">
              <IconSettings className="w-4 h-4" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink">Need an account in your company?</p>
              <p className="text-[12.5px] text-ink-secondary mt-0.5">
                An administrator creates employee and HR accounts from the Users screen.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-primary-light text-primary shrink-0">
              <IconMegaphone className="w-4 h-4" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-ink">Running your own deployment?</p>
              <p className="text-[12.5px] text-ink-secondary mt-0.5">
                Register the company and its first administrator here, then add your team.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/login"
              className="inline-flex items-center rounded-ctrl border border-line bg-white px-3.5 py-2 text-[12.5px] font-medium text-ink/80 hover:bg-surface-muted"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center rounded-ctrl bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-dark"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="bg-white border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <Brand />
          <p className="mt-3 text-[12.5px] text-ink-secondary leading-relaxed max-w-xs">
            Smarter HR. Happier Teams. Workforce, attendance, leave and payroll in one platform.
          </p>
        </div>

        <nav aria-label="Footer navigation">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink">Navigate</h3>
          <ul className="mt-3 space-y-2 text-[12.5px] text-ink-secondary list-none p-0">
            <li>
              <Link to="/" className="hover:text-primary">
                Home
              </Link>
            </li>
            <li>
              <SectionLink id={SECTIONS.features} label="Features" className="hover:text-primary" />
            </li>
            <li>
              <SectionLink id={SECTIONS.modules} label="Modules" className="hover:text-primary" />
            </li>
            <li>
              <SectionLink id={SECTIONS.about} label="About" className="hover:text-primary" />
            </li>
            <li>
              <SectionLink id={SECTIONS.contact} label="Contact" className="hover:text-primary" />
            </li>
          </ul>
        </nav>

        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink">Modules</h3>
          <ul className="mt-3 space-y-2 text-[12.5px] text-ink-secondary list-none p-0">
            {MODULES.slice(0, 6).map((entry) => (
              <li key={entry.title}>
                <SectionLink id={SECTIONS.modules} label={entry.title} className="hover:text-primary" />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink">Account</h3>
          <ul className="mt-3 space-y-2 text-[12.5px] text-ink-secondary list-none p-0">
            <li>
              <Link to="/login" className="hover:text-primary">
                Login
              </Link>
            </li>
            <li>
              <Link to="/signup" className="hover:text-primary">
                Sign Up
              </Link>
            </li>
            <li>
              <Link to="/forgot-password" className="hover:text-primary">
                Forgot password
              </Link>
            </li>
          </ul>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-secondary">
            No support address is configured for this deployment. See the contact section above.
          </p>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] text-ink-secondary">
            © 2026 HCM Lite. All rights reserved.
          </p>
          <p className="text-[11.5px] text-ink-secondary">
            Saylani AI Hackathon build with seeded demo data.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default function LandingScreen() {
  useEffect(() => {
    document.title = 'HCM Lite — Smart HR Management for a Better Tomorrow'
  }, [])

  return (
    <div className="min-h-screen bg-app">
      <NavBar />
      <main>
        <Hero />
        <StatsBand />
        <Features />
        <Modules />
        <HowItWorks />
        <About />
        <FinalCallToAction />
        <Contact />
      </main>
      <Footer />
    </div>
  )
}
