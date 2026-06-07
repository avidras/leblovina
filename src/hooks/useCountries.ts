import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Distinct country names that actually have ≥1 club (sorted) — populates the Country filter
// dropdowns on Clubs and Contacts (a contact's country is its club's country, so the set of
// club countries is the right universe for both). Fetched once and cached module-level.
let cache: string[] | null = null
let inflight: Promise<string[]> | null = null

async function fetchClubCountries(): Promise<string[]> {
  const list = await pb.collection('clubs').getFullList<{ country: string }>({ fields: 'country', batch: 500 })
  const set = new Set(list.map((c) => c.country).filter(Boolean))
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function useCountries(): string[] {
  const [countries, setCountries] = useState<string[]>(cache ?? [])
  useEffect(() => {
    if (cache) { setCountries(cache); return }
    let alive = true
    inflight = inflight ?? fetchClubCountries()
    inflight.then((c) => { cache = c; if (alive) setCountries(c) }).catch(() => { /* non-fatal */ })
    return () => { alive = false }
  }, [])
  return countries
}
