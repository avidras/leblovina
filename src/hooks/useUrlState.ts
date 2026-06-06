import { useCallback, useState } from 'react'

// Sync a filter value into a URL query param so filters survive refresh and are
// shareable. Uses replaceState (no history-entry spam on each keystroke) and
// preserves all other params (view path, country/club drill-downs, sibling filters).
export function useUrlState(key: string, initial = ''): [string, (v: string) => void] {
  const [val, setVal] = useState(() => new URLSearchParams(window.location.search).get(key) ?? initial)
  const set = useCallback(
    (v: string) => {
      setVal(v)
      const p = new URLSearchParams(window.location.search)
      if (v) p.set(key, v)
      else p.delete(key)
      const qs = p.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''))
    },
    [key],
  )
  return [val, set]
}

// Remove a query param from the URL (e.g. when clearing a drill-down chip).
export function clearUrlParam(key: string) {
  const p = new URLSearchParams(window.location.search)
  p.delete(key)
  const qs = p.toString()
  window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''))
}
