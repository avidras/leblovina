import * as React from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto rounded-lg border border-neutral-200 bg-white">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-neutral-200 bg-neutral-50', className)} {...props} />
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-neutral-100 last:border-0 hover:bg-neutral-50', className)} {...props} />
}

interface THProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean
  sorted?: 'asc' | 'desc' | false
}
export function TH({ className, sortable, sorted, children, ...props }: THProps) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-left align-middle font-medium text-neutral-500 whitespace-nowrap',
        sortable && 'cursor-pointer select-none hover:text-neutral-900',
        className,
      )}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sorted === 'asc' && <span aria-hidden>▲</span>}
        {sorted === 'desc' && <span aria-hidden>▼</span>}
      </span>
    </th>
  )
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />
}
