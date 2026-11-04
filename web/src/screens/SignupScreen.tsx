import { useEffect, useMemo, useState } from 'react'
import { useAction } from '../lib/hooks'
import { Link, useRouter } from '../lib/router'
import { useSession, type RegisterDetails } from '../lib/session'
import {
  IconCalendarCheck,
  IconCalendarClock,
  IconCheckCircle,
  IconEye,
  IconEyeOff,
  IconUserPlus,
  IconUsers,
  IconWallet,
  LeafLogo,
} from '../components/icons'
import { Banner, Button, Field, LeafBrand, Modal, Select, TextInput } from '../components/ui'

/**
 * Sign up — the public company registration screen at `/signup`.
 *
 * One form, one door: it posts to `POST /api/v1/auth/register`, which runs the
 * same creation path as the one-time setup wizard and answers 409 once the
 * deployment already has a company. The role is never chosen here — the server
 * makes this account the administrator, and the fields below are the only ones
 * that reach it.
 *
 * The client-side checks mirror the server rules so a mistake is caught before
 * a request is sent, but nothing here is trusted: `registerSchema` validates
 * again, and its field errors land in the same places as the local ones.
 */

/** Mirrors `COMPANY_SIZES` in server/src/modules/setup/setup.service.ts. */
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']

/** Mirrors the industry list the form offers; the value is stored as typed. */
const INDUSTRIES = [
  'Information Technology',
  'Banking & Finance',
  'Education',
  'Healthcare',
  'Manufacturing',
  'Retail',
  'Telecommunications',
  'Construction',
  'Logistics & Transport',
  'Hospitality',
  'Non-Governmental Organization',
  'Public Sector',
  'Other',
]

/** Mirrors `assertPasswordStrength` and PASSWORD_MIN_LENGTH on the server. */
const PASSWORD_RULES = [
  { label: 'At least 10 characters', test: (value: string) => value.length >= 10 },
  { label: 'One lowercase letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'One uppercase letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'One number', test: (value: string) => /[0-9]/.test(value) },
]

/** Mirrors `isPhoneLike` on the server: optional +, 7-15 digits, separators allowed. */
function isPhoneLike(value: string): boolean {
  return /^\+?\d{7,15}$/.test(value.replace(/[ ().\-]/g, ''))
}

const HIGHLIGHTS = [
  { title: 'Smart Employee Management', icon: IconUsers },
  { title: 'Simplified Attendance', icon: IconCalendarCheck },
  { title: 'Automated Leave Workflows', icon: IconCalendarClock },
  { title: 'Centralized Payroll', icon: IconWallet },
]

const TERMS_POINTS = [
  'Registration creates one company record and one administrator account on this deployment.',
  'The administrator role is assigned by the server. It cannot be requested or changed from this form.',
  'One deployment serves one organization. Once a company exists, registration closes and additional people are added by that administrator.',
  'Passwords must meet the strength policy shown above. Only a bcrypt hash is stored.',
  'Sessions are held in an HttpOnly cookie. A password change or reset revokes existing sessions.',
  'Privileged actions, including this registration, are recorded in an audit log with the actor and IP address.',
  'This is a hackathon build offered as-is for demonstration. Terms may change when the product is formally published.',
]

const PRIVACY_POINTS = [
  'What is collected: the administrator name, work email and phone, the company details on this form, and a password hash.',
  'What is created automatically: session records and audit entries for privileged actions, each storing the request IP address.',
  'Where it is stored: the MongoDB database configured for this deployment. No other datastore is used.',
  'No advertising or analytics trackers are embedded in the application itself.',
  'One third-party request does exist: the Inter font is loaded from Google Fonts, which sees the visitor IP address when the page loads.',
  'No email provider is configured, so no messages are sent or received on your behalf. Password resets are issued by an administrator.',
  'As an administrator you add employee records for other people; handle that data under your own organization policies.',
]

interface FormState {
  name: string
  email: string
  phone: string
  password: string
  confirmPassword: string
  companyName: string
  industry: string
  companySize: string
  country: string
  city: string
  companyEmail: string
  companyPhone: string
  acceptedTerms: boolean
  acceptedPrivacyPolicy: boolean
}

const INITIAL: FormState = {
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  companyName: '',
  industry: '',
  companySize: '',
  country: '',
  city: '',
  companyEmail: '',
  companyPhone: '',
  acceptedTerms: false,
  acceptedPrivacyPolicy: false,
}

/** Client-side mirror of the server validation, keyed by the server field paths. */
function validateForm(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {}

  if (form.name.trim().length < 2) errors['admin.name'] = 'Enter your full name.'
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(form.email.trim())) {
    errors['admin.email'] = 'Enter a valid work email.'
  }
  if (!isPhoneLike(form.phone.trim())) {
    errors['admin.phone'] = 'Enter a valid phone number, e.g. +92 300 1234567.'
  }
  const unmetRules = PASSWORD_RULES.filter((rule) => !rule.test(form.password))
  if (unmetRules.length) {
    errors['admin.password'] = `Password still needs ${unmetRules
      .map((rule) => rule.label.toLowerCase())
      .join(', ')}.`
  }
  if (form.password !== form.confirmPassword) {
    errors['admin.confirmPassword'] = 'Passwords do not match.'
  }

  if (form.companyName.trim().length < 2) errors['company.name'] = 'Company name is too short.'
  if (!form.industry) errors['company.industry'] = 'Choose an industry.'
  if (!form.companySize) errors['company.companySize'] = 'Choose how many people work here.'
  if (form.country.trim().length < 2) errors['company.country'] = 'Enter a country.'
  if (form.city.trim().length < 1) errors['company.city'] = 'Enter a city.'
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(form.companyEmail.trim())) {
    errors['company.email'] = 'Enter a valid company email.'
  }
  if (!isPhoneLike(form.companyPhone.trim())) {
    errors['company.phone'] = 'Enter a valid company phone number.'
  }

  if (!form.acceptedTerms) errors['acceptedTerms'] = 'You must accept the Terms of Service.'
  if (!form.acceptedPrivacyPolicy) {
    errors['acceptedPrivacyPolicy'] = 'You must accept the Privacy Policy.'
  }

  return errors
}

function PasswordToggle({
  visible,
  onToggle,
  id,
}: {
  visible: boolean
  onToggle: () => void
  id: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? `Hide password for ${id}` : `Show password for ${id}`}
      aria-pressed={visible}
      className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-ink-secondary hover:text-primary hover:bg-primary-light transition-colors"
    >
      {visible ? <IconEyeOff className="w-4 h-4" /> : <IconEye className="w-4 h-4" />}
    </button>
  )
}

export default function SignupScreen() {
  const { navigate } = useRouter()
  const { registerCompany, setupRequired } = useSession()
  const { run, busy, error, fieldErrors, setError } = useAction()

  const [form, setForm] = useState<FormState>(INITIAL)
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null)

  useEffect(() => {
    document.title = 'Create your account — HCM Lite'
  }, [])

  // The server owns this answer; the banner only tells the visitor what to
  // expect before they submit. A stale value still cannot create a second
  // company, because the API refuses with 409.
  const registrationOpen = setupRequired

  const errors = useMemo(
    () => (touched ? { ...localErrors, ...fieldErrors } : fieldErrors),
    [touched, localErrors, fieldErrors],
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    if (touched) setLocalErrors(validateForm({ ...form, [key]: value }))
  }

  const submit = () => {
    const found = validateForm(form)
    setTouched(true)
    setLocalErrors(found)
    if (Object.keys(found).length > 0) {
      setError(null)
      return
    }

    const details: RegisterDetails = {
      admin: {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword,
      },
      company: {
        name: form.companyName.trim(),
        industry: form.industry,
        companySize: form.companySize,
        country: form.country.trim(),
        city: form.city.trim(),
        email: form.companyEmail.trim(),
        phone: form.companyPhone.trim(),
      },
      acceptedTerms: form.acceptedTerms,
      acceptedPrivacyPolicy: form.acceptedPrivacyPolicy,
    }

    void run(async () => {
      await registerCompany(details)
      // The session cookie is already set, so the dashboard is the destination.
      navigate('/', { replace: true })
    })
  }

  const show = (field: string) => errors[field]

  return (
    <div className="min-h-screen bg-app grid lg:grid-cols-[0.95fr_1.05fr]">
      <aside className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-primary to-[#045c35] text-white p-10">
        <LeafBrand />

        <div className="max-w-md space-y-5">
          <h1 className="text-[32px] font-extrabold leading-tight">
            Build a Better Workplace with HCM Lite.
          </h1>
          <p className="text-[13.5px] text-white/80 leading-relaxed">
            Register your organization once, then run attendance, leave and payroll from the same
            employee records — with role-based access and an audit trail behind every change.
          </p>

          <ul className="space-y-2.5 pt-1">
            {HIGHLIGHTS.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.title} className="flex items-center gap-3 text-[13px] text-white/90">
                  <span className="grid place-items-center w-8 h-8 rounded-lg bg-white/15 shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  {item.title}
                </li>
              )
            })}
          </ul>

          <div className="rounded-card bg-white/10 border border-white/15 p-4">
            <p className="text-[11.5px] uppercase tracking-wide text-white/60 font-semibold">
              After you register
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/85">
              You land on the dashboard as the administrator of your company. Add departments, leave
              types and holidays, then create the rest of the team from the Users screen.
            </p>
          </div>
        </div>

        <p className="text-[11px] text-white/60">
          Saylani AI Hackathon build — seeded demo data, no real personal records.
        </p>
      </aside>

      <div className="grid place-items-center px-5 py-10 bg-gradient-to-b from-primary-light/60 via-app to-app">
        <div className="w-full max-w-xl">
          <div className="lg:hidden mb-6 flex items-center justify-between gap-3">
            <span className="text-[22px] font-extrabold tracking-tight">
              <span className="text-ink">HCM </span>
              <span className="text-primary">Lite</span>
            </span>
            <Link
              to="/login"
              className="text-[12.5px] font-medium text-primary hover:text-primary-dark"
            >
              Sign In
            </Link>
          </div>

          <div className="card p-6 sm:p-8 shadow-[0_18px_44px_-24px_rgba(7,139,81,0.35)]">
            <div className="mb-6">
              <h2 className="text-[24px] font-extrabold text-ink tracking-tight">
                Create Your Account
              </h2>
              <p className="text-[13px] text-ink-secondary mt-1">
                Get started with HCM Lite today.
              </p>
            </div>

            {!registrationOpen && (
              <div className="mb-4">
                <Banner tone="info">
                  This deployment already has a company account, so registration is closed here.{' '}
                  <Link to="/login" className="font-semibold underline underline-offset-2">
                    Sign in instead
                  </Link>
                  .
                </Banner>
              </div>
            )}

            {error && (
              <div className="mb-4">
                <Banner tone="danger">{error}</Banner>
              </div>
            )}

            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                submit()
              }}
            >
              <fieldset className="border-t border-line pt-5">
                <legend className="sr-only">Administrator information</legend>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-secondary mb-3">
                  Administrator Information
                </h3>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Full Name" htmlFor="name" error={show('admin.name')}>
                    <TextInput
                      id="name"
                      autoComplete="name"
                      value={form.name}
                      onChange={(event) => set('name', event.target.value)}
                      placeholder="Ahmed Raza"
                      aria-invalid={Boolean(show('admin.name'))}
                      required
                    />
                  </Field>

                  <Field label="Work Email" htmlFor="email" error={show('admin.email')}>
                    <TextInput
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => set('email', event.target.value)}
                      placeholder="you@company.com"
                      aria-invalid={Boolean(show('admin.email'))}
                      required
                    />
                  </Field>

                  <Field
                    label="Phone Number"
                    htmlFor="phone"
                    error={show('admin.phone')}
                    hint="Digits and an optional +; spaces and dashes are fine."
                  >
                    <TextInput
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(event) => set('phone', event.target.value)}
                      placeholder="+92 300 1234567"
                      aria-invalid={Boolean(show('admin.phone'))}
                      required
                    />
                  </Field>

                  <div className="hidden sm:block" />

                  <Field label="Password" htmlFor="password" error={show('admin.password')}>
                    <div className="relative">
                      <TextInput
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(event) => set('password', event.target.value)}
                        className="pr-10"
                        aria-invalid={Boolean(show('admin.password'))}
                        required
                      />
                      <PasswordToggle
                        id="password"
                        visible={showPassword}
                        onToggle={() => setShowPassword((value) => !value)}
                      />
                    </div>
                  </Field>

                  <Field
                    label="Confirm Password"
                    htmlFor="confirmPassword"
                    error={show('admin.confirmPassword')}
                  >
                    <div className="relative">
                      <TextInput
                        id="confirmPassword"
                        type={showConfirm ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.confirmPassword}
                        onChange={(event) => set('confirmPassword', event.target.value)}
                        className="pr-10"
                        aria-invalid={Boolean(show('admin.confirmPassword'))}
                        required
                      />
                      <PasswordToggle
                        id="confirmPassword"
                        visible={showConfirm}
                        onToggle={() => setShowConfirm((value) => !value)}
                      />
                    </div>
                  </Field>
                </div>

                <ul className="mt-4 grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {PASSWORD_RULES.map((rule) => {
                    const met = rule.test(form.password)
                    return (
                      <li
                        key={rule.label}
                        className={`flex items-center gap-1.5 text-[11.5px] ${
                          met ? 'text-primary-dark' : 'text-ink-secondary'
                        }`}
                      >
                        <IconCheckCircle
                          className={`w-3.5 h-3.5 shrink-0 ${met ? 'text-primary' : 'text-ink-secondary/40'}`}
                        />
                        {rule.label}
                      </li>
                    )
                  })}
                </ul>
              </fieldset>

              <fieldset className="border-t border-line mt-6 pt-5">
                <legend className="sr-only">Company information</legend>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-secondary mb-3">
                  Company Information
                </h3>

                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Company Name" htmlFor="companyName" error={show('company.name')}>
                    <TextInput
                      id="companyName"
                      autoComplete="organization"
                      value={form.companyName}
                      onChange={(event) => set('companyName', event.target.value)}
                      placeholder="Saylani Tech"
                      aria-invalid={Boolean(show('company.name'))}
                      required
                    />
                  </Field>

                  <Field label="Industry" htmlFor="industry" error={show('company.industry')}>
                    <Select
                      id="industry"
                      value={form.industry}
                      onChange={(event) => set('industry', event.target.value)}
                      aria-invalid={Boolean(show('company.industry'))}
                      required
                    >
                      <option value="">Select an industry</option>
                      {INDUSTRIES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    label="Company Size"
                    htmlFor="companySize"
                    error={show('company.companySize')}
                  >
                    <Select
                      id="companySize"
                      value={form.companySize}
                      onChange={(event) => set('companySize', event.target.value)}
                      aria-invalid={Boolean(show('company.companySize'))}
                      required
                    >
                      <option value="">Select a size</option>
                      {COMPANY_SIZES.map((option) => (
                        <option key={option} value={option}>
                          {option} employees
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Country" htmlFor="country" error={show('company.country')}>
                    <TextInput
                      id="country"
                      autoComplete="country-name"
                      value={form.country}
                      onChange={(event) => set('country', event.target.value)}
                      placeholder="Pakistan"
                      aria-invalid={Boolean(show('company.country'))}
                      required
                    />
                  </Field>

                  <Field label="City" htmlFor="city" error={show('company.city')}>
                    <TextInput
                      id="city"
                      autoComplete="address-level2"
                      value={form.city}
                      onChange={(event) => set('city', event.target.value)}
                      placeholder="Karachi"
                      aria-invalid={Boolean(show('company.city'))}
                      required
                    />
                  </Field>

                  <Field label="Company Email" htmlFor="companyEmail" error={show('company.email')}>
                    <TextInput
                      id="companyEmail"
                      type="email"
                      autoComplete="email"
                      value={form.companyEmail}
                      onChange={(event) => set('companyEmail', event.target.value)}
                      placeholder="hr@company.com"
                      aria-invalid={Boolean(show('company.email'))}
                      required
                    />
                  </Field>

                  <Field
                    label="Company Phone Number"
                    htmlFor="companyPhone"
                    error={show('company.phone')}
                  >
                    <TextInput
                      id="companyPhone"
                      type="tel"
                      autoComplete="tel"
                      value={form.companyPhone}
                      onChange={(event) => set('companyPhone', event.target.value)}
                      placeholder="+92 21 3456789"
                      aria-invalid={Boolean(show('company.phone'))}
                      required
                    />
                  </Field>
                </div>

                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-secondary">
                  Working hours, time zone and currency are not guessed from these answers. Set them
                  on the Settings screen once you are signed in.
                </p>
              </fieldset>

              <fieldset className="border-t border-line mt-6 pt-5">
                <legend className="sr-only">Terms and privacy</legend>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-secondary mb-3">
                  Terms and Conditions
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="flex items-start gap-2.5 text-[12.5px] text-ink/85 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.acceptedTerms}
                        onChange={(event) => set('acceptedTerms', event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
                      />
                      <span>
                        I accept the{' '}
                        <button
                          type="button"
                          onClick={() => setLegalDoc('terms')}
                          className="font-medium text-primary hover:text-primary-dark underline underline-offset-2"
                        >
                          Terms of Service
                        </button>
                        .
                      </span>
                    </label>
                    {show('acceptedTerms') && (
                      <p className="text-[11.5px] text-danger mt-1">{show('acceptedTerms')}</p>
                    )}
                  </div>

                  <div>
                    <label className="flex items-start gap-2.5 text-[12.5px] text-ink/85 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.acceptedPrivacyPolicy}
                        onChange={(event) => set('acceptedPrivacyPolicy', event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
                      />
                      <span>
                        I accept the{' '}
                        <button
                          type="button"
                          onClick={() => setLegalDoc('privacy')}
                          className="font-medium text-primary hover:text-primary-dark underline underline-offset-2"
                        >
                          Privacy Policy
                        </button>
                        .
                      </span>
                    </label>
                    {show('acceptedPrivacyPolicy') && (
                      <p className="text-[11.5px] text-danger mt-1">{show('acceptedPrivacyPolicy')}</p>
                    )}
                  </div>
                </div>
              </fieldset>

              <Button type="submit" loading={busy} className="w-full mt-6 py-2.5">
                {busy ? 'Creating your account…' : 'Create Company Account'}
              </Button>
            </form>

            <p className="text-[12.5px] text-ink-secondary mt-5 text-center">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-primary hover:text-primary-dark">
                Sign In
              </Link>
            </p>
          </div>

          <p className="text-[11.5px] text-ink-secondary mt-5 leading-relaxed text-center max-w-md mx-auto">
            <IconUserPlus className="w-3.5 h-3.5 inline mr-1 align-[-2px]" />
            This form creates the company and its first administrator. The administrator role is
            assigned by the server and cannot be chosen here.
          </p>
        </div>
      </div>

      {legalDoc && (
        <Modal
          title={legalDoc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
          description={
            legalDoc === 'terms'
              ? 'What registration on this deployment actually does.'
              : 'What is collected, where it is stored, and what is not.'
          }
          onClose={() => setLegalDoc(null)}
          footer={
            <Button
              onClick={() => {
                setLegalDoc(null)
                if (legalDoc === 'terms') set('acceptedTerms', true)
                else set('acceptedPrivacyPolicy', true)
              }}
            >
              Accept and close
            </Button>
          }
        >
          <div className="flex items-start gap-2.5 mb-4">
            <LeafLogo className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Written for this codebase, not copied from a template. It describes the behaviour you
              can verify in the repository.
            </p>
          </div>

          <ul className="space-y-2.5">
            {(legalDoc === 'terms' ? TERMS_POINTS : PRIVACY_POINTS).map((point) => (
              <li key={point} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink/85">
                <IconCheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                {point}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  )
}
