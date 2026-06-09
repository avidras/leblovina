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
// `search` = found by search-led discovery ("No federation – Google"); see
// specs/search-led-discovery.md. Lower-trust until vetted (status='needs_review').
export type WebsiteSource = 'official_list' | 'serper' | 'manual' | 'none' | 'search' | 'tournament'
export const WEBSITE_SOURCES: WebsiteSource[] = ['official_list', 'serper', 'manual', 'none', 'search', 'tournament']
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
  // Tournament-discovered clubs belong to a tournament instead of a federation (federation is
  // optional). See specs/tournament-led-discovery.md.
  tournament: string
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

// Mirrors the `scrape_queue` collection — the site-scrape work queue drained by the
// `scrape-queue-drain` cron. See specs/club-scrape-queue.md.
export type ScrapeQueueStatus = 'queued' | 'processing' | 'done' | 'error'
export interface ScrapeQueue {
  id: string
  club: string
  status: ScrapeQueueStatus | ''
  force: boolean
  enqueued_at: string
  processed_at: string
  attempts: number
  created: string
  updated: string
}

// Mirrors the `search_keywords` collection — the keyword registry + per-keyword
// tracking log drained by the `search-discover-drain` cron. See
// specs/search-led-discovery.md.
export type SearchKeywordStatus = 'pending' | 'searching' | 'searched' | 'error'
// Discovery v2: which collection a keyword fills. 'clubs' = default/current; 'tournaments'
// lights up when that processor lands. See specs/search-led-discovery.md ("Generalization v2").
export type SearchTarget = 'clubs' | 'tournaments'
export const SEARCH_TARGETS: SearchTarget[] = ['clubs', 'tournaments']
export interface SearchKeyword {
  id: string
  keyword: string
  target: SearchTarget | ''
  country: string
  lang: string
  status: SearchKeywordStatus | ''
  searched_at: string
  results_count: number
  accepted_count: number
  new_clubs: number
  dup_count: number
  attempts: number
  notes: string
  created: string
  updated: string
}

// Mirrors the `tournaments` collection — discovered tournament entities (the tournament
// lead route). Keywords live in `search_keywords` (target='tournaments'); the processor
// creates a tournament row per found event. See specs/tournament-led-discovery.md.
export type TournamentStatus =
  | 'pending' | 'searching' | 'found' | 'extracted' | 'no_participants' | 'error' | 'needs_review'
export interface Tournament {
  id: string
  name: string
  keyword: string
  country: string
  website_url: string
  participants_url: string
  platform: string
  status: TournamentStatus | ''
  source: 'google' | 'manual' | ''
  results_count: number
  participants_count: number
  clubs_found: number
  attempts: number
  last_run: string
  notes: string
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
