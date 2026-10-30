import { LeafLogo } from './icons'
import { Link, useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import { visibleNavItems } from './nav'

export default function Sidebar() {
  const { can } = useSession()
  const { path } = useRouter()
  const items = visibleNavItems(can)

  return (
    <aside className="hidden md:flex w-sidebar shrink-0 flex-col bg-white border-r border-line h-screen sticky top-0">
      <Link to="/" className="flex items-center gap-2.5 px-4 h-header border-b border-line/70">
        <LeafLogo className="w-8 h-8 shrink-0" />
        <span className="leading-tight">
          <span className="block text-[19px] font-extrabold tracking-tight">
            <span className="text-ink">HCM </span>
            <span className="text-primary">Lite</span>
          </span>
          <span className="block text-[10.5px] text-info/80 font-medium">
            Smarter HR. Happier Teams.
          </span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)

          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center gap-2.5 px-3 py-[7px] rounded-ctrl text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-primary-light text-primary-dark font-semibold'
                  : 'text-ink/75 hover:bg-surface-muted'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-primary" />
              )}
              <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-primary' : 'text-ink-secondary'}`} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3">
        <div className="rounded-card bg-gradient-to-b from-primary-light to-[#d5f0e0] border border-line p-3.5 relative overflow-hidden">
          <p className="text-[12.5px] font-semibold text-primary-dark leading-snug pr-8">
            Better HR Builds Stronger Teams.
          </p>
          <LeafLogo className="absolute -right-2 -bottom-3 w-12 h-12 opacity-70 rotate-[-15deg]" />
        </div>
      </div>
    </aside>
  )
}
