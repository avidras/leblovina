import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Distinct country names (sorted) drawn from the federations collection — used to populate
// the Country filter dropdowns on the Clubs and Contacts lists. One fetch (≤218 rows).
export function useCountries(): string[] {
  const [countries, setCountries] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await pb.collection('federations').getFullList<{ country: string }>({
          fields: 'country', batch: 500,
        })
        const set = new Set(list.map((f) => f.country).filter(Boolean))
        if (alive) setCountries(Array.from(set).sort((a, b) => a.localeCompare(b)))
      } catch { /* non-fatal */ }
    })()
    return () => { alive = false }
  }, [])
  return countries
}
