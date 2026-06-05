import { useMemo, useState } from 'react'
import { pb, CONFEDERATIONS, FEDERATION_STATUSES, type Federation, type GateOverride } from '@/lib/pb'
import { useCollection } from '@/hooks/useCollection'
import { triggerDiscoverClubs, triggerBatchProcess, triggerExtractFederation, type TriggerResult } from '@/lib/n8n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, statusTone } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type SortKey = 'fivb_code' | 'name' | 'country' | 'confederation' | 'status' | 'last_scraped'

// Status sort order — scraped federations first, untouched (new) last.
const STATUS_RANK: Record<string, number> = { scraped: 0, needs_review: 1, error: 2, new: 3 }
const statusRank = (s: string) => (s in STATUS_RANK ? STATUS_RANK[s] : 99)

export function FederationsPage() {
  const { items, loading, error } = useCollection<Federation>('federations', 'name')
  const [conf, setConf] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'status', dir: 'asc' })
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [result, setResult] = useState<{ id: string; r: TriggerResult } | null>(null)
  const [batchMsg, setBatchMsg] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = items.filter((f) => {
      if (conf && f.confederation !== conf) return false
      if (status && f.status !== status) return false
      if (needle && !`${f.name} ${f.country} ${f.fivb_code}`.toLowerCase().includes(needle)) return false
      return true
    })
    out = [...out].sort((a, b) => {
      let cmp: number
      if (sort.key === 'status') {
        cmp = statusRank(a.status) - statusRank(b.status)
      } else {
        const av = (a[sort.key] ?? '').toString().toLowerCase()
        const bv = (b[sort.key] ?? '').toString().toLowerCase()
        cmp = av < bv ? -1 : av > bv ? 1 : 0
      }
      return cmp * (sort.dir === 'asc' ? 1 : -1)
    })
    return out
  }, [items, conf, status, q, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
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

  async function setOverride(fed: Federation, value: GateOverride) {
    await pb.collection('federations').update(fed.id, { gate_override: value })
  }

  async function batchProcess() {
    const ids = rows.map((f) => f.id)
    if (ids.length === 0) return
    const ok = window.confirm(
      `Process ${ids.length} federation(s)? Each runs discovery (+ gated extraction) — this spends ` +
        `LLM/Firecrawl/Serper credits and runs in the background (~1/min).`,
    )
    if (!ok) return
    setBatchBusy(true)
    setBatchMsg(null)
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
        <Input className="max-w-xs" placeholder="Search name / country / code…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={conf} onChange={(e) => setConf(e.target.value)}>
          <option value="">All confederations</option>
          {CONFEDERATIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {FEDERATION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <span className="ml-auto text-sm text-neutral-500">{rows.length} / {items.length}{loading ? ' · loading…' : ''}</span>
        <Tooltip
          side="bottom"
          content="Batch-process every federation in the current filter through discover → gate → extract, in the background (~1/min). Spends LLM/Firecrawl/Serper credits."
        >
          <Button size="sm" variant="outline" disabled={batchBusy || rows.length === 0} onClick={batchProcess}>
            {batchBusy ? 'Queuing…' : `Process ${rows.length}`}
          </Button>
        </Tooltip>
      </div>
      {batchMsg && <div className="text-sm text-neutral-600">{batchMsg}</div>}

      <Table>
        <THead>
          <TR>
            <TH sortable sorted={sortedOf('fivb_code')} onClick={() => toggleSort('fivb_code')}>Code</TH>
            <TH sortable sorted={sortedOf('name')} onClick={() => toggleSort('name')}>Federation</TH>
            <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
            <TH sortable sorted={sortedOf('confederation')} onClick={() => toggleSort('confederation')}>Conf.</TH>
            <TH sortable sorted={sortedOf('status')} onClick={() => toggleSort('status')}>Status</TH>
            <TH>Gate</TH>
            <TH>Website</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((f) => (
            <FederationRow
              key={f.id}
              fed={f}
              open={openId === f.id}
              busy={busyId === f.id}
              result={result?.id === f.id ? result.r : null}
              onToggle={() => setOpenId((id) => (id === f.id ? null : f.id))}
              onDiscover={() => discover(f)}
              onExtract={() => extract(f)}
              onOverride={(v) => setOverride(f, v)}
            />
          ))}
        </TBody>
      </Table>
    </div>
  )
}

function FederationRow({
  fed, open, busy, result, onToggle, onDiscover, onExtract, onOverride,
}: {
  fed: Federation
  open: boolean
  busy: boolean
  result: TriggerResult | null
  onToggle: () => void
  onDiscover: () => void
  onExtract: () => void
  onOverride: (v: GateOverride) => void
}) {
  return (
    <>
      <TR>
        <TD className="font-mono text-xs cursor-pointer" onClick={onToggle}>{fed.fivb_code}</TD>
        <TD className="font-medium cursor-pointer" onClick={onToggle}>{fed.name}</TD>
        <TD>{fed.country}</TD>
        <TD><Badge tone="blue">{fed.confederation || '—'}</Badge></TD>
        <TD>{fed.status ? <Badge tone={statusTone(fed.status)}>{fed.status}</Badge> : '—'}</TD>
        <TD>
          <Select
            value={fed.gate_override || 'default'}
            onChange={(e) => onOverride(e.target.value as GateOverride)}
            className="h-8 text-xs"
          >
            <option value="default">default</option>
            <option value="always_review">review</option>
            <option value="always_auto">auto</option>
          </Select>
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
              content="Search-led discovery: finds this federation's club directory, classifies it, then (if the gate allows) extracts clubs. Spends Serper/Firecrawl/LLM credits and overwrites the discovered directory URLs/method/notes."
            >
              <Button size="sm" disabled={busy} onClick={onDiscover}>
                {busy ? 'Triggering…' : 'Discover clubs'}
              </Button>
            </Tooltip>
            {fed.directory_urls && fed.directory_urls.length > 0 && (
              <Tooltip
                side="bottom"
                content="Re-extract clubs from the already-discovered directory (skips discovery, no gate). Cheap and idempotent — find-or-create by dedup_key, backfilling fields like detail_url onto existing rows."
              >
                <Button size="sm" variant="outline" disabled={busy} onClick={onExtract}>
                  Extract
                </Button>
              </Tooltip>
            )}
          </span>
        </TD>
      </TR>
      {open && (
        <TR>
          <TD colSpan={8} className="bg-neutral-50">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 p-2 text-sm">
              <Detail label="President" value={fed.president} />
              <Detail label="General secretary" value={fed.general_secretary} />
              <Detail label="Email" value={fed.email} />
              <Detail label="Phone" value={fed.phone} />
              <Detail label="Club directory" value={fed.club_directory_url} link />
              <Detail label="Extraction method" value={fed.extraction_method} />
              <Detail label="Last scraped" value={fed.last_scraped} />
              <Detail label="Source" value={fed.source_url} link />
              <div className="col-span-2">
                <span className="text-neutral-500">Directory URLs: </span>
                {fed.directory_urls && fed.directory_urls.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {fed.directory_urls.map((d, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <a className="text-blue-600 hover:underline break-all" href={d.url} target="_blank" rel="noreferrer">{d.url}</a>
                        {d.region && <Badge>{d.region}</Badge>}
                        {d.extraction_method && <Badge tone="blue">{d.extraction_method}</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : <span className="text-neutral-400">none yet</span>}
              </div>
              <div className="col-span-2">
                <span className="text-neutral-500">Discovery notes: </span>
                {fed.notes
                  ? <span className="whitespace-pre-wrap">{fed.notes}</span>
                  : <span className="text-neutral-400">—</span>}
              </div>
              {result && (
                <div className="col-span-2 mt-1">
                  <span className={result.ok ? 'text-green-700' : 'text-red-600'}>
                    {result.ok ? 'Triggered ✓ ' : `Trigger failed (${result.status}) `}
                  </span>
                  <code className="text-xs text-neutral-500">
                    {result.error || JSON.stringify(result.body)?.slice(0, 200)}
                  </code>
                </div>
              )}
            </div>
          </TD>
        </TR>
      )}
    </>
  )
}

function Detail({ label, value, link }: { label: string; value?: string; link?: boolean }) {
  return (
    <div>
      <span className="text-neutral-500">{label}: </span>
      {value
        ? link
          ? <a className="text-blue-600 hover:underline" href={value} target="_blank" rel="noreferrer">{value}</a>
          : <span>{value}</span>
        : <span className="text-neutral-400">—</span>}
    </div>
  )
}
