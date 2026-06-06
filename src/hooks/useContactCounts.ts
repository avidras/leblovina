import { useCallback, useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Count of contacts per club id. Loads only the `club` field and live-refetches
// (debounced) on realtime contact events — mirrors useClubCountsByFederation.
export function useContactCountsByClub(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    try {
      const list = await pb
        .collection('contacts')
        .getFullList<{ club: string }>({ batch: 500, fields: 'club' })
      const next: Record<string, number> = {}
      for (const c of list) {
        if (c.club) next[c.club] = (next[c.club] || 0) + 1
      }
      setCounts(next)
    } catch {
      /* non-fatal */
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 250)
    }
    load()
    pb.collection('contacts').subscribe('*', debouncedLoad).catch(() => {})
    return () => {
      if (timer) clearTimeout(timer)
      pb.collection('contacts').unsubscribe('*').catch(() => {})
    }
  }, [load])

  return counts
}
