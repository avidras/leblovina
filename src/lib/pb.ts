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

// Mirrors the `clubs` collection schema.
export interface Club {
  id: string
  federation: string
  name: string
  country: string
  region: string
  city: string
  website_url: string
  website_source: WebsiteSource | ''
  website_status: 'unknown' | 'live' | 'dead' | 'not_found' | ''
  source_url: string
  detail_url: string
  source_club_id: string
  dedup_key: string
  status: ClubStatus | ''
  last_scraped: string
  notes: string
  created: string
  updated: string
}
