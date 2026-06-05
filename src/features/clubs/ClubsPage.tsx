import { useMemo, useState } from 'react'
import { type Club } from '@/lib/pb'
import { useCollection } from '@/hooks/useCollection'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge, statusTone } from '@/components/ui/badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type SortKey = 'name' | 'country' | 'region' | 'city' | 'status'

export function ClubsPage() {
  const { items, loading, error } = useCollection<Club>('clubs', 'name')
  const [q, setQ] = useState('')
  const [hasSite, setHasSite] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = items.filter((c) => {
      if (hasSite === 'yes' && !c.website_url) return false
      if (hasSite === 'no' && c.website_url) return false
      if (needle && !`${c.name} ${c.country} ${c.region} ${c.city}`.toLowerCase().includes(needle)) return false
      return true
    })
    out = [...out].sort((a, b) => {
      const av = (a[sort.key] ?? '').toString().toLowerCase()
      const bv = (b[sort.key] ?? '').toString().toLowerCase()
      return (av < bv ? -1 : av > bv ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1)
    })
    return out
  }, [items, q, hasSite, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }
  const sortedOf = (key: SortKey) => (sort.key === key ? sort.dir : (false as const))

  if (error) return <div className="p-6 text-sm text-red-600">Failed to load clubs: {error}</div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search club / city / region…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={hasSite} onChange={(e) => setHasSite(e.target.value)}>
          <option value="">Any website</option>
          <option value="yes">Has website</option>
          <option value="no">No website</option>
        </Select>
        <span className="ml-auto text-sm text-neutral-500">{rows.length} / {items.length}{loading ? ' · loading…' : ''}</span>
      </div>

      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          No clubs yet. Trigger “Discover clubs” on a federation to populate this.
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH sortable sorted={sortedOf('name')} onClick={() => toggleSort('name')}>Club</TH>
              <TH sortable sorted={sortedOf('country')} onClick={() => toggleSort('country')}>Country</TH>
              <TH sortable sorted={sortedOf('region')} onClick={() => toggleSort('region')}>Region</TH>
              <TH sortable sorted={sortedOf('city')} onClick={() => toggleSort('city')}>City</TH>
              <TH>Website</TH>
              <TH sortable sorted={sortedOf('status')} onClick={() => toggleSort('status')}>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.name}</TD>
                <TD>{c.country}</TD>
                <TD>{c.region || '—'}</TD>
                <TD>{c.city || '—'}</TD>
                <TD className="max-w-[200px] truncate">
                  {c.website_url ? (
                    <a className="text-blue-600 hover:underline" href={c.website_url} target="_blank" rel="noreferrer">
                      {c.website_url.replace(/^https?:\/\//, '')}
                    </a>
                  ) : <span className="text-neutral-400">none</span>}
                </TD>
                <TD>{c.status ? <Badge tone={statusTone(c.status)}>{c.status}</Badge> : '—'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
