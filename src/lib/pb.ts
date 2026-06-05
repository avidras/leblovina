import PocketBase from 'pocketbase'

// In production PocketBase serves this SPA, so the API is same-origin. In dev,
// VITE_PB_URL points at the local PocketBase (see .env.example).
const url = import.meta.env.VITE_PB_URL || window.location.origin

export const pb = new PocketBase(url)

export type Confederation = 'CEV' | 'AVC' | 'CAVB' | 'NORCECA' | 'CSV'
export type FederationStatus = 'new' | 'scraped' | 'error' | 'needs_review'
export type ExtractionMethod = 'static' | 'js' | 'api_endpoint' | 'pdf' | 'none'

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
  extraction_method: ExtractionMethod | ''
  source_url: string
  status: FederationStatus | ''
  last_scraped: string
  notes: string
  created: string
  updated: string
}
