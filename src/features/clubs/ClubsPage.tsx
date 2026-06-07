import { useEffect, useMemo, useState } from 'react'
import { pb, type Club, type WebsiteConfidence, type ClubType, WEBSITE_STATUSES, WEBSITE_CONFIDENCES, CLUB_TYPES } from '@/lib/pb'
import { statusLabel, websiteStatusLabel, websiteSourceLabel, confidenceLabel, confidenceHelp, clubTypeLabel } from '@/lib/labels'
import { usePagedCollection } from '@/hooks/usePagedCollection'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useUrlState, clearUrlParam } from '@/hooks/useUrlState'
import { useContactCountsByClub } from '@/hooks/useContactCounts'
import { triggerBatchEnrich, triggerEnglishizeClubs, triggerSiteScrape } from '@/lib/n8n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, statusTone } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { ActionsMenu } from '@/components/ui/menu'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { useConfirm } from '@/components/ui/confirm'
import { CountryLabel } from '@/components/ui/country'
import { Pagination } from '@/components/ui/pagination'
import { withFlag, countryFlag } from '@/lib/countries'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type SortKey = 'name' | 'country' | 'city' | 'status'

// Combine filter clauses with AND, wrapping each clause so OR-groups stay scoped.
function andFilter(...clauses: (string | false | undefined)[]): string {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(' && ')
}

// Build the PocketBase filter for the current club controls. `unknown`-style
// selections match both the literal 'unknown' and empty string (mirrors the old
// client-side `(x || 'unknown')` defaulting).
function buildClubsFilter(f: {
  country: string; hasSite: string; ws: string; wc: string; ct: string; q: string
}): string {
  return andFilter(
    f.country && pb.filter('country = {:v}', { v: f.country }),
    f.hasSite === 'yes' && "website_url != ''",
    f.hasSite === 'no' && "website_url = ''",
    f.ws && (f.ws === 'unknown' ? "website_status = 'unknown' || website_status = ''" : pb.filter('website_status = {:v}', { v: f.ws })),
    f.wc && (f.wc === 'unknown' ? "website_confidence = 'unknown' || website_confidence = ''" : pb.filter('website_confidence = {:v}', { v: f.wc })),
    f.ct && (f.ct === 'unknown' ? "club_type = 'unknown' || club_type = ''" : pb.filter('club_type = {:v}', { v: f.ct })),
    f.q && pb.filter('name ~ {:q} || country ~ {:q} || region ~ {:q} || city ~ {:q}', { q: f.q }),
  )
}

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
  const [q, setQ] = useUrlState('q')
  const [country, setCountry] = useState(initialCountry ?? '')
  const [hasSite, setHasSite] = useUrlState('hasSite')
  const [wsFilter, setWsFilter] = useUrlState('ws')
  const [wcFilter, setWcFilter] = useUrlState('wc')
  const [ctFilter, setCtFilter] = useUrlState('ct')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)
  const [enrichBusy, setEnrichBusy] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { confirm, confirmElement } = useConfirm()
  const resetPage = () => setPage(1)

  const debouncedQ = useDebouncedValue(q, 300)
  const filter = useMemo(
    () => buildClubsFilter({ country, hasSite, ws: wsFilter, wc: wcFilter, ct: ctFilter, q: debouncedQ.trim() }),
    [country, hasSite, wsFilter, wcFilter, ctFilter, debouncedQ],
  )
  const sortStr = `${sort.dir === 'asc' ? '+' : '-'}${sort.key}`
  const { items, totalItems, totalPages, loading, error } = usePagedCollection<Club>('clubs', {
    page, perPage, sort: sortStr, filter,
  })

  const clubIds = useMemo(() => items.map((c) => c.id), [items])
  const contactCounts = useContactCountsByClub(clubIds)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    resetPage()
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  // Batch-action subset filters (computed over the WHOLE filtered set, not just the page).
  const unresolvedFilter = useMemo(() => andFilter(filter, "website_status = 'unknown' || website_status = ''"), [filter])
  const recheckFilter = useMemo(() => andFilter(filter, "website_source = 'serper' && website_status = 'live'"), [filter])
  const harvestFilter = useMemo(() => andFilter(filter, "website_status = 'live'"), [filter])
  // Site-scrape targets trusted sites (A/B; C is the wrong-club/aggregator bucket) PLUS any club
  // with a federation detail page (federation-provenance; contacts even when there's no website).
  const scrapeFilter = useMemo(() => andFilter(filter, "(website_status = 'live' && (website_confidence = 'A' || website_confidence = 'B')) || detail_url != ''"), [filter])
  const [unresolvedCount, setUnresolvedCount] = useState(0)
  const [recheckCount, setRecheckCount] = useState(0)
  const [harvestCount, setHarvestCount] = useState(0)
  const [scrapeCount, setScrapeCount] = useState(0)

  // Server-side counts for the batch buttons; recomputed when the filter changes
  // and on every (realtime) page refetch (`items`) so they track status changes.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [u, r, h, s] = await Promise.all([
          pb.collection('clubs').getList(1, 1, { filter: unresolvedFilter || undefined, fields: 'id' }),
          pb.collection('clubs').getList(1, 1, { filter: recheckFilter || undefined, fields: 'id' }),
          pb.collection('clubs').getList(1, 1, { filter: harvestFilter || undefined, fields: 'id' }),
          pb.collection('clubs').getList(1, 1, { filter: scrapeFilter || undefined, fields: 'id' }),
        ])
        if (alive) { setUnresolvedCount(u.totalItems); setRecheckCount(r.totalItems); setHarvestCount(h.totalItems); setScrapeCount(s.totalItems) }
      } catch { /* non-fatal */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedFilter, recheckFilter, harvestFilter, scrapeFilter, items])

  // 'unresolved' → only clubs never resolved; 'all' → re-resolve everything (force);
  // 'recheck' → re-run the belongs-check on serper live URLs (no Serper spend);
  // 'harvest' → re-check + harvest signals (emails/contact/socials/lang) on ALL live URLs,
  //             any source (official_list/manual included). No Serper spend.
  // Acts on the whole filtered set: confirm with the server-side count, then fetch all ids.
  async function resolveWebsites(mode: 'all' | 'unresolved' | 'recheck' | 'harvest') {
    const count = mode === 'all' ? totalItems : mode === 'recheck' ? recheckCount : mode === 'harvest' ? harvestCount : unresolvedCount
    if (count === 0) return
    const what =
      mode === 'all' ? `re-resolve ALL ${count}`
      : mode === 'recheck' ? `re-check confidence on ${count} serper`
      : mode === 'harvest' ? `re-check + harvest signals on ${count} live`
      : `resolve ${count} unresolved`
    const verb = (mode === 'recheck' || mode === 'harvest') ? 'AI' : 'Serper + AI'
    const ok = await confirm({
      title: 'Resolve club websites',
      message: `${verb} ${what} club website(s)? Runs in the background.`,
      confirmLabel: 'Run',
    })
    if (!ok) return
    setEnrichBusy(true)
    setEnrichMsg(null)
    const targetFilter = mode === 'all' ? filter : mode === 'recheck' ? recheckFilter : mode === 'harvest' ? harvestFilter : unresolvedFilter
    let ids: string[]
    try {
      const list = await pb.collection('clubs').getFullList<{ id: string }>({
        filter: targetFilter || undefined, fields: 'id', batch: 500,
      })
      ids = list.map((c) => c.id)
    } catch (e) {
      setEnrichBusy(false)
      setEnrichMsg(`Failed: ${(e as Error).message}`)
      return
    }
    if (ids.length === 0) { setEnrichBusy(false); return }
    const r = await triggerBatchEnrich(ids, mode === 'all', mode === 'recheck' || mode === 'harvest')
    setEnrichBusy(false)
    setEnrichMsg(r.ok ? `Queued ${ids.length} — updates land live.` : `Failed: ${r.error || r.status}`)
  }

  // Generate English names for all clubs still missing one (non-Latin scripts only;
  // gated server-side). Global maintenance op — not filter-scoped.
  async function englishizeNames() {
    setEnrichBusy(true)
    setEnrichMsg(null)
    const r = await triggerEnglishizeClubs()
    setEnrichBusy(false)
    setEnrichMsg(
      r.ok
        ? 'Romanizing non-Latin club names — updates land live.'
        : `Failed: ${r.error || r.status}`,
    )
  }

  // Phase 5: crawl trusted (A/B) live club sites in the current filter for contacts
  // (multi-page; Apify/Gemini). C is excluded (wrong-club/aggregator). Writes to Contacts.
  async function scrapeSites() {
    if (scrapeCount === 0) return
    const ok = await confirm({
      title: 'Scrape club sites for contacts',
      message: `Crawl ${scrapeCount} club(s) in the current filter for contacts — trusted (A/B) websites + federation detail pages (multi-page; uses Apify/Gemini credits). Runs in the background.`,
      confirmLabel: 'Run',
    })
    if (!ok) return
    setEnrichBusy(true)
    setEnrichMsg(null)
    let ids: string[]
    try {
      const list = await pb.collection('clubs').getFullList<{ id: string }>({
        filter: scrapeFilter || undefined, fields: 'id', batch: 500,
      })
      ids = list.map((c) => c.id)
    } catch (e) {
      setEnrichBusy(false)
      setEnrichMsg(`Failed: ${(e as Error).message}`)
      return
    }
    if (ids.length === 0) { setEnrichBusy(false); return }
    const r = await triggerSiteScrape(ids)
    setEnrichBusy(false)
    setEnrichMsg(r.ok ? `Scraping ${ids.length} site(s) — contacts land live.` : `Failed: ${r.error || r.status}`)
  }

  // Per-club full scrape (from the club detail dialog). force=true so it runs even for a
  // low-confidence site the user explicitly picked. Uses website + federation detail page.
  async function scrapeOne(clubId: string) {
    const ok = await confirm({
      title: 'Scrape this club',
      message: 'Crawl this club’s website and/or federation detail page for contacts (uses Apify/Gemini credits)? Runs in the background.',
      confirmLabel: 'Run',
    })
    if (!ok) return
    setEnrichBusy(true)
    setEnrichMsg(null)
    const r = await triggerSiteScrape([clubId], true)
    setEnrichBusy(false)
    setEnrichMsg(r.ok ? 'Scraping 1 club — contacts land live.' : `Failed: ${r.error || r.status}`)
  }

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load clubs: {error}</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search club / city / region…" value={q} onChange={(e) => { setQ(e.target.value); resetPage() }} />
        {country && (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={() => { setCountry(''); clearUrlParam('country'); resetPage() }}
            title="Clear country filter"
          >
            Country: <span className="font-medium">{countryFlag(country) && `${countryFlag(country)} `}{country}</span>
            <span aria-hidden className="text-neutral-400">✕</span>
          </button>
        )}
        <Select value={hasSite} onChange={(e) => { setHasSite(e.target.value); resetPage() }}>
          <option value="">Any website</option>
          <option value="yes">Has website</option>
          <option value="no">No website</option>
        </Select>
        <Select value={wsFilter} onChange={(e) => { setWsFilter(e.target.value); resetPage() }}>
          <option value="">Any web status</option>
          {WEBSITE_STATUSES.map((s) => (
            <option key={s} value={s}>{websiteStatusLabel(s)}</option>
          ))}
        </Select>
        <Select value={wcFilter} onChange={(e) => { setWcFilter(e.target.value); resetPage() }} title="Filter by website confidence (C = needs review)">
          <option value="">Any confidence</option>
          {WEBSITE_CONFIDENCES.map((c) => (
            <option key={c} value={c}>{c === 'unknown' ? 'Unchecked' : `Conf. ${c}`}</option>
          ))}
        </Select>
        <Select value={ctFilter} onChange={(e) => { setCtFilter(e.target.value); resetPage() }} title="Filter by club type (volleyball vs multi-sport club)">
          <option value="">Any type</option>
          {CLUB_TYPES.map((t) => (
            <option key={t} value={t}>{clubTypeLabel(t)}</option>
          ))}
        </Select>
        <span className="ml-auto text-sm text-neutral-500">{totalItems.toLocaleString()} clubs{loading ? ' · loading…' : ''}</span>
        <ActionsMenu
          busy={enrichBusy}
          actions={[
            {
              key: 'unresolved',
              label: 'Find missing websites',
              count: unresolvedCount,
              description: 'Looks up the official website for clubs that don’t have one yet. Uses Serper + AI.',
              disabled: enrichBusy || unresolvedCount === 0,
              onSelect: () => resolveWebsites('unresolved'),
            },
            {
              key: 'all',
              label: 'Re-find all websites',
              count: totalItems,
              description: 'Looks up the website again for every club shown, fixing wrong matches. Uses Serper + AI.',
              disabled: enrichBusy || totalItems === 0,
              onSelect: () => resolveWebsites('all'),
            },
            {
              key: 'recheck',
              label: 'Re-check confidence',
              count: recheckCount,
              description: 'Re-checks whether each found website really belongs to the club (the A/B/C grade). No new searches.',
              disabled: enrichBusy || recheckCount === 0,
              onSelect: () => resolveWebsites('recheck'),
            },
            {
              key: 'harvest',
              label: 'Light contact scrape',
              count: harvestCount,
              description: 'Quickly grabs emails, a contact page and social links from each club’s homepage. Fast, no deep crawl.',
              disabled: enrichBusy || harvestCount === 0,
              onSelect: () => resolveWebsites('harvest'),
            },
            {
              key: 'scrape',
              label: 'Full site scrape',
              count: scrapeCount,
              description: 'Crawls each trusted (A/B) club’s website + any club’s federation detail page to find contacts. Slower and uses more credits. C-only sites excluded.',
              disabled: enrichBusy || scrapeCount === 0,
              onSelect: scrapeSites,
            },
            {
              key: 'romanize',
              label: 'Romanize names',
              description: 'Adds English/Latin names for clubs written in other scripts (Cyrillic, Greek, …).',
              disabled: enrichBusy,
              onSelect: englishizeNames,
            },
          ]}
        />
      </div>
      {enrichMsg && <div className="text-sm text-neutral-600">{enrichMsg}</div>}

      {totalItems === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No clubs yet. Trigger “Discover clubs” on a federation to populate this.
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH sortable sorted={sortedOf('name')} onClick={() => toggleSort('name')} className="w-[350px] min-w-[350px] max-w-[350px]">Club</TH>
              <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')} className="w-[140px] min-w-[140px]">Country</TH>
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
            {items.map((c) => (
              <TR key={c.id}>
                <TD className="w-[350px] min-w-[350px] max-w-[350px] cursor-pointer hover:text-blue-600" onClick={() => setOpenId(c.id)}>
                  <div className="font-medium">{c.name_en || c.name}</div>
                  {c.name_en && c.name_en !== c.name && (
                    <div className="text-xs text-neutral-500">{c.name}</div>
                  )}
                </TD>
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
                  ) : <span className="text-neutral-400">No website</span>}
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
                    ? <Badge tone={statusTone(c.website_status)}>{websiteStatusLabel(c.website_status)}</Badge>
                    : <span className="text-neutral-400">—</span>}
                </TD>
                <TD>
                  {c.website_confidence && c.website_confidence !== 'unknown'
                    ? (
                      <Tooltip side="bottom" content={confidenceHelp(c.website_confidence)}>
                        <Badge tone={confidenceTone(c.website_confidence)}>{c.website_confidence}</Badge>
                      </Tooltip>
                    )
                    : <span className="text-neutral-400">—</span>}
                </TD>
                <TD>
                  {c.club_type && c.club_type !== 'unknown'
                    ? <Badge tone={clubTypeTone(c.club_type)}>{clubTypeLabel(c.club_type)}</Badge>
                    : <span className="text-neutral-400">—</span>}
                </TD>
                <TD className="text-right tabular-nums">
                  {contactCounts[c.id] ? (
                    <button className="font-medium text-blue-600 hover:underline" onClick={() => onOpenContacts?.(c.id)}>
                      {contactCounts[c.id]}
                    </button>
                  ) : <span className="text-neutral-400">0</span>}
                </TD>
                <TD>{c.status ? <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge> : '—'}</TD>
                <TD className="max-w-[220px] truncate text-xs text-neutral-500" title={c.scrape_note || ''}>
                  {c.scrape_note || '—'}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Pagination page={page} perPage={perPage} totalItems={totalItems} totalPages={totalPages}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); resetPage() }} />

      <ClubDetailDialog
        club={items.find((c) => c.id === openId) ?? null}
        contactCount={openId ? contactCounts[openId] || 0 : 0}
        busy={enrichBusy}
        onScrape={scrapeOne}
        onClose={() => setOpenId(null)}
        onOpenContacts={onOpenContacts}
      />
      {confirmElement}
    </div>
  )
}

function ClubDetailDialog({
  club, contactCount, busy, onScrape, onClose, onOpenContacts,
}: {
  club: Club | null
  contactCount: number
  busy?: boolean
  onScrape?: (clubId: string) => void
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
            <h2 className="text-base font-semibold text-neutral-900">
              {club.name_en || club.name}
              {club.name_en && club.name_en !== club.name && (
                <span className="ml-2 text-sm font-normal text-neutral-500">{club.name}</span>
              )}
            </h2>
            {club.status && <Badge tone={statusTone(club.status)}>{statusLabel(club.status)}</Badge>}
            {club.website_confidence && club.website_confidence !== 'unknown' && (
              <Tooltip side="bottom" content={confidenceHelp(club.website_confidence)}>
                <Badge tone={confidenceTone(club.website_confidence)}>Conf. {club.website_confidence}</Badge>
              </Tooltip>
            )}
          </div>
        )
      }
      footer={
        club && (
          <div className="flex justify-end gap-2">
            {onScrape && (club.website_url || club.detail_url) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onScrape(club.id)}>
                {busy ? 'Scraping…' : 'Full scrape'}
              </Button>
            )}
            {contactCount > 0 && onOpenContacts && (
              <Button size="sm" variant="outline" onClick={() => { onOpenContacts(club.id); onClose() }}>
                View {contactCount} contact{contactCount === 1 ? '' : 's'}
              </Button>
            )}
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
              <DialogField label="Web status" value={websiteStatusLabel(club.website_status)} />
              <DialogField label="Source" value={websiteSourceLabel(club.website_source)} />
              <DialogField label="Confidence" value={confidenceLabel(club.website_confidence)} />
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
