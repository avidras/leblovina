import { useMemo, useState } from 'react'
import { type Contact, VERIFICATION_STATUSES, CONTACT_SOURCE_TYPES } from '@/lib/pb'
import { useCollection } from '@/hooks/useCollection'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type SortKey = 'club' | 'country' | 'email' | 'position'

export function ContactsPage({ initialClub }: { initialClub?: string | null } = {}) {
  const { items, loading, error } = useCollection<Contact>('contacts', '-created', 'club')
  const [q, setQ] = useState('')
  const [club, setClub] = useState(initialClub ?? '')
  const [vsFilter, setVsFilter] = useState('')
  const [srcFilter, setSrcFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'club', dir: 'asc' })

  const clubName = (c: Contact) => c.expand?.club?.name ?? ''
  const clubCountry = (c: Contact) => c.expand?.club?.country ?? ''

  // when arriving via a club drill-down, show the club's name in the chip
  const activeClubName = useMemo(
    () => (club ? items.find((c) => c.club === club)?.expand?.club?.name ?? club : ''),
    [club, items],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = items.filter((c) => {
      if (club && c.club !== club) return false
      if (vsFilter && (c.verification_status || 'unverified') !== vsFilter) return false
      if (srcFilter && (c.source_type || 'directory') !== srcFilter) return false
      if (needle && !`${c.email} ${clubName(c)} ${c.position} ${c.phone} ${clubCountry(c)}`.toLowerCase().includes(needle))
        return false
      return true
    })
    out = [...out].sort((a, b) => {
      const get = (c: Contact) =>
        (sort.key === 'club' ? clubName(c) : sort.key === 'country' ? clubCountry(c) : (c[sort.key] ?? '')).toString().toLowerCase()
      const av = get(a), bv = get(b)
      return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1)
    })
    return out
  }, [items, q, club, vsFilter, srcFilter, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load contacts: {error}</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search email / club / position…" value={q} onChange={(e) => setQ(e.target.value)} />
        {club && (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
            onClick={() => setClub('')}
            title="Clear club filter"
          >
            Club: <span className="font-medium">{activeClubName}</span>
            <span aria-hidden className="text-neutral-400">✕</span>
          </button>
        )}
        <Select value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)}>
          <option value="">Any source</option>
          {CONTACT_SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={vsFilter} onChange={(e) => setVsFilter(e.target.value)}>
          <option value="">Any verification</option>
          {VERIFICATION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <span className="ml-auto text-sm text-neutral-500">{rows.length} / {items.length}{loading ? ' · loading…' : ''}</span>
      </div>

      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No contacts yet. They’re seeded during club extraction (directory lists/PDFs/detail pages) and Phase-3 site scraping.
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH sortable sorted={sortedOf('club')} onClick={() => toggleSort('club')}>Club</TH>
              <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
              <TH sortable sorted={sortedOf('email')} onClick={() => toggleSort('email')}>Email</TH>
              <TH sortable sorted={sortedOf('position')} onClick={() => toggleSort('position')}>Position</TH>
              <TH>Phone</TH>
              <TH>From</TH>
              <TH>Source</TH>
              <TH>Verification</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{clubName(c) || '—'}</TD>
                <TD>{clubCountry(c) || '—'}</TD>
                <TD>
                  <a className="text-blue-600 hover:underline" href={`mailto:${c.email}`}>{c.email}</a>
                </TD>
                <TD>{c.position || '—'}</TD>
                <TD>{c.phone || '—'}</TD>
                <TD>
                  <Badge tone={c.source_type === 'club_site' ? 'green' : c.source_type === 'manual' ? 'neutral' : 'blue'}>
                    {c.source_type === 'club_site' ? 'club site' : c.source_type || 'directory'}
                  </Badge>
                </TD>
                <TD className="max-w-[180px] truncate">
                  {c.source_url ? (
                    <a className="text-blue-600 hover:underline" href={c.source_url} target="_blank" rel="noreferrer">
                      {c.source_url.replace(/^https?:\/\//, '')}
                    </a>
                  ) : <span className="text-neutral-400">—</span>}
                </TD>
                <TD>
                  <Badge tone={c.verification_status === 'verified' ? 'green' : 'neutral'}>
                    {c.verification_status || 'unverified'}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
