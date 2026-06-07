// Relative + exact time formatting for the UI (no external deps).

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

// "5 minutes ago", "yesterday", "2 days ago". Empty/invalid → '—'.
export function relTime(iso?: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diffSec = Math.round((t - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === 'second') {
      return RTF.format(Math.round(diffSec / secs), unit)
    }
  }
  return '—'
}

// Exact local datetime for tooltips. Empty/invalid → ''.
export function exactTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
