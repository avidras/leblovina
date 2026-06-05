import * as React from 'react'
import { cn } from '@/lib/utils'

type Side = 'top' | 'bottom'

// Lightweight JS-driven tooltip (no native title, no Radix). Shows `content` on
// hover/focus of the wrapped child. The trigger element must accept a ref/handlers,
// so wrap it in an inline-block span that owns the hover state and positioning.
export function Tooltip({
  content,
  side = 'top',
  delay = 150,
  className,
  children,
}: {
  content: React.ReactNode
  side?: Side
  delay?: number
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && content != null && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-md bg-neutral-900 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-white shadow-md',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
