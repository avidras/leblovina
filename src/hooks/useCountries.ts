import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Distinct country names that actually have ≥1 record of the given entity (sorted), to
// populate Country filter dropdowns — so options never return zero results. 'clubs' → club
// countries; 'contacts' → countries of the clubs that have contacts. Cached per source.
type Source = 'clubs' | 'contacts'
const caches: Partial<Record<Source, string[]>> = {}
const inflight: Partial<Record<Source, Promise<string[]>>> = {}

async function fetchCountries(source: Source): Promise<string[]> {
  let names: string[]
  if (source === 'contacts') {
    const list = await pb.collection('contacts').getFullList<{ expand?: { club?: { country?: string } } }>({
      fields: 'expand.club.country', expand: 'club', batch: 500,
    })
    names = list.map((c) => c.expand?.club?.country || '')
  } else {
    const list = await pb.collection('clubs').getFullList<{ country: string }>({ fields: 'country', batch: 500 })
    names = list.map((c) => c.country)
  }
  return Array.from(new Set(names.filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

export function useCountries(source: Source = 'clubs'): string[] {
  const [countries, setCountries] = useState<string[]>(caches[source] ?? [])
  useEffect(() => {
    if (caches[source]) { setCountries(caches[source]!); return }
    let alive = true
    inflight[source] = inflight[source] ?? fetchCountries(source)
    inflight[source]!.then((c) => { caches[source] = c; if (alive) setCountries(c) }).catch(() => { /* non-fatal */ })
    return () => { alive = false }
  }, [source])
  return countries
}
