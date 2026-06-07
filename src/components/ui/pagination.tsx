import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

export const PER_PAGE_OPTIONS = [50, 100, 200] as const

// Classic prev/next pager shown under a server-paginated table.
export function Pagination({
  page,
  perPage,
  totalItems,
  totalPages,
  onPage,
  onPerPage,
}: {
  page: number
  perPage: number
  totalItems: number
  totalPages: number
  onPage: (p: number) => void
  onPerPage: (n: number) => void
}) {
  if (totalItems === 0) return null
  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, totalItems)
  const pages = Math.max(totalPages, 1)

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600">
      <span>
        Showing <span className="font-medium text-neutral-900">{from.toLocaleString()}–{to.toLocaleString()}</span> of{' '}
        <span className="font-medium text-neutral-900">{totalItems.toLocaleString()}</span>
      </span>
      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1 text-neutral-500">
          Per page
          <Select
            className="h-8"
            value={perPage}
            onChange={(e) => onPerPage(Number(e.target.value))}
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </label>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ← Prev
        </Button>
        <span className="tabular-nums">Page {page} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next →
        </Button>
      </div>
    </div>
  )
}
