import { useCallback, useEffect, useState } from 'react'
import { pb } from '@/lib/pb'
import { Login } from '@/components/Login'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { useCollectionTotal } from '@/hooks/useCollectionTotal'
import { FederationsPage } from '@/features/federations/FederationsPage'
import { ClubsPage } from '@/features/clubs/ClubsPage'
import { ContactsPage } from '@/features/contacts/ContactsPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { DiscoveryPage } from '@/features/discovery/DiscoveryPage'
import { TournamentsPage } from '@/features/tournaments/TournamentsPage'

const VIEWS = ['dashboard', 'federations', 'clubs', 'contacts', 'discovery', 'tournaments'] as const
type View = (typeof VIEWS)[number]

// The current view lives in the URL path (`/federations`, `/clubs`) so it
// survives a page refresh. PocketBase serves the SPA with index.html fallback,
// so deep links resolve in prod the same as Vite's dev server does.
function pathToView(path: string): View {
  const seg = path.replace(/^\/+/, '').split('/')[0]
  return (VIEWS as readonly string[]).includes(seg) ? (seg as View) : 'dashboard'
}

// A navigation target = view + optional filters, encoded in the URL
// (`/clubs?country=Bulgaria`, `/contacts?club=<id>`) so they survive refresh and
// back/forward. `country` drives the Clubs filter; `club` drives the Contacts filter.
interface Loc {
  view: View
  country: string | null
  club: string | null
}
function readLoc(): Loc {
  const p = new URLSearchParams(window.location.search)
  return {
    view: pathToView(window.location.pathname),
    country: p.get('country'),
    club: p.get('club'),
  }
}

type NavOpts = { country?: string | null; club?: string | null }
function useNav(): [Loc, (view: View, opts?: NavOpts) => void] {
  const [loc, setLoc] = useState<Loc>(() => readLoc())
  useEffect(() => {
    const onPop = () => setLoc(readLoc())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((view: View, opts?: NavOpts) => {
    const p = new URLSearchParams()
    if (opts?.country) p.set('country', opts.country)
    if (opts?.club) p.set('club', opts.club)
    const qs = p.toString()
    const target = '/' + view + (qs ? '?' + qs : '')
    if (target !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', target)
    }
    setLoc({ view, country: opts?.country ?? null, club: opts?.club ?? null })
  }, [])
  return [loc, navigate]
}

export default function App() {
  const [authed, setAuthed] = useState(pb.authStore.isValid)
  const [menuOpen, setMenuOpen] = useState(false)
  const [{ view, country, club }, navigate] = useNav()

  useEffect(() => pb.authStore.onChange(() => setAuthed(pb.authStore.isValid)), [])

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <button onClick={() => navigate('dashboard')} aria-label="Home" className="flex items-center rounded-md p-0.5 hover:bg-neutral-100">
            <img src="/volleyball.png" alt="Volleyball" className="h-8 w-8" />
          </button>
          {/* desktop nav */}
          <MainNav view={view} navigate={navigate} className="hidden md:flex" />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-neutral-500 sm:inline">{pb.authStore.record?.email}</span>
            <Tooltip side="bottom" content="Sign out">
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => pb.authStore.clear()}>
                <SignOutIcon />
              </Button>
            </Tooltip>
            {/* mobile hamburger */}
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 text-neutral-700 hover:bg-neutral-100 md:hidden"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <CloseIcon /> : <HamburgerIcon />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-neutral-200 px-4 py-2 md:hidden">
            <MainNav view={view} navigate={(v) => { navigate(v); setMenuOpen(false) }} vertical />
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {view === 'dashboard' ? (
          <DashboardPage onNavigate={(v) => navigate(v)} />
        ) : view === 'federations' ? (
          <FederationsPage onOpenClubs={(c) => navigate('clubs', { country: c })} />
        ) : view === 'clubs' ? (
          // key by country so navigating to a different country re-inits the filter
          <ClubsPage key={country ?? ''} initialCountry={country} onOpenContacts={(id) => navigate('contacts', { club: id })} />
        ) : view === 'contacts' ? (
          <ContactsPage key={club ?? ''} initialClub={club} />
        ) : view === 'discovery' ? (
          <DiscoveryPage />
        ) : (
          <TournamentsPage onOpenClubs={() => navigate('discovery')} />
        )}
      </main>
    </div>
  )
}

const VIEW_LABELS: Record<View, string> = { dashboard: 'Dashboard', federations: 'Federations', clubs: 'Clubs', contacts: 'Contacts', discovery: 'Discovery', tournaments: 'Tournaments' }

// Nav with a live total chip per view. The hooks live here (not at the top level)
// so they only run once the user is authed and this subtree mounts.
function MainNav({ view, navigate, className = '', vertical = false }: { view: View; navigate: (view: View) => void; className?: string; vertical?: boolean }) {
  const totals: Record<View, number | null> = {
    dashboard: null,
    federations: useCollectionTotal('federations'),
    clubs: useCollectionTotal('clubs'),
    contacts: useCollectionTotal('contacts'),
    discovery: useCollectionTotal('search_keywords'),
    tournaments: useCollectionTotal('tournaments'),
  }
  return (
    <nav className={`${vertical ? 'flex flex-col gap-1' : 'flex gap-1'} ${className}`}>
      {VIEWS.map((v) => (
        <NavButton key={v} active={view === v} count={totals[v]} onClick={() => navigate(v)}>
          {VIEW_LABELS[v]}
        </NavButton>
      ))}
    </nav>
  )
}

function NavButton({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number | null; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium ' +
        (active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')
      }
    >
      {children}
      {count != null && (
        <span
          className={
            'ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ' +
            (active ? 'bg-white/20 text-white' : 'bg-neutral-200 text-neutral-600')
          }
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  )
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
