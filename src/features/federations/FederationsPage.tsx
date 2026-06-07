import { useMemo, useState } from 'react'
import { pb, CONFEDERATIONS, FEDERATION_STATUSES, type Federation } from '@/lib/pb'
import { usePagedCollection } from '@/hooks/usePagedCollection'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useUrlState } from '@/hooks/useUrlState'
import { useClubCountsByFederation } from '@/hooks/useClubCounts'
import { triggerDiscoverClubs, triggerBatchProcess, triggerExtractFederation, type TriggerResult } from '@/lib/n8n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, statusTone } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { useConfirm } from '@/components/ui/confirm'
import { CountryLabel } from '@/components/ui/country'
import { Pagination } from '@/components/ui/pagination'
import { withFlag } from '@/lib/countries'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

// `clubs` is no longer sortable server-side (it's an aggregate, not a column);
// `status` sorts alphabetically (PocketBase can only ORDER BY real columns).
type SortKey = 'fivb_code' | 'name' | 'country' | 'confederation' | 'status' | 'last_scraped'

function andFilter(...clauses: (string | false | undefined)[]): string {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(' && ')
}

function buildFederationsFilter(f: { conf: string; status: string; q: string }): string {
  return andFilter(
    f.conf && pb.filter('confederation = {:v}', { v: f.conf }),
    f.status && pb.filter('status = {:v}', { v: f.status }),
    f.q && pb.filter('name ~ {:q} || country ~ {:q} || fivb_code ~ {:q}', { q: f.q }),
  )
}

export function FederationsPage({ onOpenClubs }: { onOpenClubs: (country: string) => void }) {
  const [conf, setConf] = useUrlState('conf')
  const [status, setStatus] = useUrlState('status')
  const [q, setQ] = useUrlState('q')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'status', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; r: TriggerResult } | null>(null)
  const [batchMsg, setBatchMsg] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const { confirm, confirmElement } = useConfirm()
  const resetPage = () => setPage(1)

  const debouncedQ = useDebouncedValue(q, 300)
  const filter = useMemo(
    () => buildFederationsFilter({ conf, status, q: debouncedQ.trim() }),
    [conf, status, debouncedQ],
  )
  const sortStr = `${sort.dir === 'asc' ? '+' : '-'}${sort.key}`
  const { items, totalItems, totalPages, loading, error } = usePagedCollection<Federation>('federations', {
    page, perPage, sort: sortStr, filter,
  })

  const fedIds = useMemo(() => items.map((f) => f.id), [items])
  const clubCounts = useClubCountsByFederation(fedIds)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    resetPage()
  }
  function sortedOf(key: SortKey) {
    return sort.key === key ? sort.dir : (false as const)
  }

  async function discover(fed: Federation) {
    setBusyId(fed.id)
    setResult(null)
    const r = await triggerDiscoverClubs(fed)
    setResult({ id: fed.id, r })
    setBusyId(null)
  }

  // Re-extract from the already-discovered directory (skips discovery) — for needs_review/re-runs.
  async function extract(fed: Federation) {
    setBusyId(fed.id)
    setResult(null)
    const r = await triggerExtractFederation(fed)
    setResult({ id: fed.id, r })
    setBusyId(null)
  }

  // Acts on the whole filtered set: confirm with the server-side total, then fetch all ids.
  async function batchProcess() {
    if (totalItems === 0) return
    const ok = await confirm({
      title: 'Process federations',
      message:
        `Process ${totalItems} federation(s)? Each runs discovery (+ gated extraction) — this spends ` +
        `LLM/Firecrawl/Serper credits and runs in the background (~1/min).`,
      confirmLabel: `Process ${totalItems}`,
    })
    if (!ok) return
    setBatchBusy(true)
    setBatchMsg(null)
    let ids: string[]
    try {
      const list = await pb.collection('federations').getFullList<{ id: string }>({
        filter: filter || undefined, fields: 'id', batch: 500,
      })
      ids = list.map((f) => f.id)
    } catch (e) {
      setBatchBusy(false)
      setBatchMsg(`Failed: ${(e as Error).message}`)
      return
    }
    if (ids.length === 0) { setBatchBusy(false); return }
    const r = await triggerBatchProcess(ids)
    setBatchBusy(false)
    setBatchMsg(
      r.ok ? `Queued ${ids.length} — processing in the background. Watch statuses update live.` : `Failed: ${r.error || r.status}`,
    )
  }

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load federations: {error}</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search name / country / code…" value={q} onChange={(e) => { setQ(e.target.value); resetPage() }} />
        <Select value={conf} onChange={(e) => { setConf(e.target.value); resetPage() }}>
          <option value="">All confederations</option>
          {CONFEDERATIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); resetPage() }}>
          <option value="">All statuses</option>
          {FEDERATION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <span className="ml-auto text-sm text-neutral-500">{totalItems.toLocaleString()} federations{loading ? ' · loading…' : ''}</span>
        <Tooltip
          side="bottom"
          content="Batch-process every federation in the current filter through discover → gate → extract, in the background (~1/min). Spends LLM/Firecrawl/Serper credits."
        >
          <Button size="sm" variant="outline" disabled={batchBusy || totalItems === 0} onClick={batchProcess}>
            {batchBusy ? 'Queuing…' : `Process ${totalItems}`}
          </Button>
        </Tooltip>
      </div>
      {batchMsg && <div className="text-sm text-neutral-600">{batchMsg}</div>}

      <Table>
        <THead>
          <TR>
            <TH sortable sorted={sortedOf('fivb_code')} onClick={() => toggleSort('fivb_code')}>Code</TH>
            <TH sortable sorted={sortedOf('name')} onClick={() => toggleSort('name')} className="min-w-[260px]">Federation</TH>
            <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
            <TH sortable sorted={sortedOf('status')} onClick={() => toggleSort('status')}>Status</TH>
            <TH className="text-right">Clubs</TH>
            <TH>Website</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {items.map((f) => (
            <FederationRow
              key={f.id}
              fed={f}
              clubCount={clubCounts[f.id] || 0}
              busy={busyId === f.id}
              onOpen={() => setOpenId(f.id)}
              onDiscover={() => discover(f)}
              onExtract={() => extract(f)}
              onOpenClubs={() => f.country && onOpenClubs(f.country)}
            />
          ))}
        </TBody>
      </Table>

      <Pagination page={page} perPage={perPage} totalItems={totalItems} totalPages={totalPages}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); resetPage() }} />

      <FederationDetailDialog
        fed={items.find((f) => f.id === openId) ?? null}
        result={result?.id === openId ? result.r : null}
        onClose={() => setOpenId(null)}
      />
      {confirmElement}
    </div>
  )
}

function FederationRow({
  fed, clubCount, busy, onOpen, onDiscover, onExtract, onOpenClubs,
}: {
  fed: Federation
  clubCount: number
  busy: boolean
  onOpen: () => void
  onDiscover: () => void
  onExtract: () => void
  onOpenClubs: () => void
}) {
  return (
    <TR>
      <TD className="font-mono text-xs cursor-pointer" onClick={onOpen}>{fed.fivb_code}</TD>
      <TD className="cursor-pointer" onClick={onOpen}>
          <div className="font-medium">{fed.name}</div>
          <Badge tone="blue" className="mt-1">{fed.confederation || '—'}</Badge>
        </TD>
        <TD><CountryLabel country={fed.country} /></TD>
        <TD>{fed.status ? <Badge tone={statusTone(fed.status)}>{fed.status}</Badge> : '—'}</TD>
        <TD className="text-right tabular-nums">
          {clubCount > 0 ? (
            <Tooltip side="bottom" content={`View the ${clubCount} discovered club(s) for ${fed.country}.`}>
              <button
                className="font-medium text-blue-600 hover:underline"
                onClick={onOpenClubs}
              >
                {clubCount}
              </button>
            </Tooltip>
          ) : (
            <span className="text-neutral-400">0</span>
          )}
        </TD>
        <TD className="max-w-[180px] truncate">
          {fed.website_url ? (
            <a className="text-blue-600 hover:underline" href={fed.website_url} target="_blank" rel="noreferrer">
              {fed.website_url.replace(/^https?:\/\//, '')}
            </a>
          ) : <span className="text-neutral-400">none</span>}
        </TD>
        <TD className="text-right whitespace-nowrap">
          <span className="inline-flex items-center justify-end gap-1">
            <Tooltip
              side="bottom"
              content="Detect directory — search-led discovery: finds this federation's club directory, classifies it, then (if the gate allows) extracts clubs. Spends Serper/Firecrawl/LLM credits and overwrites the discovered directory URLs/method/notes."
            >
              <Button size="sm" className="w-8 px-0" disabled={busy} onClick={onDiscover} aria-label="Detect directory">
                {busy ? <SpinnerIcon /> : <SearchIcon />}
              </Button>
            </Tooltip>
            {fed.directory_urls && fed.directory_urls.length > 0 && (
              <Tooltip
                side="bottom"
                content="Extract clubs — re-extract clubs from the already-discovered directory (skips discovery, no gate). Cheap and idempotent — find-or-create by dedup_key, backfilling fields like detail_url onto existing rows."
              >
                <Button size="sm" variant="outline" className="w-8 px-0" disabled={busy} onClick={onExtract} aria-label="Extract clubs">
                  <DownloadIcon />
                </Button>
              </Tooltip>
            )}
          </span>
        </TD>
      </TR>
  )
}

function FederationDetailDialog({
  fed, result, onClose,
}: {
  fed: Federation | null
  result: TriggerResult | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={fed != null}
      onClose={onClose}
      header={
        fed && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-neutral-500">{fed.fivb_code}</span>
            <h2 className="text-base font-semibold text-neutral-900">{fed.name}</h2>
            <Badge tone="blue">{fed.confederation || '—'}</Badge>
            {fed.status && <Badge tone={statusTone(fed.status)}>{fed.status}</Badge>}
          </div>
        )
      }
      footer={
        result && (
          <div className="text-sm">
            <span className={result.ok ? 'text-green-700' : 'text-red-600'}>
              {result.ok ? 'Triggered ✓ ' : `Trigger failed (${result.status}) `}
            </span>
            <code className="text-xs text-neutral-500">
              {result.error || JSON.stringify(result.body)?.slice(0, 200)}
            </code>
          </div>
        )
      }
    >
      {fed && (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Overview</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Country" value={withFlag(fed.country)} />
              <DialogField label="Website" value={fed.website_url} link />
              <DialogField label="Extraction method" value={fed.extraction_method} />
              <DialogField label="Last scraped" value={fed.last_scraped} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Contacts</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="President" value={fed.president} />
              <DialogField label="General secretary" value={fed.general_secretary} />
              <DialogField label="Email" value={fed.email} />
              <DialogField label="Phone" value={fed.phone} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Directory</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Club directory" value={fed.club_directory_url} link />
              <DialogField label="Source" value={fed.source_url} link />
            </dl>
            <div className="mt-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Directory URLs</dt>
              <dd className="mt-1 text-sm">
                {fed.directory_urls && fed.directory_urls.length > 0 ? (
                  <ul className="space-y-1">
                    {fed.directory_urls.map((d, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <a className="break-all text-blue-600 hover:underline" href={d.url} target="_blank" rel="noreferrer">{d.url}</a>
                        {d.region && <Badge>{d.region}</Badge>}
                        {d.extraction_method && <Badge tone="blue">{d.extraction_method}</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : <span className="text-neutral-400">none yet</span>}
              </dd>
            </div>
            <div className="mt-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Discovery notes</dt>
              <dd className="mt-1 text-sm">
                {fed.notes
                  ? <span className="whitespace-pre-wrap">{fed.notes}</span>
                  : <span className="text-neutral-400">—</span>}
              </dd>
            </div>
          </section>
        </div>
      )}
    </Dialog>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  )
}
