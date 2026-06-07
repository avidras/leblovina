import * as React from 'react'
import { cn } from '@/lib/utils'

// Lightweight native select styled to match the shadcn look (keeps the harness simple).
// `active` gives a subtle highlight (blue border/tint) so a filter set to a non-default
// value is visible at a glance when the filter panel is open — matches the Filters button cue.
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { active?: boolean }
>(({ className, children, active = false, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-9 rounded-md border px-2 text-sm shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
      'disabled:cursor-not-allowed disabled:opacity-50',
      active ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-neutral-300 bg-white',
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'
