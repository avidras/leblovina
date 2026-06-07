import { useCallback, useEffect, useMemo, useState } from 'react'
import { pb } from '@/lib/pb'

// Count of discovered club rows per federation id, scoped to the given
// (visible-page) federation ids so we don't load the whole clubs collection.
// Live-refetches (debounced) on realtime club events. Empty ids → {}.
export function useClubCountsByFederation(federationIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  // Stable dependency key — the array identity changes every render.
  const key = useMemo(() => federationIds.join(','), [federationIds])

  const load = useCallback(async () => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) {
      setCounts({})
      return
    }
    try {
      const filter = ids.map((id) => pb.filter('federation = {:id}', { id })).join(' || ')
      const list = await pb
        .collection('clubs')
        .getFullList<{ federation: string }>({ batch: 500, fields: 'federation', filter })
      const next: Record<string, number> = {}
      for (const c of list) {
        if (c.federation) next[c.federation] = (next[c.federation] || 0) + 1
      }
      setCounts(next)
    } catch {
      /* non-fatal: counts just stay as they were */
    }
  }, [key])

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
