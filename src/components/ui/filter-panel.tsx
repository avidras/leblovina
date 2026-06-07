import * as React from 'react'
import { cn } from '@/lib/utils'

// A "Filters" button that opens a dropdown panel holding the list's filter controls.
// Shows an active state + a badge with the number of active filters. Closes on outside
// click / Escape. Matches the lightweight ActionsMenu pattern (no Radix).
export function FilterPanel({
  activeCount = 0,
  children,
  label = 'Filters',
}: {
  activeCount?: number
  children: React.ReactNode
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
          activeCount > 0
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50',
        )}
      >
        <FilterIcon />
        {label}
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-medium text-white">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" className="absolute left-0 z-50 mt-1 flex w-64 flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3 shadow-lg">
          {children}
        </div>
      )}
    </div>
  )
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 4h18l-7 8v6l-4 2v-8z" />
    </svg>
  )
}
