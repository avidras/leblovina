import { useEffect, useState } from 'react'

// Debounce a fast-changing value (e.g. a search box) before it feeds a query.
// Returns the latest value only after it has been stable for `ms`.
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
