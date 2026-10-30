import type { ReactNode } from 'react'
import { IconX, LeafLogo } from './icons'

/**
 * The component vocabulary for the app.
 *
 * Screens are built from these so that spacing, borders, focus rings and state
 * colours are decided once. Tailwind classes here are the only place that knows
 * the design tokens defined in tailwind.config.js.
 */

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-primary hover:bg-primary-dark text-white border border-transparent',
  outline: 'bg-white hover:bg-surface-muted text-ink/80 border border-line',
  ghost: 'bg-transparent hover:bg-surface-muted text-ink/70 border border-transparent',
  danger: 'bg-danger hover:bg-[#c94848] text-white border border-transparent',
}

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
  className?: string
  title?: string
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  loading,
  className = '',
  title,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-ctrl px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_STYLES[variant]} ${className}`}
    >
      {loading && <Spinner className="w-3.5 h-3.5" />}
      {children}
    </button>
  )
}

export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px] ${className}`}
      aria-hidden="true"
    />
  )
}

/** Brand lock-up for the coloured panels on the auth screens. */
export function LeafBrand({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center">
        <LeafLogo className="w-5 h-5 text-white" />
      </span>
      <span className="leading-tight">
        <span className="block text-[19px] font-extrabold tracking-tight">HCM Lite</span>
        {subtitle && (
          <span className="block text-[10.5px] text-white/70 font-medium">
            Smarter HR. Happier Teams.
          </span>
        )}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 justify-between mb-4">
      <div>
        <h1 className="text-[24px] font-extrabold text-ink tracking-tight">{title}</h1>
        {description && <p className="text-[13px] text-ink-secondary mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line/80">
          <div>
            {title && <h2 className="text-[14px] font-semibold text-ink">{title}</h2>}
            {description && <p className="text-[12px] text-ink-secondary mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ReactNode
  tone?: 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'neutral'
}) {
  const tones: Record<string, string> = {
    primary: 'bg-primary-light text-primary',
    success: 'bg-primary-light text-success',
    info: 'bg-[#e8f1fb] text-info',
    warning: 'bg-[#fdf3e3] text-warning',
    danger: 'bg-[#fbeaea] text-danger',
    neutral: 'bg-surface-muted text-ink-secondary',
  }

  return (
    <div className="card flex items-center gap-3.5 px-4 py-3.5">
      {icon && (
        <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${tones[tone]}`}>
          {icon}
        </span>
      )}
      <div className="leading-tight min-w-0">
        <div className="text-[12px] text-ink-secondary font-medium truncate">{label}</div>
        <div className="kpi-value">{value}</div>
        {hint && <div className="text-[11px] text-ink-secondary/80 truncate">{hint}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-ink/80 mb-1">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11.5px] text-danger mt-1">{error}</p>
      ) : (
        hint && <p className="text-[11.5px] text-ink-secondary mt-1">{hint}</p>
      )}
    </div>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`input ${className}`} />
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`input ${className}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select {...rest} className={`input ${className}`}>
      {children}
    </select>
  )
}

/** A checkbox with its label on one line, used in most filter bars. */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[12.5px] text-ink/80 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
      />
      {label}
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Banner({
  tone = 'info',
  children,
  onDismiss,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  children: ReactNode
  onDismiss?: () => void
}) {
  const tones: Record<string, string> = {
    info: 'bg-[#eef5fc] border-[#cfe0f3] text-[#2f6fa8]',
    success: 'bg-primary-light border-[#c6ecd7] text-primary-dark',
    warning: 'bg-[#fdf6e9] border-[#f2e0ba] text-[#966a16]',
    danger: 'bg-[#fbeaea] border-[#f2cccc] text-[#a83c3c]',
  }

  return (
    <div className={`flex items-start gap-2 rounded-ctrl border px-3 py-2 text-[12.5px] ${tones[tone]}`}>
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-70">
          <IconX className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      {description && <p className="text-[12.5px] text-ink-secondary mt-1">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary py-8 justify-center">
      <Spinner /> {label}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const BADGE_STYLES: Record<Tone, string> = {
  primary: 'bg-primary-light text-primary-dark',
  success: 'bg-primary-light text-success',
  warning: 'bg-[#fdf3e3] text-[#a9741f]',
  danger: 'bg-[#fbeaea] text-[#b04a4a]',
  info: 'bg-[#e8f1fb] text-info',
  neutral: 'bg-surface-muted text-ink-secondary',
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-wide ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  )
}

/** One place that decides what colour a status word gets. */
export function statusTone(value: string): Tone {
  switch (value) {
    case 'present':
    case 'approved':
    case 'published':
    case 'active':
    case 'finalized':
      return 'success'
    case 'late':
    case 'probation':
    case 'pending':
    case 'draft':
      return 'warning'
    case 'absent':
    case 'rejected':
    case 'terminated':
    case 'urgent':
      return 'danger'
    case 'remote':
    case 'half-day':
    case 'high':
      return 'info'
    default:
      return 'neutral'
  }
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">{children}</table>
    </div>
  )
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`text-[11px] font-semibold uppercase tracking-wide text-ink-secondary px-4 py-2 border-b border-line/80 bg-surface-muted/50 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-2.5 text-[12.5px] text-ink/85 border-b border-line/60 align-middle ${className}`}>
      {children}
    </td>
  )
}

export function Avatar({ name, className = '' }: { name: string; className?: string }) {
  const text = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <span
      className={`grid place-items-center rounded-full bg-gradient-to-br from-primary to-[#0bbf6f] text-white text-[11px] font-bold shrink-0 ${className || 'w-8 h-8'}`}
    >
      {text || '?'}
    </span>
  )
}

/** A horizontal bar used for simple distributions, no chart library needed. */
export function BarRow({
  label: name,
  value,
  max,
  suffix,
  tone = 'primary',
}: {
  label: string
  value: number
  max: number
  suffix?: string
  tone?: 'primary' | 'info' | 'warning'
}) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  const tones: Record<string, string> = {
    primary: 'bg-primary/80',
    info: 'bg-info/70',
    warning: 'bg-warning/80',
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-ink/80 truncate">{name}</span>
        <span className="text-ink-secondary font-medium">
          {value}
          {suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
        <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/35 p-4 overflow-y-auto">
      <div
        className={`card w-full my-8 ${wide ? 'max-w-3xl' : 'max-w-lg'} shadow-pop`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-line">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="text-[12px] text-ink-secondary mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-surface-muted text-ink-secondary"
          >
            <IconX className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-surface-muted/40 rounded-b-card">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line mb-4">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative px-3.5 py-2 text-[12.5px] font-medium rounded-t-ctrl transition-colors ${
              active
                ? 'text-primary-dark font-semibold bg-primary-light/60'
                : 'text-ink-secondary hover:text-ink hover:bg-surface-muted'
            }`}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className="ml-1.5 text-[10.5px] font-bold text-ink-secondary">{tab.count}</span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded bg-primary" />}
          </button>
        )
      })}
    </div>
  )
}
