import * as React from 'react'
import { cn } from '@/lib/utils'

// Lightweight JS-driven modal (no Radix, no portal). Renders a fixed overlay with a
// centered panel; closes on backdrop click, the header ×, or Escape. Locks body scroll
// while open. Returns null when closed.
export function Dialog({
  open,
  onClose,
  title,
  header,
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  header?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-neutral-900/40" onClick={onClose} aria-hidden />
      <div
        className={cn(
          'relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3">
          <div className="min-w-0">{header ?? <h2 className="text-base font-semibold text-neutral-900">{title}</h2>}</div>
          <button
            className="-mr-1 shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-neutral-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

// A labelled field for the definition grid inside a Dialog body.
export function DialogField({ label, value, link }: { label: string; value?: string; link?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-neutral-900">
        {value
          ? link
            ? <a className="text-blue-600 hover:underline" href={value} target="_blank" rel="noreferrer">{value}</a>
            : value
          : <span className="text-neutral-400">—</span>}
      </dd>
    </div>
  )
}
