import { useCallback, useEffect, useRef, useState } from 'react'
import { pb } from '@/lib/pb'

export interface PagedOptions {
  page: number
  perPage: number
  sort: string
  filter?: string
  expand?: string
}

export interface PagedResult<T> {
  items: T[]
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  loading: boolean
  error: string | null
  reload: () => void
}

// Server-side paginated loader. Pushes filter/sort/page to PocketBase's getList
// instead of fetching the whole collection (see useCollection). Live-refetches
// the *current page* on realtime events. Drops out-of-order responses (global
// autoCancellation is off) via a monotonic request id.
export function usePagedCollection<T>(collection: string, opts: PagedOptions): PagedResult<T> {
  const { page, perPage, sort, filter, expand } = opts
  const [state, setState] = useState<{ items: T[]; totalItems: number; totalPages: number }>({
    items: [],
    totalItems: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const res = await pb.collection(collection).getList<T>(page, perPage, {
        sort,
        filter: filter || undefined,
        expand,
      })
      if (id !== reqId.current) return // a newer request superseded this one
      setState({ items: res.items, totalItems: res.totalItems, totalPages: res.totalPages })
      setError(null)
    } catch (e) {
      if (id !== reqId.current) return
      setError((e as Error).message)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [collection, page, perPage, sort, filter, expand])

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

  return { items: state.items, page, perPage, totalItems: state.totalItems, totalPages: state.totalPages, loading, error, reload: load }
}
