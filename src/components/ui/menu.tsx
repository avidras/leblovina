import * as React from 'react'
import { cn } from '@/lib/utils'

export interface MenuAction {
  key: string
  label: string
  description?: string
  count?: number
  disabled?: boolean
  onSelect: () => void
}

// A kebab (⋮) button that opens a dropdown of list-level batch actions. Each item
// shows label + optional (count) + a muted description line. Closes on outside
// click / Escape. Lightweight (no Radix) — matches the rest of components/ui.
export function ActionsMenu({
  actions,
  label = 'Actions',
  busy = false,
  align = 'right',
}: {
  actions: MenuAction[]
  label?: string
  busy?: boolean
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 bg-white text-neutral-700 shadow-sm hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? <SpinnerIcon /> : <KebabIcon />}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 mt-1 w-72 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {actions.map((a, i) => (
            <button
              key={a.key}
              role="menuitem"
              type="button"
              disabled={a.disabled}
              onClick={() => {
                setOpen(false)
                a.onSelect()
              }}
              className={cn(
                'block w-full px-3 py-2 text-left hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                i > 0 && 'border-t border-neutral-100',
              )}
            >
              <div className="flex items-center justify-between gap-3 text-sm font-medium text-neutral-900">
                <span>{a.label}</span>
                {a.count != null && <span className="tabular-nums text-neutral-500">({a.count})</span>}
              </div>
              {a.description && <div className="mt-0.5 text-xs leading-snug text-neutral-500">{a.description}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  )
}
