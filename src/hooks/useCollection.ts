import { useCallback, useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Fetch a full collection (capped) and live-refetch on realtime events.
// Filtering/sorting/search is done client-side in the page (fine at this scale).
export function useCollection<T>(collection: string, sort = '-created', expand?: string) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await pb.collection(collection).getFullList<T>({ sort, batch: 500, expand })
      setItems(list)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [collection, sort, expand])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 250)
    }
    load()
    pb.collection(collection).subscribe('*', debouncedLoad).catch(() => {})
    return () => {
      if (timer) clearTimeout(timer)
      pb.collection(collection).unsubscribe('*').catch(() => {})
    }
  }, [collection, load])

  return { items, loading, error, reload: load }
}
