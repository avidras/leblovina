import PocketBase from 'pocketbase'

// In production PocketBase serves this SPA, so the API is same-origin. In dev,
// VITE_PB_URL points at the local PocketBase (see .env.example).
const url = import.meta.env.VITE_PB_URL || window.location.origin

export const pb = new PocketBase(url)
pb.autoCancellation(false)

export type Confederation = 'CEV' | 'AVC' | 'CAVB' | 'NORCECA' | 'CSV'
export const CONFEDERATIONS: Confederation[] = ['CEV', 'AVC', 'CAVB', 'NORCECA', 'CSV']

export type FederationStatus = 'new' | 'scraped' | 'error' | 'needs_review'
export const FEDERATION_STATUSES: FederationStatus[] = ['new', 'scraped', 'error', 'needs_review']

export type ExtractionMethod = 'static' | 'js' | 'api_endpoint' | 'pdf' | 'none'

export type GateOverride = 'default' | 'always_review' | 'always_auto'
export type GateMode = 'review_all' | 'auto_safe' | 'auto_all'
export const GATE_MODES: GateMode[] = ['review_all', 'auto_safe', 'auto_all']

export interface DirectoryEntry {
  url: string
  region?: string
  extraction_method?: ExtractionMethod
}

// Mirrors the `federations` collection schema (pocketbase/pb_migrations).
export interface Federation {
  id: string
  fivb_code: string
  name: string
  country: string
  confederation: Confederation | ''
  website_url: string
  president: string
  general_secretary: string
  email: string
  phone: string
  club_directory_url: string
  directory_urls: DirectoryEntry[] | null
  extraction_method: ExtractionMethod | ''
  gate_override: GateOverride | ''
  source_url: string
  status: FederationStatus | ''
  last_scraped: string
  notes: string
  created: string
  updated: string
}

export type ClubStatus = 'new' | 'contacts_found' | 'no_contacts' | 'error' | 'needs_review'
export type WebsiteSource = 'official_list' | 'serper' | 'manual' | 'none'
export type WebsiteStatus = 'unknown' | 'live' | 'dead' | 'not_found'
export const WEBSITE_STATUSES: WebsiteStatus[] = ['unknown', 'live', 'dead', 'not_found']

// Orthogonal to website_status (reachability): does the resolved site belong to
// THIS club? A = trusted, B = probable, C = low confidence (review). See
// specs/club-website-belongs-check.md.
export type WebsiteConfidence = 'unknown' | 'A' | 'B' | 'C'
export const WEBSITE_CONFIDENCES: WebsiteConfidence[] = ['unknown', 'A', 'B', 'C']

// What KIND of club the resolved site is. volleyball = dedicated; multisport = a
// multi-sport club with a volleyball section (still a valid lead, target the section).
export type ClubType = 'unknown' | 'volleyball' | 'multisport'
export const CLUB_TYPES: ClubType[] = ['unknown', 'volleyball', 'multisport']

// Mirrors the `clubs` collection schema.
export interface Club {
  id: string
  federation: string
  name: string
  // English/Latin rendering of a non-Latin `name` (romanize + light translate),
  // set by the englishize-clubs workflow. Empty for Latin-script names. UI shows
  // it as primary when present; export's Club column = name_en || name.
  // See specs/club-name-englishization.md.
  name_en: string
  country: string
  region: string
  city: string
  website_url: string
  website_source: WebsiteSource | ''
  website_status: 'unknown' | 'live' | 'dead' | 'not_found' | ''
  website_confidence: WebsiteConfidence | ''
  club_type: ClubType | ''
  source_url: string
  detail_url: string
  source_club_id: string
  dedup_key: string
  status: ClubStatus | ''
  last_scraped: string
  notes: string
  scrape_note: string
  created: string
  updated: string
}

// Mirrors the `scrape_pages` collection — per-page audit trail of a club site-scrape
// (metadata + cleaned text + raw HTML/markdown file). See specs/club-scrape-page-capture.md.
export interface ScrapePage {
  id: string
  club: string
  url: string
  role: 'homepage' | 'candidate' | 'detail' | ''
  method: 'http' | 'firecrawl' | ''
  http_status: number
  bytes: number
  used: boolean
  emails_found: number
  text: string
  raw: string // filename of the attached raw HTML/markdown (empty if upload absent)
  run_at: string
  created: string
  updated: string
}

export type VerificationStatus =
  | 'unverified' | 'mx_only' | 'verified' | 'catch_all' | 'undeliverable' | 'unknown'
export const VERIFICATION_STATUSES: VerificationStatus[] = [
  'unverified', 'mx_only', 'verified', 'catch_all', 'undeliverable', 'unknown',
]

// Provenance: federation directory vs the club's own site (Phase 3) vs manual.
export type ContactSourceType = 'directory' | 'club_site' | 'manual'
export const CONTACT_SOURCE_TYPES: ContactSourceType[] = ['directory', 'club_site', 'manual']

// Mirrors the `contacts` collection schema. clubs 1:N contacts.
export interface Contact {
  id: string
  club: string
  email: string
  name: string
  position: string
  phone: string
  source_url: string
  source_type: ContactSourceType | ''
  verification_status: VerificationStatus | ''
  verified_at: string
  quality: 'A' | 'B' | 'C' | ''
  notes: string
  created: string
  updated: string
  // populated when we fetch with ?expand=club
  expand?: { club?: Club }
}
