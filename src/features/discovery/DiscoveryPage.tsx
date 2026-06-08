import { useEffect, useMemo, useState } from 'react'
import { pb, type SearchKeyword } from '@/lib/pb'
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
import { Pagination } from '@/components/ui/pagination'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

// Join non-empty PocketBase filter clauses with &&.
function andFilter(...clauses: (string | false | undefined)[]): string {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(' && ')
}

type SortKey = 'keyword' | 'country' | 'status' | 'results_count' | 'accepted_count' | 'new_clubs' | 'dup_count' | 'searched_at' | 'created'

const STATUSES = ['pending', 'searching', 'searched', 'error'] as const
function statusTone(s: string): 'green' | 'blue' | 'amber' | 'red' | 'neutral' {
  switch (s) {
    case 'searched': return 'green'
    case 'searching': return 'blue'
    case 'pending': return 'neutral'
    case 'error': return 'red'
    default: return 'neutral'
  }
}

function buildFilter(f: { q: string; country: string; status: string }): string {
  return andFilter(
    f.country && pb.filter('country = {:v}', { v: f.country }),
    f.status && pb.filter('status = {:v}', { v: f.status }),
    f.q && pb.filter('keyword ~ {:q}', { q: f.q }),
  )
}

export function DiscoveryPage() {
  const [q, setQ] = useUrlState('q')
  const [country, setCountry] = useUrlState('country')
  const [status, setStatus] = useUrlState('status')
  const [sort, setSort] = usePersistentState<{ key: SortKey; dir: 'asc' | 'desc' }>('discovery:sort', { key: 'created', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)
  const resetPage = () => setPage(1)

  const filtersActive = [q, country, status].some(Boolean)
  const resetFilters = () => { setQ(''); setCountry(''); setStatus(''); resetPage() }

  const debouncedQ = useDebouncedValue(q, 300)
  const filter = useMemo(() => buildFilter({ q: debouncedQ.trim(), country, status }), [debouncedQ, country, status])
  const sortStr = `${sort.dir === 'asc' ? '+' : '-'}${sort.key}`
  const { items, totalItems, totalPages, loading, error, reload } = usePagedCollection<SearchKeyword>('search_keywords', { page, perPage, sort: sortStr, filter })
  const { confirm, confirmElement } = useConfirm()
  const [busy, setBusy] = useState(false)

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
    const cols = ['Keyword', 'Country', 'Lang', 'Status', 'Results', 'Accepted', 'New clubs', 'Dups', 'Searched at', 'Created']
    const rows = list.map((r) => ({
      Keyword: r.keyword, Country: r.country, Lang: r.lang, Status: r.status,
      Results: r.results_count, Accepted: r.accepted_count, 'New clubs': r.new_clubs, Dups: r.dup_count,
      'Searched at': r.searched_at, Created: r.created,
    }))
    downloadCsv(`search_keywords-${new Date().toISOString().slice(0, 10)}.csv`, rows, cols)
  }

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load keywords: {error}</div>

  return (
    <div className="space-y-4">
      <GenerateBar onGenerated={() => { resetPage(); setTimeout(() => setPage(1), 200) }} />
      <DrainPanel />

      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search keyword…" value={q} onChange={(e) => { setQ(e.target.value); resetPage() }} />
        <FilterPanel activeCount={[country, status].filter(Boolean).length}>
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
            { key: 'export', label: 'Export CSV (filtered)', onSelect: exportCsv },
            { key: 'delete', label: 'Delete filtered', count: totalItems, danger: true, description: 'Permanently remove these keywords from the discovery queue', disabled: totalItems === 0, onSelect: deleteFiltered },
          ]}
        />
      </div>

      <Table>
        <THead>
          <TR>
            <TH sortable sorted={sortedOf('keyword')} onClick={() => toggleSort('keyword')} className="w-[320px] min-w-[280px]">Keyword</TH>
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

// Generate localized search keywords for a country into the registry (status='pending').
function GenerateBar({ onGenerated }: { onGenerated: () => void }) {
  const [country, setCountry] = useState('')
  const [count, setCount] = useState('40')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function generate() {
    const c = country.trim()
    if (!c) { setMsg('Enter a country first.'); return }
    setBusy(true); setMsg(null)
    const r = await triggerSearchKeywordsGenerate({ country: c, count: Number(count) || 40 })
    setBusy(false)
    const body = r.body as { generated?: number; created?: number; duplicates?: number } | undefined
    if (r.ok && body) {
      setMsg(`Generated ${body.generated ?? 0} keywords for ${c} (${body.created ?? 0} new, ${body.duplicates ?? 0} already existed).`)
      onGenerated()
    } else {
      setMsg(`Failed: ${r.error || `HTTP ${r.status}`}`)
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 text-sm font-medium text-neutral-800">Generate keywords</div>
      <div className="flex flex-wrap items-end gap-2">
        <Input className="max-w-xs" placeholder="Country (e.g. Italy)" value={country}
          onChange={(e) => setCountry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') generate() }} />
        <Input className="w-24" type="number" min={5} max={120} value={count} onChange={(e) => setCount(e.target.value)} title="How many keywords" />
        <Button size="sm" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate'}</Button>
        {msg && <span className="text-sm text-neutral-500">{msg}</span>}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Localized volleyball-club search queries are generated for the country and queued. The drain (below) then runs them —
        Serper search → strict AI club classifier → URL-dedup → new clubs under “No federation – Google” + contact scraping.
      </p>
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
