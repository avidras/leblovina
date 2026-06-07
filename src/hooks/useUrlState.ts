import { useCallback, useEffect, useRef, useState } from 'react'

// Per-user persistence: filter values also mirror into localStorage so they survive across
// sessions/navigation (not just refresh), keyed under a namespace to avoid clobbering.
const LS = 'lbv:'
const lsGet = (k: string): string | null => { try { return localStorage.getItem(LS + k) } catch { return null } }
const lsSet = (k: string, v: string) => { try { if (v) localStorage.setItem(LS + k, v); else localStorage.removeItem(LS + k) } catch { /* ignore */ } }

// Sync a filter value into a URL query param (shareable + survives refresh) AND localStorage
// (survives across sessions). Precedence on init: URL param > localStorage > initial.
export function useUrlState(key: string, initial = ''): [string, (v: string) => void] {
  const [val, setVal] = useState(() => new URLSearchParams(window.location.search).get(key) ?? lsGet(key) ?? initial)
  // If the value came from localStorage (no URL param yet), reflect it into the URL once.
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    synced.current = true
    const urlv = new URLSearchParams(window.location.search).get(key)
    if (urlv == null && val) {
      const p = new URLSearchParams(window.location.search)
      p.set(key, val)
      window.history.replaceState(null, '', window.location.pathname + '?' + p.toString())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const set = useCallback(
    (v: string) => {
      setVal(v)
      const p = new URLSearchParams(window.location.search)
      if (v) p.set(key, v)
      else p.delete(key)
      const qs = p.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''))
      lsSet(key, v)
    },
    [key],
  )
  return [val, set]
}

// localStorage-backed state for non-string UI prefs (e.g. sort {key,dir}). Persists per user.
export function usePersistentState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    const s = lsGet(key)
    if (s == null) return initial
    try { return JSON.parse(s) as T } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(LS + key, JSON.stringify(val)) } catch { /* ignore */ }
  }, [key, val])
  return [val, setVal]
}

// Remove a query param from the URL (and its persisted copy) — e.g. clearing a drill-down chip.
export function clearUrlParam(key: string) {
  const p = new URLSearchParams(window.location.search)
  p.delete(key)
  const qs = p.toString()
  window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''))
  lsSet(key, '')
}
