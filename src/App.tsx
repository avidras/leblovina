import { useCallback, useEffect, useState } from 'react'
import { pb, GATE_MODES, type GateMode } from '@/lib/pb'
import { getGateMode, setGateMode } from '@/lib/settings'
import { Login } from '@/components/Login'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { FederationsPage } from '@/features/federations/FederationsPage'
import { ClubsPage } from '@/features/clubs/ClubsPage'

const VIEWS = ['federations', 'clubs'] as const
type View = (typeof VIEWS)[number]

// The current view lives in the URL path (`/federations`, `/clubs`) so it
// survives a page refresh. PocketBase serves the SPA with index.html fallback,
// so deep links resolve in prod the same as Vite's dev server does.
function pathToView(path: string): View {
  const seg = path.replace(/^\/+/, '').split('/')[0]
  return (VIEWS as readonly string[]).includes(seg) ? (seg as View) : 'federations'
}

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => pathToView(window.location.pathname))
  useEffect(() => {
    const onPop = () => setView(pathToView(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((v: View) => {
    if (v !== pathToView(window.location.pathname)) window.history.pushState(null, '', '/' + v)
    setView(v)
  }, [])
  return [view, navigate]
}

export default function App() {
  const [authed, setAuthed] = useState(pb.authStore.isValid)
  const [view, navigate] = useView()

  useEffect(() => pb.authStore.onChange(() => setAuthed(pb.authStore.isValid)), [])

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <span className="font-semibold">Leblovina</span>
          <nav className="flex gap-1">
            <NavButton active={view === 'federations'} onClick={() => navigate('federations')}>Federations</NavButton>
            <NavButton active={view === 'clubs'} onClick={() => navigate('clubs')}>Clubs</NavButton>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <GateSelector />
            <span className="text-xs text-neutral-500">{pb.authStore.record?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => pb.authStore.clear()}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {view === 'federations' ? <FederationsPage /> : <ClubsPage />}
      </main>
    </div>
  )
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-md px-3 py-1.5 text-sm font-medium ' +
        (active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')
      }
    >
      {children}
    </button>
  )
}

function GateSelector() {
  const [mode, setMode] = useState<GateMode | ''>('')
  useEffect(() => {
    getGateMode().then(setMode)
  }, [])
  async function change(next: GateMode) {
    setMode(next)
    await setGateMode(next)
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      Gate
      <Select value={mode} onChange={(e) => change(e.target.value as GateMode)} className="h-8 text-xs" disabled={mode === ''}>
        {GATE_MODES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </Select>
    </label>
  )
}
