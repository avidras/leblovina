import { countryFlag } from '@/lib/countries'
import { cn } from '@/lib/utils'

// Renders a country name with its flag emoji prefixed (when known). Falls back to a
// neutral em-dash when empty. Unknown countries render the name with no flag.
export function CountryLabel({
  country,
  className,
  fallback = '—',
}: {
  country?: string | null
  className?: string
  fallback?: string
}) {
  if (!country) return <span className={cn('text-neutral-400', className)}>{fallback}</span>
  const flag = countryFlag(country)
  return (
    <span className={className}>
      {flag && <span className="mr-1.5" aria-hidden>{flag}</span>}
      {country}
    </span>
  )
}
