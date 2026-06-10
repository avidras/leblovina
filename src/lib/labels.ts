// Human-readable labels for the raw enum tokens stored in the DB. Display-only:
// the underlying values (DB writes, filter params, <option value>) never change.
// Each helper returns the mapped label or a humanized fallback, so an unmapped or
// newly-added value still renders readably instead of leaking a raw token.

// Generic snake_case/kebab → "Title Case" fallback for any value without an explicit label.
export function humanize(v: string | null | undefined): string {
  if (!v) return ''
  return v.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function lookup(map: Record<string, string>, v: string | null | undefined): string {
  if (!v) return ''
  return map[v] ?? humanize(v)
}

// Federation + club statuses (overlap on new/error/needs_review; no conflicts).
const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  scraped: 'Scraped',
  error: 'Error',
  needs_review: 'Needs Review',
  contacts_found: 'Contacts Found',
  no_contacts: 'No Contacts',
}
export const statusLabel = (s: string | null | undefined) => lookup(STATUS_LABELS, s)

const WEBSITE_STATUS_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  live: 'Live',
  dead: 'Dead',
  not_found: 'Not found on Google',
}
export const websiteStatusLabel = (s: string | null | undefined) => lookup(WEBSITE_STATUS_LABELS, s)

const WEBSITE_SOURCE_LABELS: Record<string, string> = {
  official_list: 'Official list',
  serper: 'Serper',
  manual: 'Manual',
  none: 'None',
}
export const websiteSourceLabel = (s: string | null | undefined) => lookup(WEBSITE_SOURCE_LABELS, s)

// A/B/C are kept as letter grades; only `unknown` gets a word.
const CONFIDENCE_LABELS: Record<string, string> = {
  unknown: 'Unchecked',
  A: 'A',
  B: 'B',
  C: 'C',
}
export const confidenceLabel = (s: string | null | undefined) => lookup(CONFIDENCE_LABELS, s)

// Hover explanation for a given website-confidence grade (the post-resolve
// "does this site belong to the club?" check). See specs/club-website-belongs-check.md.
const CONFIDENCE_HELP: Record<string, string> = {
  A: 'A — Trusted: strong evidence the resolved site is this club’s own (or it came from an official/manual source).',
  B: 'B — Probable: likely the club’s site, but the match isn’t fully certain.',
  C: 'C — Low confidence: needs review — may be the wrong club, a league/aggregator page, or a parked domain.',
  unknown: 'Unchecked: the belongs-check hasn’t been run on this club’s website yet.',
}
export const confidenceHelp = (s: string | null | undefined) => lookup(CONFIDENCE_HELP, s)

const CLUB_TYPE_LABELS: Record<string, string> = {
  unknown: 'Unclassified',
  volleyball: 'Volleyball',
  multisport: 'Multi-sport',
}
export const clubTypeLabel = (s: string | null | undefined) => lookup(CLUB_TYPE_LABELS, s)

const VERIFICATION_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  mx_only: 'MX only',
  verified: 'Verified',
  catch_all: 'Catch-all',
  undeliverable: 'Undeliverable',
  unknown: 'Unknown',
}
export const verificationLabel = (s: string | null | undefined) => lookup(VERIFICATION_LABELS, s)

const SOURCE_TYPE_LABELS: Record<string, string> = {
  directory: 'Directory',
  club_site: 'Club site',
  manual: 'Manual',
  brevo: 'Brevo',
}
export const sourceTypeLabel = (s: string | null | undefined) => lookup(SOURCE_TYPE_LABELS, s)

const EXTRACTION_METHOD_LABELS: Record<string, string> = {
  static: 'Static',
  js: 'JavaScript',
  api_endpoint: 'API endpoint',
  pdf: 'PDF',
  none: 'None',
}
export const extractionMethodLabel = (s: string | null | undefined) => lookup(EXTRACTION_METHOD_LABELS, s)

const GATE_MODE_LABELS: Record<string, string> = {
  review_all: 'Review all',
  auto_safe: 'Auto (safe)',
  auto_all: 'Auto (all)',
}
export const gateModeLabel = (s: string | null | undefined) => lookup(GATE_MODE_LABELS, s)
