import { useMemo, useState } from 'react'
import { pb, sanitizeSearch, type Tournament } from '@/lib/pb'
import { usePagedCollection } from '@/hooks/usePagedCollection'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useUrlState, usePersistentState } from '@/hooks/useUrlState'
import { relTime, exactTime } from '@/lib/time'
import { downloadCsv } from '@/lib/csv'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { FilterPanel, ResetFiltersButton } from '@/components/ui/filter-panel'
import { ActionsMenu } from '@/components/ui/menu'
import { Pagination } from '@/components/ui/pagination'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type SortKey = 'name' | 'country' | 'status' | 'clubs_found' | 'participants_count' | 'platform' | 'last_run' | 'created'
const SORT_KEYS: SortKey[] = ['name', 'country', 'status', 'clubs_found', 'participants_count', 'platform', 'last_run', 'created']
const isValidSort = (v: { key: string; dir: string }) => !!v && SORT_KEYS.includes(v.key as SortKey) && (v.dir === 'asc' || v.dir === 'desc')

const STATUSES = ['pending', 'searching', 'found', 'extracted', 'no_participants', 'error', 'needs_review'] as const
function statusTone(s: string): 'green' | 'blue' | 'amber' | 'red' | 'neutral' {
  switch (s) {
    case 'extracted': return 'green'
    case 'found': case 'searching': return 'blue'
    case 'no_participants': case 'needs_review': return 'amber'
    case 'error': return 'red'
    default: return 'neutral'
  }
}

const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '')

export function TournamentsPage({ onOpenClubs }: { onOpenClubs?: () => void } = {}) {
  const [q, setQ] = useUrlState('q')
  const [status, setStatus] = useUrlState('status')
  const [sort, setSort] = usePersistentState<{ key: SortKey; dir: 'asc' | 'desc' }>('tournaments:sort', { key: 'created', dir: 'desc' }, isValidSort)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)
  const resetPage = () => setPage(1)

  const filtersActive = [q, status].some(Boolean)
  const resetFilters = () => { setQ(''); setStatus(''); resetPage() }

  const debouncedQ = useDebouncedValue(q, 300)
  const filter = useMemo(() => {
    const parts: string[] = []
    if (status) parts.push(pb.filter('status = {:v}', { v: status }))
    if (sanitizeSearch(debouncedQ)) parts.push(pb.filter('name ~ {:q} || keyword ~ {:q}', { q: sanitizeSearch(debouncedQ) }))
    return parts.map((p) => `(${p})`).join(' && ')
  }, [status, debouncedQ])
  const sortStr = `${sort.dir === 'asc' ? '+' : '-'}${sort.key}`
  const { items, totalItems, totalPages, loading, error } = usePagedCollection<Tournament>('tournaments', { page, perPage, sort: sortStr, filter })

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    resetPage()
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  async function exportCsv() {
    const list = await pb.collection('tournaments').getFullList<Tournament>({ filter: filter || undefined, sort: sortStr, batch: 500 })
    const cols = ['Name', 'Keyword', 'Country', 'Status', 'Clubs found', 'Participants', 'Platform', 'Website', 'Participants URL', 'Last run']
    const rows = list.map((t) => ({
      Name: t.name, Keyword: t.keyword, Country: t.country, Status: t.status, 'Clubs found': t.clubs_found,
      Participants: t.participants_count, Platform: t.platform, Website: t.website_url, 'Participants URL': t.participants_url, 'Last run': t.last_run,
    }))
    downloadCsv(`tournaments-${new Date().toISOString().slice(0, 10)}.csv`, rows, cols)
  }

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load tournaments: {error}</div>

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-500">
        Tournaments discovered via the <button className="text-blue-600 hover:underline" onClick={onOpenClubs}>Discovery</button> queue
        (add keywords with target <span className="font-medium">Tournaments</span>). Each found event's participating clubs are
        extracted, resolved and queued for contact scraping.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search name / keyword…" value={q} onChange={(e) => { setQ(e.target.value); resetPage() }} />
        <FilterPanel activeCount={[status].filter(Boolean).length}>
          <Select className="w-full" active={!!status} value={status} onChange={(e) => { setStatus(e.target.value); resetPage() }} title="Filter by status">
            <option value="">Any status</option>
            {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </Select>
        </FilterPanel>
        <ResetFiltersButton active={filtersActive} onReset={resetFilters} />
        <span className="ml-auto text-sm text-neutral-500">{totalItems.toLocaleString()} tournaments{loading ? ' · loading…' : ''}</span>
        <ActionsMenu actions={[{ key: 'export', label: 'Export CSV (filtered)', onSelect: exportCsv }]} />
      </div>

      <Table>
        <THead>
          <TR>
            <TH sortable sorted={sortedOf('name')} onClick={() => toggleSort('name')} className="w-[320px] min-w-[260px]">Tournament</TH>
            <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
            <TH sortable sorted={sortedOf('status')} onClick={() => toggleSort('status')}>Status</TH>
            <TH sortable sorted={sortedOf('participants_count')} onClick={() => toggleSort('participants_count')} className="text-right" title="Clubs/teams listed by this tournament across all pages (top number). Below: 'new' = created on the last run; 'dup' = already existed and were deduplicated (merged into existing/federation-route clubs).">Clubs</TH>
            <TH sortable sorted={sortedOf('platform')} onClick={() => toggleSort('platform')}>Platform</TH>
            <TH>Pages</TH>
            <TH sortable sorted={sortedOf('last_run')} onClick={() => toggleSort('last_run')}>Last run</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((t) => (
            <TR key={t.id}>
              <TD className="font-medium text-neutral-800">
                {t.name || '—'}
                {t.keyword && t.keyword !== t.name && <div className="text-xs text-neutral-400">{t.keyword}</div>}
              </TD>
              <TD>{t.country || '—'}</TD>
              <TD><Badge tone={statusTone(t.status)}>{t.status || '—'}</Badge></TD>
              <TD className="text-right tabular-nums font-medium text-neutral-800">
                {t.participants_count || 0}
                {(t.participants_count || 0) > 0 && (
                  <div className="text-xs font-normal text-neutral-400">
                    {t.clubs_found || 0} new · {Math.max(0, (t.participants_count || 0) - (t.clubs_found || 0))} dup
                  </div>
                )}
              </TD>
              <TD className="text-xs text-neutral-500">{t.platform || '—'}</TD>
              <TD className="max-w-[220px] truncate text-xs">
                {t.participants_url ? (
                  <a className="text-blue-600 hover:underline" href={t.participants_url} target="_blank" rel="noreferrer" title={t.participants_url}>participants</a>
                ) : t.website_url ? (
                  <a className="text-blue-600 hover:underline" href={t.website_url} target="_blank" rel="noreferrer" title={t.website_url}>{host(t.website_url)}</a>
                ) : <span className="text-neutral-400">—</span>}
              </TD>
              <TD className="whitespace-nowrap text-xs text-neutral-500" title={t.last_run ? exactTime(t.last_run) : ''}>{relTime(t.last_run)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Pagination page={page} perPage={perPage} totalItems={totalItems} totalPages={totalPages}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); resetPage() }} />
    </div>
  )
}
