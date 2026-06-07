import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'

// Total record count for a collection (one cheap getList(1,1) query), live-updated
// on realtime events. Returns null until the first count lands. Used for the nav chips.
export function useCollectionTotal(collection: string): number | null {
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async () => {
      try {
        const res = await pb.collection(collection).getList(1, 1, { fields: 'id' })
        if (alive) setTotal(res.totalItems)
      } catch {
        /* non-fatal */
      }
    }
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 300)
    }
    load()
    pb.collection(collection).subscribe('*', debouncedLoad).catch(() => {})
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      pb.collection(collection).unsubscribe('*').catch(() => {})
    }
  }, [collection])

  return total
}
