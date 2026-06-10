import { useMemo, useState } from 'react'
import { pb, sanitizeSearch, type Contact, type Club, VERIFICATION_STATUSES, CONTACT_SOURCE_TYPES } from '@/lib/pb'
import { usePagedCollection } from '@/hooks/usePagedCollection'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useUrlState, usePersistentState, clearUrlParam } from '@/hooks/useUrlState'
import { useCountries } from '@/hooks/useCountries'
import { verificationLabel, sourceTypeLabel } from '@/lib/labels'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { CountryLabel } from '@/components/ui/country'
import { ActionsMenu } from '@/components/ui/menu'
import { FilterPanel, ResetFiltersButton } from '@/components/ui/filter-panel'
import { Pagination } from '@/components/ui/pagination'
import { withFlag } from '@/lib/countries'
import { relTime, exactTime } from '@/lib/time'
import { downloadCsv } from '@/lib/csv'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { ClubDetailDialog } from '@/features/clubs/ClubsPage'

type SortKey = 'club' | 'country' | 'email' | 'position' | 'phone' | 'source' | 'sourceType' | 'verification' | 'created'
const SORT_KEYS: SortKey[] = ['club', 'country', 'email', 'position', 'phone', 'source', 'sourceType', 'verification', 'created']
const isValidSort = (v: { key: string; dir: string }) => !!v && SORT_KEYS.includes(v.key as SortKey) && (v.dir === 'asc' || v.dir === 'desc')

// Map the sortable column to its PocketBase field (club/country are relation fields).
const SORT_FIELD: Record<SortKey, string> = {
  club: 'club.name',
  country: 'club.country',
  email: 'email',
  position: 'position',
  phone: 'phone',
  source: 'source_url',
  sourceType: 'source_type',
  verification: 'verification_status',
  created: 'created',
}

function andFilter(...clauses: (string | false | undefined)[]): string {
  return clauses.filter(Boolean).map((c) => `(${c})`).join(' && ')
}

// `unknown`-style defaults mirror the old client-side `(x || 'unverified')` /
// `(x || 'directory')` defaulting. `q` searches across contact + related-club fields.
function buildContactsFilter(f: { club: string; country: string; vs: string; src: string; q: string }): string {
  return andFilter(
    f.club && pb.filter('club = {:v}', { v: f.club }),
    f.country && pb.filter('club.country = {:v}', { v: f.country }),
    f.vs && (f.vs === 'unverified' ? "verification_status = 'unverified' || verification_status = ''" : pb.filter('verification_status = {:v}', { v: f.vs })),
    f.src && (f.src === 'directory' ? "source_type = 'directory' || source_type = ''" : pb.filter('source_type = {:v}', { v: f.src })),
    f.q && pb.filter('email ~ {:q} || club.name ~ {:q} || club.name_en ~ {:q} || position ~ {:q} || phone ~ {:q} || club.country ~ {:q}', { q: sanitizeSearch(f.q) }),
  )
}

export function ContactsPage({ initialClub }: { initialClub?: string | null } = {}) {
  const [q, setQ] = useUrlState('q')
  const [club, setClub] = useState(initialClub ?? '')
  const [countryF, setCountryF] = useUrlState('country')
  const [vsFilter, setVsFilter] = useUrlState('vs')
  const [srcFilter, setSrcFilter] = useUrlState('src')
  const [sort, setSort] = usePersistentState<{ key: SortKey; dir: 'asc' | 'desc' }>('contacts:sort', { key: 'club', dir: 'asc' }, isValidSort)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(100)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openClub, setOpenClub] = useState<Club | null>(null)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const countries = useCountries('contacts')
  const resetPage = () => setPage(1)
  const filtersActive = [q, club, countryF, vsFilter, srcFilter].some(Boolean)
  const resetFilters = () => {
    setQ(''); setClub(''); clearUrlParam('club'); setCountryF(''); setVsFilter(''); setSrcFilter('')
    resetPage()
  }

  const debouncedQ = useDebouncedValue(q, 300)
  const filter = useMemo(
    () => buildContactsFilter({ club, country: countryF, vs: vsFilter, src: srcFilter, q: debouncedQ.trim() }),
    [club, countryF, vsFilter, srcFilter, debouncedQ],
  )
  const sortStr = `${sort.dir === 'asc' ? '+' : '-'}${SORT_FIELD[sort.key]}`
  const { items, totalItems, totalPages, loading, error } = usePagedCollection<Contact>('contacts', {
    page, perPage, sort: sortStr, filter, expand: 'club',
  })

  const clubLabel = (c: Contact) => c.expand?.club?.name_en || c.expand?.club?.name || ''
  const clubCountry = (c: Contact) => c.expand?.club?.country ?? ''

  // Export the CURRENT filtered view (all rows), all columns, as CSV.
  async function exportCsv() {
    setExportBusy(true)
    setExportMsg('Preparing export…')
    try {
      const list = await pb.collection('contacts').getFullList<Contact>({ filter: filter || undefined, sort: sortStr, expand: 'club', batch: 500 })
      const rows = list.map((c) => ({
        club: c.expand?.club?.name_en || c.expand?.club?.name || '',
        club_native: c.expand?.club?.name || '',
        country: c.expand?.club?.country || '',
        region: c.expand?.club?.region || '',
        email: c.email, name: c.name, position: c.position, phone: c.phone,
        source_type: c.source_type, verification_status: c.verification_status, quality: c.quality,
        source_url: c.source_url, notes: c.notes, created: c.created,
      }))
      downloadCsv(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, rows as unknown as Record<string, unknown>[])
      setExportMsg(`Exported ${rows.length} contact(s).`)
    } catch (e) {
      setExportMsg(`Export failed: ${(e as Error).message}`)
    }
    setExportBusy(false)
  }

  // when arriving via a club drill-down, show the club's name in the chip
  const activeClubName = useMemo(
    () => (club ? items.find((c) => c.club === club)?.expand?.club?.name ?? club : ''),
    [club, items],
  )

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    resetPage()
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load contacts: {error}</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search email / club / position…" value={q} onChange={(e) => { setQ(e.target.value); resetPage() }} />
        {club && (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={() => { setClub(''); clearUrlParam('club'); resetPage() }}
            title="Clear club filter"
          >
            Club: <span className="font-medium">{activeClubName}</span>
            <span aria-hidden className="text-neutral-400">✕</span>
          </button>
        )}
        <FilterPanel activeCount={[srcFilter, vsFilter, countryF].filter(Boolean).length}>
          <Select className="w-full" active={!!countryF} value={countryF} onChange={(e) => { setCountryF(e.target.value); resetPage() }} title="Filter by country">
            <option value="">Any country</option>
            {countries.map((c) => (<option key={c} value={c}>{c}</option>))}
          </Select>
          <Select className="w-full" active={!!srcFilter} value={srcFilter} onChange={(e) => { setSrcFilter(e.target.value); resetPage() }}>
            <option value="">Any source</option>
            {CONTACT_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>{sourceTypeLabel(s)}</option>
            ))}
          </Select>
          <Select className="w-full" active={!!vsFilter} value={vsFilter} onChange={(e) => { setVsFilter(e.target.value); resetPage() }}>
            <option value="">Any verification</option>
            {VERIFICATION_STATUSES.map((s) => (
              <option key={s} value={s}>{verificationLabel(s)}</option>
            ))}
          </Select>
        </FilterPanel>
        <ResetFiltersButton active={filtersActive} onReset={resetFilters} />
        <span className="ml-auto text-sm text-neutral-500">{totalItems.toLocaleString()} contacts{loading ? ' · loading…' : ''}</span>
        <ActionsMenu
          busy={exportBusy}
          actions={[{
            key: 'export',
            label: 'Export CSV (filtered)',
            count: totalItems,
            description: 'Download every contact in the current filter (all rows, all columns) as a CSV.',
            disabled: exportBusy || totalItems === 0,
            onSelect: exportCsv,
          }]}
        />
      </div>
      {exportMsg && <div className="text-sm text-neutral-600">{exportMsg}</div>}

      {totalItems === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No contacts yet. They’re seeded during club extraction (directory lists/PDFs/detail pages) and Phase-3 site scraping.
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH sortable sorted={sortedOf('club')} onClick={() => toggleSort('club')} className="min-w-[220px]">Club</TH>
              <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
              <TH sortable sorted={sortedOf('email')} onClick={() => toggleSort('email')}>Email</TH>
              <TH sortable sorted={sortedOf('phone')} onClick={() => toggleSort('phone')}>Phone</TH>
              <TH sortable sorted={sortedOf('source')} onClick={() => toggleSort('source')}>From</TH>
              <TH sortable sorted={sortedOf('sourceType')} onClick={() => toggleSort('sourceType')}>Source</TH>
              <TH sortable sorted={sortedOf('verification')} onClick={() => toggleSort('verification')}>Verification</TH>
              <TH sortable sorted={sortedOf('created')} onClick={() => toggleSort('created')}>Created</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((c) => (
              <TR key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                <TD
                  className="min-w-[220px] hover:text-blue-600"
                  onClick={(e) => { e.stopPropagation(); if (c.expand?.club) setOpenClub(c.expand.club) }}
                >
                  <div className="font-medium">{clubLabel(c) || '—'}</div>
                  {c.expand?.club?.name_en && c.expand.club.name_en !== c.expand.club.name && (
                    <div className="text-xs text-neutral-500">{c.expand.club.name}</div>
                  )}
                </TD>
                <TD>
                  <CountryLabel country={clubCountry(c)} />
                  {c.expand?.club?.region && <div className="text-xs text-neutral-500">{c.expand.club.region}</div>}
                </TD>
                <TD>
                  <a className="text-blue-600 hover:underline" href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>{c.email}</a>
                  {(c.name || c.position) && (
                    <div className="text-xs text-neutral-500">{[c.name, c.position].filter(Boolean).join(' · ')}</div>
                  )}
                </TD>
                <TD>{c.phone || '—'}</TD>
                <TD>
                  <Badge tone={c.source_type === 'club_site' ? 'green' : c.source_type === 'manual' ? 'neutral' : 'blue'}>
                    {sourceTypeLabel(c.source_type || 'directory')}
                  </Badge>
                </TD>
                <TD className="max-w-[180px] truncate">
                  {c.source_url ? (
                    <a className="text-blue-600 hover:underline" href={c.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {c.source_url.replace(/^https?:\/\//, '')}
                    </a>
                  ) : <span className="text-neutral-400">—</span>}
                </TD>
                <TD>
                  <Badge tone={c.verification_status === 'verified' ? 'green' : 'neutral'}>
                    {verificationLabel(c.verification_status || 'unverified')}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap text-xs text-neutral-500" title={c.created ? exactTime(c.created) : ''}>
                  {relTime(c.created)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Pagination page={page} perPage={perPage} totalItems={totalItems} totalPages={totalPages}
        onPage={setPage} onPerPage={(n) => { setPerPage(n); resetPage() }} />

      <ContactDetailDialog
        contact={items.find((c) => c.id === openId) ?? null}
        onClose={() => setOpenId(null)}
      />
      <ClubDetailDialog
        club={openClub}
        contactCount={0}
        onClose={() => setOpenClub(null)}
      />
    </div>
  )
}

function ContactDetailDialog({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const club = contact?.expand?.club
  return (
    <Dialog
      open={contact != null}
      onClose={onClose}
      header={
        contact && (
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900">{contact.email}</h2>
            <Badge tone={contact.verification_status === 'verified' ? 'green' : 'neutral'}>
              {verificationLabel(contact.verification_status || 'unverified')}
            </Badge>
            {contact.quality && <Badge tone="blue">Quality {contact.quality}</Badge>}
          </div>
        )
      }
    >
      {contact && (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Club</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Club" value={club?.name} />
              <DialogField label="Country" value={withFlag(club?.country)} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Contact</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Email" value={contact.email} />
              <DialogField label="Name" value={contact.name} />
              <DialogField label="Position" value={contact.position} />
              <DialogField label="Phone" value={contact.phone} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Provenance</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DialogField label="Source type" value={sourceTypeLabel(contact.source_type)} />
              <DialogField label="Source URL" value={contact.source_url} link />
              <DialogField label="Verification" value={verificationLabel(contact.verification_status)} />
              <DialogField label="Verified at" value={contact.verified_at} />
            </dl>
            {contact.notes && (
              <div className="mt-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-neutral-900">{contact.notes}</dd>
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}
