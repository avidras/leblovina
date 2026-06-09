import { useEffect, useMemo, useState } from 'react'
import { pb, type SearchKeyword, type SearchTarget } from '@/lib/pb'
import { usePagedCollection } from '@/hooks/usePagedCollection'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useUrlState, usePersistentState } from '@/hooks/useUrlState'
import { triggerSearchKeywordsGenerate } from '@/lib/n8n'
import { relTime, exactTime } from '@/lib/time'
import { downloadCsv } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { FilterPanel, ResetFiltersButton } from '@/components/ui/filter-panel'
import { ActionsMenu } from '@/components/ui/menu'
import { useConfirm } from '@/components/ui/confirm'
import { Dialog } from '@/components/ui/dialog'
import { Pagination } from '@/components/ui/pagination'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

// Join non-empty PocketBase filter clauses with &&.
function andFilter(...clauses: (string | false | undefined)[]): string {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(' && ')
}

type SortKey = 'keyword' | 'target' | 'country' | 'status' | 'results_count' | 'accepted_count' | 'new_clubs' | 'dup_count' | 'searched_at' | 'created'

const STATUSES = ['pending', 'searching', 'searched', 'error'] as const
// Targets currently offered for ADDING keywords (tournaments lights up when its processor lands).
const ADD_TARGETS: { value: SearchTarget; label: string; enabled: boolean }[] = [
  { value: 'clubs', label: 'Clubs', enabled: true },
  { value: 'tournaments', label: 'Tournaments', enabled: true },
]
const TARGET_LABEL: Record<string, string> = { clubs: 'Clubs', tournaments: 'Tournaments' }
function statusTone(s: string): 'green' | 'blue' | 'amber' | 'red' | 'neutral' {
  switch (s) {
    case 'searched': return 'green'
    case 'searching': return 'blue'
    case 'pending': return 'neutral'
    case 'error': return 'red'
    default: return 'neutral'
  }
}

function buildFilter(f: { q: string; country: string; status: string; target: string }): string {
  return andFilter(
    f.target && pb.filter('target = {:v}', { v: f.target }),
    f.country && pb.filter('country = {:v}', { v: f.country }),
    f.status && pb.filter('status = {:v}', { v: f.status }),
    f.q && pb.filter('keyword ~ {:q} || country ~ {:q}', { q: f.q }),
  )
}

export function DiscoveryPage() {
  const [q, setQ] = useUrlState('q')
  const [country, setCountry] = useUrlState('country')
  const [status, setStatus] = useUrlState('status')
  const [target, setTarget] = useUrlState('target')
  const [sort, setSort] = usePersistentState<{ key: SortKey; dir: 'asc' | 'desc' }>('discovery:sort', { key: 'created', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)
  const resetPage = () => setPage(1)

  const filtersActive = [q, country, status, target].some(Boolean)
  const resetFilters = () => { setQ(''); setCountry(''); setStatus(''); setTarget(''); resetPage() }

  const debouncedQ = useDebouncedValue(q, 300)
  const filter = useMemo(() => buildFilter({ q: debouncedQ.trim(), country, status, target }), [debouncedQ, country, status, target])
  const sortStr = `${sort.dir === 'asc' ? '+' : '-'}${sort.key}`
  const { items, totalItems, totalPages, loading, error, reload } = usePagedCollection<SearchKeyword>('search_keywords', { page, perPage, sort: sortStr, filter })
  const { confirm, confirmElement } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [pagesDlg, setPagesDlg] = useState(false)
  const [pagesVal, setPagesVal] = useState('3')
  const [pagesRerun, setPagesRerun] = useState(true)

  // Re-search = reset keyword(s) to 'pending' so the drain runs them again (when enabled).
  async function reSearch(ids: string[]) {
    setBusy(true)
    for (let i = 0; i < ids.length; i += 20) {
      await Promise.all(ids.slice(i, i + 20).map((id) =>
        pb.collection('search_keywords').update(id, { status: 'pending', attempts: 0 }).catch(() => {})))
    }
    setBusy(false)
    reload()
  }
  async function reSearchFiltered() {
    const ok = await confirm({
      title: 'Re-search keywords',
      message: `Reset ${totalItems.toLocaleString()} keyword(s) in the current view to “pending”? The discovery queue will run them again (if not paused).`,
      confirmLabel: 'Re-search',
    })
    if (!ok) return
    const list = await pb.collection('search_keywords').getFullList<{ id: string }>({ filter: filter || undefined, fields: 'id', batch: 500 })
    await reSearch(list.map((r) => r.id))
  }

  // Permanently remove the filtered keyword set from the discovery queue (e.g. a misspelled
  // country generated a bad batch). Respects the current filters/search.
  async function deleteFiltered() {
    const ok = await confirm({
      title: 'Delete keywords',
      message: `Permanently delete ${totalItems.toLocaleString()} keyword(s) in the current view? This removes them from the discovery queue and cannot be undone.`,
      confirmLabel: `Delete ${totalItems.toLocaleString()}`,
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const list = await pb.collection('search_keywords').getFullList<{ id: string }>({ filter: filter || undefined, fields: 'id', batch: 500 })
      for (let i = 0; i < list.length; i += 20) {
        await Promise.all(list.slice(i, i + 20).map((r) =>
          pb.collection('search_keywords').delete(r.id).catch(() => {})))
      }
    } catch { /* non-fatal */ }
    setBusy(false)
    resetPage()
    reload()
  }

  // Set the Serper pagination depth (pages) on the filtered set — widens existing keywords
  // (each page ≈ 10 results). Optionally resets them to pending so the queue re-runs them.
  async function applyPages() {
    const n = Math.max(1, Math.min(5, Number(pagesVal) || 1))
    setPagesDlg(false)
    setBusy(true)
    try {
      const list = await pb.collection('search_keywords').getFullList<{ id: string }>({ filter: filter || undefined, fields: 'id', batch: 500 })
      const body: Record<string, unknown> = { pages: n }
      if (pagesRerun) { body.status = 'pending'; body.attempts = 0 }
      for (let i = 0; i < list.length; i += 20) {
        await Promise.all(list.slice(i, i + 20).map((r) =>
          pb.collection('search_keywords').update(r.id, body).catch(() => {})))
      }
    } catch { /* non-fatal */ }
    setBusy(false)
    reload()
  }

  // distinct countries present in the keyword registry (for the country filter)
  const [countryOpts, setCountryOpts] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    pb.collection('search_keywords').getFullList<{ country: string }>({ fields: 'country', batch: 500 })
      .then((l) => { if (alive) setCountryOpts(Array.from(new Set(l.map((r) => r.country).filter(Boolean))).sort((a, b) => a.localeCompare(b))) })
      .catch(() => { /* non-fatal */ })
    return () => { alive = false }
  }, [items.length])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    resetPage()
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  async function exportCsv() {
    const list = await pb.collection('search_keywords').getFullList<SearchKeyword>({ filter: filter || undefined, sort: sortStr, batch: 500 })
    const cols = ['Keyword', 'Target', 'Country', 'Lang', 'Status', 'Results', 'Accepted', 'New clubs', 'Dups', 'Searched at', 'Created']
    const rows = list.map((r) => ({
      Keyword: r.keyword, Target: r.target, Country: r.country, Lang: r.lang, Status: r.status,
      Results: r.results_count, Accepted: r.accepted_count, 'New clubs': r.new_clubs, Dups: r.dup_count,
      'Searched at': r.searched_at, Created: r.created,
    }))
    downloadCsv(`search_keywords-${new Date().toISOString().slice(0, 10)}.csv`, rows, cols)
  }

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load keywords: {error}</div>

  return (
    <div className="space-y-4">
      <AddKeywords onAdded={() => { resetPage(); reload() }} />
      <DrainPanel />

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search keyword / country…" value={q} onChange={(e) => { setQ(e.target.value); resetPage() }} />
        <FilterPanel activeCount={[country, status, target].filter(Boolean).length}>
          <Select className="w-full" active={!!target} value={target} onChange={(e) => { setTarget(e.target.value); resetPage() }} title="Filter by target">
            <option value="">Any target</option>
            <option value="clubs">Clubs</option>
            <option value="tournaments">Tournaments</option>
          </Select>
          <Select className="w-full" active={!!country} value={country} onChange={(e) => { setCountry(e.target.value); resetPage() }} title="Filter by country">
            <option value="">Any country</option>
            {countryOpts.map((c) => (<option key={c} value={c}>{c}</option>))}
          </Select>
          <Select className="w-full" active={!!status} value={status} onChange={(e) => { setStatus(e.target.value); resetPage() }} title="Filter by status">
            <option value="">Any status</option>
            {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </Select>
        </FilterPanel>
        <ResetFiltersButton active={filtersActive} onReset={resetFilters} />
        <span className="ml-auto text-sm text-neutral-500">{totalItems.toLocaleString()} keywords{loading ? ' · loading…' : ''}</span>
        <ActionsMenu
          busy={busy}
          actions={[
            { key: 'research', label: 'Re-search filtered', count: totalItems, description: 'Reset the current view to pending so the queue runs them again', onSelect: reSearchFiltered },
            { key: 'pages', label: 'Set pages (widen)', count: totalItems, description: 'Set Serper pagination depth (1–5) for these keywords; ~10 results per page', disabled: totalItems === 0, onSelect: () => setPagesDlg(true) },
            { key: 'export', label: 'Export CSV (filtered)', onSelect: exportCsv },
            { key: 'delete', label: 'Delete filtered', count: totalItems, danger: true, description: 'Permanently remove these keywords from the discovery queue', disabled: totalItems === 0, onSelect: deleteFiltered },
          ]}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH sortable sorted={sortedOf('keyword')} onClick={() => toggleSort('keyword')} className="w-[320px] min-w-[280px]">Keyword</TH>
            <TH sortable sorted={sortedOf('target')} onClick={() => toggleSort('target')}>Target</TH>
            <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
            <TH sortable sorted={sortedOf('status')} onClick={() => toggleSort('status')}>Status</TH>
            <TH sortable sorted={sortedOf('results_count')} onClick={() => toggleSort('results_count')} className="text-right">Results</TH>
            <TH sortable sorted={sortedOf('accepted_count')} onClick={() => toggleSort('accepted_count')} className="text-right">Accepted</TH>
            <TH sortable sorted={sortedOf('new_clubs')} onClick={() => toggleSort('new_clubs')} className="text-right">New clubs</TH>
            <TH sortable sorted={sortedOf('dup_count')} onClick={() => toggleSort('dup_count')} className="text-right">Dups</TH>
            <TH sortable sorted={sortedOf('searched_at')} onClick={() => toggleSort('searched_at')}>Searched</TH>
            <TH className="w-10" />
          </TR>
        </THead>
        <TBody>
          {items.map((k) => (
            <TR key={k.id}>
              <TD className="font-medium text-neutral-800">{k.keyword}<span className="ml-1.5 text-xs text-neutral-400">{k.lang}</span></TD>
              <TD><Badge tone={k.target === 'tournaments' ? 'amber' : 'neutral'}>{TARGET_LABEL[k.target] ?? k.target ?? 'clubs'}</Badge></TD>
              <TD>{k.country || '—'}</TD>
              <TD><Badge tone={statusTone(k.status)}>{k.status || '—'}</Badge></TD>
              <TD className="text-right tabular-nums text-neutral-500">{k.status === 'searched' ? k.results_count : '—'}</TD>
              <TD className="text-right tabular-nums text-neutral-500">{k.status === 'searched' ? k.accepted_count : '—'}</TD>
              <TD className="text-right tabular-nums font-medium text-neutral-800">{k.status === 'searched' ? k.new_clubs : '—'}</TD>
              <TD className="text-right tabular-nums text-neutral-400">{k.status === 'searched' ? k.dup_count : '—'}</TD>
              <TD className="whitespace-nowrap text-xs text-neutral-500" title={k.searched_at ? exactTime(k.searched_at) : ''}>{relTime(k.searched_at)}</TD>
              <TD className="text-right">
                <button
                  type="button"
                  disabled={busy || k.status === 'pending' || k.status === 'searching'}
                  onClick={() => reSearch([k.id])}
                  title="Re-search this keyword"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-400"
                >
                  <ReSearchIcon />
                </button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Pagination page={page} perPage={perPage} totalItems={totalItems} totalPages={totalPages}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); resetPage() }} />
      {confirmElement}

      <Dialog
        open={pagesDlg}
        onClose={() => setPagesDlg(false)}
        title="Set pages (pagination depth)"
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setPagesDlg(false)}>Cancel</Button>
            <Button size="sm" onClick={applyPages}>Apply to {totalItems.toLocaleString()}</Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-neutral-600">
            Serper returns ~10 results per page. Set how many pages each of the{' '}
            <span className="font-medium">{totalItems.toLocaleString()}</span> filtered keyword(s) fetches
            (3 ≈ ~30 deduped results). More pages = more Serper calls.
          </p>
          <label className="flex items-center gap-2">Pages
            <Input className="w-20" type="number" min={1} max={5} value={pagesVal} onChange={(e) => setPagesVal(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={pagesRerun} onChange={(e) => setPagesRerun(e.target.checked)} />
            Re-search now (reset to pending so the queue re-runs them)
          </label>
        </div>
      </Dialog>
    </div>
  )
}

function ReSearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

type Candidate = { keyword: string; lang: string }

// Add keywords to the discovery queue. Two modes: add a single keyword, or generate localized
// candidates for a target/country and pick which to queue (nothing is saved until you confirm).
// Each keyword carries a `target` = which collection it fills. See specs/search-led-discovery.md.
function AddKeywords({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<'generate' | 'one'>('generate')
  const [target, setTarget] = useState<SearchTarget>('clubs')
  const [country, setCountry] = useState('')
  const [keyword, setKeyword] = useState('')
  const [count, setCount] = useState('40')
  const [breadth, setBreadth] = useState<'specific' | 'broad'>('specific')
  const [focus, setFocus] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())

  // Broad keywords are paginated deeper (Serper caps a single request at 10).
  const candidatePages = breadth === 'broad' ? 3 : 1

  // Generate needs an input: clubs → a country; tournaments → a location (country/city) OR a
  // specific tournament name. (A single manually-added keyword is already a complete query.)
  const generateNeedsCountry = true
  const isTournaments = target === 'tournaments'
  const inputLabel = isTournaments ? 'Location or tournament name' : 'Country'
  const inputPlaceholder = isTournaments ? 'e.g. Germany, Berlin, or “CEV Champions League”' : 'e.g. Italy'

  async function createRow(kw: string, lang: string, ctry: string, pages = 1): Promise<'added' | 'dup' | 'error'> {
    try {
      await pb.collection('search_keywords').create({ keyword: kw, target, country: ctry, lang, pages, status: 'pending', attempts: 0 })
      return 'added'
    } catch (e) {
      return (e as { status?: number })?.status === 400 ? 'dup' : 'error'
    }
  }

  async function addOne() {
    const kw = keyword.trim()
    if (!kw) { setMsg('Enter a keyword.'); return }
    setBusy(true); setMsg(null)
    const r = await createRow(kw, '', '') // single keyword = a complete query; no country
    setBusy(false)
    if (r === 'added') { setMsg(`Added “${kw}”.`); setKeyword(''); onAdded() }
    else if (r === 'dup') setMsg(`“${kw}” is already in the queue.`)
    else setMsg('Failed to add keyword.')
  }

  async function generate() {
    if (!country.trim()) { setMsg(`Enter a ${isTournaments ? 'location or tournament name' : 'country'} first.`); return }
    setBusy(true); setMsg(null); setCandidates(null)
    const r = await triggerSearchKeywordsGenerate({ target, country: country.trim(), count: Number(count) || 40, breadth, focus: focus.trim() })
    setBusy(false)
    const body = r.body as { candidates?: Candidate[] } | undefined
    if (r.ok && body?.candidates?.length) {
      setCandidates(body.candidates)
      setPicked(new Set(body.candidates.map((_, i) => i))) // all pre-checked
    } else {
      setMsg(`Failed: ${r.error || (body?.candidates ? 'no candidates returned' : `HTTP ${r.status}`)}`)
    }
  }

  function toggle(i: number) {
    setPicked((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n })
  }

  async function addSelected() {
    if (!candidates) return
    const chosen = candidates.filter((_, i) => picked.has(i))
    if (!chosen.length) { setMsg('Select at least one keyword.'); return }
    setBusy(true); setMsg(null)
    let added = 0, dup = 0
    for (const c of chosen) { const r = await createRow(c.keyword, c.lang || '', country.trim(), candidatePages); if (r === 'added') added++; else if (r === 'dup') dup++ }
    setBusy(false); setCandidates(null); setPicked(new Set())
    setMsg(`Added ${added} keyword(s)${dup ? `, ${dup} already queued` : ''}.`)
    onAdded()
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium text-neutral-800">Add keywords</span>
        <div className="ml-2 inline-flex rounded-md border border-neutral-200 p-0.5 text-xs">
          {(['generate', 'one'] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setMsg(null); setCandidates(null) }}
              className={`rounded px-2 py-1 ${mode === m ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
              {m === 'generate' ? 'Generate' : 'Add one'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Target
          <Select value={target} onChange={(e) => { setTarget(e.target.value as SearchTarget); setCandidates(null) }}>
            {ADD_TARGETS.map((t) => (<option key={t.value} value={t.value} disabled={!t.enabled}>{t.label}</option>))}
          </Select>
        </label>
        {mode === 'one' ? (
          <>
            <label className="flex flex-1 flex-col gap-1 text-xs text-neutral-500">Keyword
              <Input className="min-w-[18rem]" placeholder="exact search query (a complete query)" value={keyword}
                onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addOne() }} />
            </label>
            <Button size="sm" disabled={busy} onClick={addOne}>{busy ? 'Adding…' : 'Add to queue'}</Button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">{inputLabel}
              <Input className={isTournaments ? 'w-72' : 'w-44'} placeholder={inputPlaceholder} value={country}
                onChange={(e) => setCountry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') generate() }} />
            </label>{/* tournaments: location (country/city) OR a specific tournament name */}
            {target === 'clubs' && (
              <label className="flex flex-col gap-1 text-xs text-neutral-500">Breadth
                <div className="inline-flex rounded-md border border-neutral-200 p-0.5">
                  {(['specific', 'broad'] as const).map((b) => (
                    <button key={b} type="button" onClick={() => { setBreadth(b); setCandidates(null) }}
                      className={`rounded px-2 py-1 text-xs ${breadth === b ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'}`}>
                      {b === 'specific' ? 'Per-city' : 'Broad'}
                    </button>
                  ))}
                </div>
              </label>
            )}
            {target === 'clubs' && breadth === 'broad' && (
              <label className="flex flex-col gap-1 text-xs text-neutral-500">Focus <span className="text-neutral-400">(optional)</span>
                <Input className="w-44" placeholder="e.g. youth clubs, beach" value={focus}
                  onChange={(e) => setFocus(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') generate() }} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-neutral-500">Count
              <Input className="w-20" type="number" min={5} max={120} value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
            <Button size="sm" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate'}</Button>
          </>
        )}
        {msg && <span className="text-sm text-neutral-500">{msg}</span>}
      </div>

      {candidates && (
        <div className="mt-3 rounded-md border border-neutral-200">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs">
            <span className="text-neutral-500">{picked.size} of {candidates.length} selected</span>
            <div className="flex gap-2">
              <button className="text-blue-600 hover:underline" onClick={() => setPicked(new Set(candidates.map((_, i) => i)))}>Select all</button>
              <button className="text-neutral-500 hover:underline" onClick={() => setPicked(new Set())}>None</button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {candidates.map((c, i) => (
              <label key={i} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                <span className="text-neutral-800">{c.keyword}</span>
                <span className="text-xs text-neutral-400">{c.lang}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-neutral-200 px-3 py-2">
            <Button size="sm" disabled={busy || picked.size === 0} onClick={addSelected}>{busy ? 'Adding…' : `Add ${picked.size} to queue`}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCandidates(null); setPicked(new Set()) }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Live status + Pause/Resume for the search-discover drain cron (settings.search_discover).
function DrainPanel() {
  const [counts, setCounts] = useState({ pending: 0, searching: 0, searched: 0, error: 0 })
  const [totals, setTotals] = useState({ newClubs: 0, dups: 0 })
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [settingId, setSettingId] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      const res = await Promise.all(STATUSES.map((s) =>
        pb.collection('search_keywords').getList(1, 1, { filter: pb.filter('status = {:s}', { s }), fields: 'id' })))
      setCounts({ pending: res[0].totalItems, searching: res[1].totalItems, searched: res[2].totalItems, error: res[3].totalItems })
    } catch { /* non-fatal */ }
    try {
      const done = await pb.collection('search_keywords').getFullList<{ new_clubs: number; dup_count: number }>({
        filter: "status='searched'", fields: 'new_clubs,dup_count', batch: 500,
      })
      setTotals({ newClubs: done.reduce((a, r) => a + (r.new_clubs || 0), 0), dups: done.reduce((a, r) => a + (r.dup_count || 0), 0) })
    } catch { /* non-fatal */ }
    try {
      const rec = await pb.collection('settings').getFirstListItem(pb.filter('key = {:k}', { k: 'search_discover' }))
      setSettingId(rec.id)
      setEnabled(!!(rec.value as { enabled?: boolean })?.enabled)
    } catch { /* non-fatal */ }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t) }, [])

  async function togglePause() {
    if (!settingId || enabled === null) return
    setBusy(true)
    try {
      const rec = await pb.collection('settings').getOne(settingId)
      await pb.collection('settings').update(settingId, { value: { ...(rec.value as object), enabled: !enabled } })
      setEnabled(!enabled)
    } catch { /* non-fatal */ }
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
      <span className="font-medium text-neutral-700">Discovery queue</span>
      <span className="tabular-nums text-neutral-500">
        {counts.pending} pending · {counts.searching} running · {counts.searched} searched{counts.error ? ` · ${counts.error} error` : ''}
      </span>
      <span className="tabular-nums text-neutral-500">· {totals.newClubs.toLocaleString()} new clubs · {totals.dups.toLocaleString()} dups</span>
      {enabled === false && <Badge tone="amber">Paused</Badge>}
      {enabled === true && counts.pending + counts.searching > 0 && <Badge tone="blue">Running</Badge>}
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || enabled === null} onClick={togglePause}>
          {enabled ? 'Pause' : 'Resume'}
        </Button>
      </div>
    </div>
  )
}
