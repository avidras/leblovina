import { useCallback, useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Count of discovered club rows per federation id. Loads only the `federation`
// field of every club and reduces to a map, then live-refetches (debounced) on
// realtime club events — same shape as useCollection, but aggregated.
export function useClubCountsByFederation(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    try {
      const list = await pb
        .collection('clubs')
        .getFullList<{ federation: string }>({ batch: 500, fields: 'federation' })
      const next: Record<string, number> = {}
      for (const c of list) {
        if (c.federation) next[c.federation] = (next[c.federation] || 0) + 1
      }
      setCounts(next)
    } catch {
      /* non-fatal: counts just stay as they were */
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 250)
    }
    load()
    pb.collection('clubs').subscribe('*', debouncedLoad).catch(() => {})
    return () => {
      if (timer) clearTimeout(timer)
      pb.collection('clubs').unsubscribe('*').catch(() => {})
    }
  }, [load])

  return counts
}
