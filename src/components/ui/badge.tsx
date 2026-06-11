import * as React from 'react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'green' | 'amber' | 'orange' | 'red' | 'blue'

const tones: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  green: 'bg-green-100 text-green-800 border-green-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  orange: 'bg-orange-100 text-orange-800 border-orange-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

// Map a status string to a tone for consistent coloring across tables.
export function statusTone(status: string): Tone {
  switch (status) {
    case 'scraped':
    case 'contacts_found':
    case 'live':
      return 'green'
    case 'needs_review':
    case 'not_found':
      return 'amber'
    case 'error':
    case 'no_contacts':
    case 'dead':
      return 'red'
    case 'new':
      return 'blue'
    default:
      return 'neutral'
  }
}
