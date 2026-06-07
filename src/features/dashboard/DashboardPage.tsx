import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'
import { useCountries } from '@/hooks/useCountries'

type NavView = 'federations' | 'clubs' | 'contacts'

interface Stats {
  feds: number; fedsScraped: number
  clubs: number; clubsSite: number; clubsScraped: number
  contacts: number; contactsClubSite: number; contactsDir: number
  queueQueued: number; queueDone: number
}

function useStats(): Stats | null {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => {
    let alive = true
    const n = async (coll: string, filter: string) =>
      (await pb.collection(coll).getList(1, 1, { filter: filter || undefined, fields: 'id' })).totalItems
    ;(async () => {
      try {
        const [feds, fedsScraped, clubs, clubsSite, clubsScraped, contacts, contactsClubSite, contactsDir, queueQueued, queueDone] = await Promise.all([
          n('federations', ''), n('federations', "status='scraped'"),
          n('clubs', ''), n('clubs', "website_url!=''"), n('clubs', "scrape_note~'site-scrape'"),
          n('contacts', ''), n('contacts', "source_type='club_site'"), n('contacts', "source_type='directory'"),
          n('scrape_queue', "status='queued'"), n('scrape_queue', "status='done'"),
        ])
        if (alive) setS({ feds, fedsScraped, clubs, clubsSite, clubsScraped, contacts, contactsClubSite, contactsDir, queueQueued, queueDone })
      } catch { /* non-fatal */ }
    })()
    return () => { alive = false }
  }, [])
  return s
}

const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString())

export function DashboardPage({ onNavigate }: { onNavigate: (v: NavView) => void }) {
  const s = useStats()
  const countries = useCountries()

  const cards: { label: string; value: number | undefined; sub: string; to: NavView }[] = [
    { label: 'Federations', value: s?.feds, sub: `${fmt(s?.fedsScraped)} with clubs found`, to: 'federations' },
    { label: 'Clubs', value: s?.clubs, sub: `${fmt(s?.clubsSite)} with a website`, to: 'clubs' },
    { label: 'Contacts', value: s?.contacts, sub: `${fmt(s?.contactsClubSite)} from club sites · ${fmt(s?.contactsDir)} from directories`, to: 'contacts' },
    { label: 'Countries covered', value: countries.length || undefined, sub: 'with at least one club', to: 'clubs' },
    { label: 'Clubs with a website', value: s?.clubsSite, sub: `of ${fmt(s?.clubs)} clubs`, to: 'clubs' },
    { label: 'Clubs scraped for contacts', value: s?.clubsScraped, sub: 'crawled for emails', to: 'clubs' },
  ]

  const queueActive = s && (s.queueQueued > 0)

  return (
    <div className="space-y-8">
      <section>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <button
              key={c.label}
              onClick={() => onNavigate(c.to)}
              className="group rounded-xl border border-neutral-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 hover:shadow"
            >
              <div className="text-sm font-medium text-neutral-500">{c.label}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">{fmt(c.value)}</div>
              <div className="mt-1 text-xs text-neutral-500">{c.sub}</div>
              <div className="mt-2 text-xs font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">View →</div>
            </button>
          ))}
        </div>
        {queueActive && (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
            <span className="font-medium text-neutral-700">Contact scraping in progress</span>
            {' — '}{fmt(s?.queueDone)} done · {fmt(s?.queueQueued)} queued (runs automatically in the background)
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">How it works</h2>
        <p className="mb-4 text-sm text-neutral-500">How the platform finds volleyball clubs and their contacts, end to end.</p>
        <ol className="space-y-3">
          {STEPS.map((st, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{i + 1}</div>
              <div>
                <div className="font-medium text-neutral-900">{st.title}</div>
                <div className="mt-0.5 text-sm text-neutral-600">{st.body}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          <span className="font-medium text-neutral-600">Behind the scenes:</span> the platform combines automated web
          search, a page-rendering engine that reads modern JavaScript-heavy sites, and AI models that understand and
          classify each page — all run automatically on a schedule, so the data keeps growing without manual work.
        </p>
      </section>
    </div>
  )
}

const STEPS: { title: string; body: string }[] = [
  { title: "Start from the world's federations", body: 'We load every national volleyball federation from the sport’s official global directory — the master list we work down from.' },
  { title: "Find each federation's club list", body: 'For every federation we locate its official directory of member clubs online, wherever it lives.' },
  { title: 'Extract the clubs', body: 'We read those directories — web pages, PDFs, or the platforms federations run on — and pull out every club with its town/region and any email or website listed.' },
  { title: 'Find the missing websites', body: 'For clubs with no website listed, we search the web and verify which result is genuinely that club’s own site (not a directory, news page or aggregator).' },
  { title: 'Gather the contacts', body: 'We visit each club’s own website and collect contact emails — plus names and roles where shown — while filtering out website-builder and agency noise.' },
  { title: 'Make names readable', body: 'Clubs written in other alphabets (Cyrillic, Greek, and more) get a clear English/Latin version alongside the original.' },
  { title: 'Organise & export', body: 'Everything is searchable, filterable by country and status, and exportable to CSV for outreach.' },
]
