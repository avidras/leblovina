import { useMemo, useState } from 'react'
import { type Club, type WebsiteConfidence, type ClubType, WEBSITE_STATUSES, WEBSITE_CONFIDENCES, CLUB_TYPES } from '@/lib/pb'
import { useCollection } from '@/hooks/useCollection'
import { useUrlState, clearUrlParam } from '@/hooks/useUrlState'
import { useContactCountsByClub } from '@/hooks/useContactCounts'
import { triggerBatchEnrich } from '@/lib/n8n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, statusTone } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { useConfirm } from '@/components/ui/confirm'
import { CountryLabel } from '@/components/ui/country'
import { withFlag, countryFlag } from '@/lib/countries'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type SortKey = 'name' | 'country' | 'region' | 'city' | 'status'

// A = trusted (green), B = probable (blue), C = low-confidence/review (amber).
function confidenceTone(c: WebsiteConfidence | ''): 'green' | 'blue' | 'amber' | 'neutral' {
  switch (c) {
    case 'A': return 'green'
    case 'B': return 'blue'
    case 'C': return 'amber'
    default: return 'neutral'
  }
}

// volleyball = dedicated (blue); multisport = volleyball section of a multi-sport club (amber cue).
function clubTypeTone(t: ClubType | ''): 'blue' | 'amber' | 'neutral' {
  switch (t) {
    case 'volleyball': return 'blue'
    case 'multisport': return 'amber'
    default: return 'neutral'
  }
}

export function ClubsPage({ initialCountry, onOpenContacts }: { initialCountry?: string | null; onOpenContacts?: (clubId: string) => void } = {}) {
  const { items, loading, error } = useCollection<Club>('clubs', 'name')
  const contactCounts = useContactCountsByClub()
  const [q, setQ] = useUrlState('q')
  const [country, setCountry] = useState(initialCountry ?? '')
  const [hasSite, setHasSite] = useUrlState('hasSite')
  const [wsFilter, setWsFilter] = useUrlState('ws')
  const [wcFilter, setWcFilter] = useUrlState('wc')
  const [ctFilter, setCtFilter] = useUrlState('ct')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [enrichBusy, setEnrichBusy] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { confirm, confirmElement } = useConfirm()

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = items.filter((c) => {
      if (country && c.country !== country) return false
      if (hasSite === 'yes' && !c.website_url) return false
      if (hasSite === 'no' && c.website_url) return false
      if (wsFilter && (c.website_status || 'unknown') !== wsFilter) return false
      if (wcFilter && (c.website_confidence || 'unknown') !== wcFilter) return false
      if (ctFilter && (c.club_type || 'unknown') !== ctFilter) return false
      if (needle && !`${c.name} ${c.country} ${c.region} ${c.city}`.toLowerCase().includes(needle)) return false
      return true
    })
    out = [...out].sort((a, b) => {
      const av = (a[sort.key] ?? '').toString().toLowerCase()
      const bv = (b[sort.key] ?? '').toString().toLowerCase()
      return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1)
    })
    return out
  }, [items, q, country, hasSite, wsFilter, wcFilter, ctFilter, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  // Clubs never resolved yet (no resolve attempt recorded).
  const unresolvedRows = useMemo(
    () => rows.filter((c) => !c.website_status || c.website_status === 'unknown'),
    [rows],
  )
  // Serper-resolved live clubs — the only ones the belongs-check applies to.
  const recheckRows = useMemo(
    () => rows.filter((c) => c.website_source === 'serper' && c.website_status === 'live'),
    [rows],
  )

  // 'unresolved' → only clubs never resolved; 'all' → re-resolve everything (force);
  // 'recheck' → re-run the belongs-check on serper live URLs (no Serper spend).
  async function resolveWebsites(mode: 'all' | 'unresolved' | 'recheck') {
    const target = mode === 'all' ? rows : mode === 'recheck' ? recheckRows : unresolvedRows
    const ids = target.map((c) => c.id)
    if (ids.length === 0) return
    const what =
      mode === 'all' ? `re-resolve ALL ${ids.length}`
      : mode === 'recheck' ? `re-check confidence on ${ids.length} serper`
      : `resolve ${ids.length} unresolved`
    const verb = mode === 'recheck' ? 'AI' : 'Serper + AI'
    const ok = await confirm({
      title: 'Resolve club websites',
      message: `${verb} ${what} club website(s)? Runs in the background.`,
      confirmLabel: 'Run',
    })
    if (!ok) return
    setEnrichBusy(true)
    setEnrichMsg(null)
    const r = await triggerBatchEnrich(ids, mode === 'all', mode === 'recheck')
    setEnrichBusy(false)
    setEnrichMsg(r.ok ? `Queued ${ids.length} — updates land live.` : `Failed: ${r.error || r.status}`)
  }

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load clubs: {error}</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search club / city / region…" value={q} onChange={(e) => setQ(e.target.value)} />
        {country && (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={() => { setCountry(''); clearUrlParam('country') }}
            title="Clear country filter"
          >
            Country: <span className="font-medium">{countryFlag(country) && `${countryFlag(country)} `}{country}</span>
            <span aria-hidden className="text-neutral-400">✕</span>
          </button>
        )}
        <Select value={hasSite} onChange={(e) => setHasSite(e.target.value)}>
          <option value="">Any website</option>
          <option value="yes">Has website</option>
          <option value="no">No website</option>
        </Select>
        <Select value={wsFilter} onChange={(e) => setWsFilter(e.target.value)}>
          <option value="">Any web status</option>
          {WEBSITE_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={wcFilter} onChange={(e) => setWcFilter(e.target.value)} title="Filter by website confidence (C = needs review)">
          <option value="">Any confidence</option>
          {WEBSITE_CONFIDENCES.map((c) => (
            <option key={c} value={c}>{c === 'unknown' ? 'unchecked' : `conf ${c}`}</option>
          ))}
        </Select>
        <Select value={ctFilter} onChange={(e) => setCtFilter(e.target.value)} title="Filter by club type (volleyball vs multi-sport club)">
          <option value="">Any type</option>
          {CLUB_TYPES.map((t) => (
            <option key={t} value={t}>{t === 'unknown' ? 'unclassified' : t}</option>
          ))}
        </Select>
        <span className="ml-auto text-sm text-neutral-500">{rows.length} / {items.length}{loading ? ' · loading…' : ''}</span>
        <Tooltip
          side="bottom"
          content="Resolve a website only for clubs in the current filter that were never resolved before (web status unknown). Serper + AI picks the club's own site. Runs in the background."
        >
          <Button size="sm" variant="outline" disabled={enrichBusy || unresolvedRows.length === 0} onClick={() => resolveWebsites('unresolved')}>
            {enrichBusy ? 'Queuing…' : `Resolve unresolved (${unresolvedRows.length})`}
          </Button>
        </Tooltip>
        <Tooltip
          side="bottom"
          content="Re-resolve EVERY club in the current filter (incl. already-resolved), re-picking the club's own site via Serper + AI — fixes wrong auto-picked sites. Directory/manual URLs are kept. Runs in the background."
        >
          <Button size="sm" variant="outline" disabled={enrichBusy || rows.length === 0} onClick={() => resolveWebsites('all')}>
            {`Re-resolve all (${rows.length})`}
          </Button>
        </Tooltip>
        <Tooltip
          side="bottom"
          content="Re-check whether each Serper-resolved live site actually belongs to the club (sets confidence A/B/C; C = review). No Serper spend — reuses the page already fetched. Runs in the background."
        >
          <Button size="sm" variant="outline" disabled={enrichBusy || recheckRows.length === 0} onClick={() => resolveWebsites('recheck')}>
            {`Re-check confidence (${recheckRows.length})`}
          </Button>
        </Tooltip>
      </div>
      {enrichMsg && <div className="text-sm text-neutral-600">{enrichMsg}</div>}

      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No clubs yet. Trigger “Discover clubs” on a federation to populate this.
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH sortable sorted={sortedOf('name')} onClick={() => toggleSort('name')} className="min-w-[220px]">Club</TH>
              <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
              <TH sortable sorted={sortedOf('city')} onClick={() => toggleSort('city')}>City</TH>
              <TH>Website</TH>
              <TH>Web status</TH>
              <TH>Conf.</TH>
              <TH>Type</TH>
              <TH className="text-right">Contacts</TH>
              <TH sortable sorted={sortedOf('status')} onClick={() => toggleSort('status')}>Status</TH>
              <TH>Last scrape</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="min-w-[220px] cursor-pointer font-medium hover:text-blue-600" onClick={() => setOpenId(c.id)}>{c.name}</TD>
                <TD>
                  <CountryLabel country={c.country} />
                  {c.region && <div className="text-xs text-neutral-500">{c.region}</div>}
                </TD>
                <TD>{c.city || '—'}</TD>
                <TD className="max-w-[200px] truncate">
                  {c.website_url ? (
                    <a className="text-blue-600 hover:underline" href={c.website_url} target="_blank" rel="noreferrer">
                      {c.website_url.replace(/^https?:\/\//, '')}
                    </a>
                  ) : <span className="text-neutral-400">none</span>}
                  {c.detail_url && (
                    <div className="truncate text-xs">
                      <a className="text-blue-600 hover:underline" href={c.detail_url} target="_blank" rel="noreferrer">
                        Federation detail ↗
                      </a>
                    </div>
                  )}
                </TD>
                <TD>
                  {c.website_status
                    ? <Badge tone={statusTone(c.website_status)}>{c.website_status}</Badge>
                    : <span className="text-neutral-400">—</span>}
                </TD>
                <TD>
                  {c.website_confidence && c.website_confidence !== 'unknown'
                    ? <Badge tone={confidenceTone(c.website_confidence)}>{c.website_confidence}</Badge>
                    : <span className="text-neutral-400">—</span>}
                </TD>
                <TD>
                  {c.club_type && c.club_type !== 'unknown'
                    ? <Badge tone={clubTypeTone(c.club_type)}>{c.club_type === 'multisport' ? 'multi' : 'VB'}</Badge>
                    : <span className="text-neutral-400">—</span>}
                </TD>
                <TD className="text-right tabular-nums">
                  {contactCounts[c.id] ? (
                    <button className="font-medium text-blue-600 hover:underline" onClick={() => onOpenContacts?.(c.id)}>
                      {contactCounts[c.id]}
                    </button>
                  ) : <span className="text-neutral-400">0</span>}
                </TD>
                <TD>{c.status ? <Badge tone={statusTone(c.status)}>{c.status}</Badge> : '—'}</TD>
                <TD className="max-w-[220px] truncate text-xs text-neutral-500" title={c.scrape_note || ''}>
                  {c.scrape_note || '—'}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <ClubDetailDialog
        club={items.find((c) => c.id === openId) ?? null}
        contactCount={openId ? contactCounts[openId] || 0 : 0}
        onClose={() => setOpenId(null)}
        onOpenContacts={onOpenContacts}
      />
      {confirmElement}
    </div>
  )
}

function ClubDetailDialog({
  club, contactCount, onClose, onOpenContacts,
}: {
  club: Club | null
  contactCount: number
  onClose: () => void
  onOpenContacts?: (clubId: string) => void
}) {
  return (
    <Dialog
      open={club != null}
      onClose={onClose}
      header={
        club && (
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900">{club.name}</h2>
            {club.status && <Badge tone={statusTone(club.status)}>{club.status}</Badge>}
            {club.website_confidence && club.website_confidence !== 'unknown' && (
              <Badge tone={confidenceTone(club.website_confidence)}>conf {club.website_confidence}</Badge>
            )}
          </div>
        )
      }
      footer={
        club && contactCount > 0 && onOpenContacts && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => { onOpenContacts(club.id); onClose() }}>
              View {contactCount} contact{contactCount === 1 ? '' : 's'}
            </Button>
          </div>
        )
      }
    >
      {club && (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Location</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Country" value={withFlag(club.country)} />
              <DialogField label="Region" value={club.region} />
              <DialogField label="City" value={club.city} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Website</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Website" value={club.website_url} link />
              <DialogField label="Web status" value={club.website_status} />
              <DialogField label="Source" value={club.website_source} />
              <DialogField label="Confidence" value={club.website_confidence === 'unknown' ? '' : club.website_confidence} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Provenance</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Source URL" value={club.source_url} link />
              <DialogField label="Detail page" value={club.detail_url} link />
              <DialogField label="Source club id" value={club.source_club_id} />
              <DialogField label="Last scraped" value={club.last_scraped} />
            </dl>
            {club.scrape_note && (
              <div className="mt-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Scrape note</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-neutral-900">{club.scrape_note}</dd>
              </div>
            )}
            {club.notes && (
              <div className="mt-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-neutral-900">{club.notes}</dd>
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}
