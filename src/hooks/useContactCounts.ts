import { useCallback, useEffect, useMemo, useState } from 'react'
import { pb } from '@/lib/pb'

// Count of contacts per club id, scoped to the given (visible-page) club ids so
// we don't load the whole contacts collection. Live-refetches (debounced) on
// realtime contact events. Empty ids → {}.
export function useContactCountsByClub(clubIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  // Stable dependency key — the array identity changes every render.
  const key = useMemo(() => clubIds.join(','), [clubIds])

  const load = useCallback(async () => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setCounts({})
      return
    }
    try {
      const filter = ids.map((id) => pb.filter('club = {:id}', { id })).join(' || ')
      const list = await pb
        .collection('contacts')
        .getFullList<{ club: string }>({ batch: 500, fields: 'club', filter })
      const next: Record<string, number> = {}
      for (const c of list) {
        if (c.club) next[c.club] = (next[c.club] || 0) + 1
      }
      setCounts(next)
    } catch {
      /* non-fatal */
    }
  }, [key])

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
