import { pb, type Federation } from './pb'

// UI triggers n8n workflows via webhooks. Each URL defaults to the known n8n instance +
// webhook path, so the buttons work without per-var build args (a recurring deploy footgun:
// Vite only inlines VITE_* present at build time). A VITE_* env var, when set, overrides the
// default (e.g. to point at a different n8n instance).
const N8N_BASE = ((import.meta.env.VITE_N8N_BASE_URL as string | undefined) || 'https://n8n-2.biceps.digital').replace(/\/+$/, '')
const wh = (envVar: unknown, path: string): string => {
  const v = typeof envVar === 'string' ? envVar.trim() : ''
  return v || `${N8N_BASE}/webhook/${path}`
}
const DISCOVER_CLUBS_URL = wh(import.meta.env.VITE_N8N_DISCOVER_CLUBS_URL, 'process-federation')
const BATCH_PROCESS_URL = wh(import.meta.env.VITE_N8N_BATCH_PROCESS_URL, 'batch-process')
const EXTRACT_CLUBS_URL = wh(import.meta.env.VITE_N8N_EXTRACT_CLUBS_URL, 'extract-clubs')
const BATCH_ENRICH_URL = wh(import.meta.env.VITE_N8N_BATCH_ENRICH_URL, 'batch-enrich')
const ENGLISHIZE_CLUBS_URL = wh(import.meta.env.VITE_N8N_ENGLISHIZE_CLUBS_URL, 'englishize-clubs')
const SCRAPE_ENQUEUE_URL = wh(import.meta.env.VITE_N8N_SCRAPE_ENQUEUE_URL, 'scrape-enqueue')
const SITE_SCRAPE_URL = wh(import.meta.env.VITE_N8N_SITE_SCRAPE_URL, 'site-scrape-driver')
const SEARCH_KEYWORDS_URL = wh(import.meta.env.VITE_N8N_SEARCH_KEYWORDS_URL, 'search-keywords-generate')
const VERIFY_CONTACTS_URL = wh(import.meta.env.VITE_N8N_VERIFY_CONTACTS_URL, 'verify-contacts-reoon')
const SYNC_BREVO_URL = wh(import.meta.env.VITE_N8N_SYNC_BREVO_URL, 'sync-contacts-brevo')
const BREVO_BACKFILL_URL = wh(import.meta.env.VITE_N8N_BREVO_BACKFILL_URL, 'brevo-backfill')

export interface TriggerResult {
  ok: boolean
  status: number
  body?: unknown
  error?: string
}

async function postWebhook(url: string, body: unknown, rescrape = false): Promise<TriggerResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(rescrape ? { rescrape: 'true' } : {}) },
      body: JSON.stringify(body),
    })
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      parsed = undefined
    }
    return { ok: res.ok, status: res.status, body: parsed }
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }
}

// Phase 2: discover (and, per the gate, maybe extract) clubs for one federation.
export async function triggerDiscoverClubs(fed: Federation, rescrape = false): Promise<TriggerResult> {
  if (!DISCOVER_CLUBS_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_DISCOVER_CLUBS_URL is not set' }
  }
  // Optimistically reflect that a run was kicked off.
  try {
    await pb.collection('federations').update(fed.id, { status: 'new' })
  } catch {
    /* non-fatal */
  }
  return postWebhook(DISCOVER_CLUBS_URL, { id: fed.id, fivb_code: fed.fivb_code }, rescrape)
}

// Phase 2: batch-process many federations (async — n8n returns immediately, then runs each
// through the gated discover->extract pipeline sequentially in the background).
export async function triggerBatchProcess(ids: string[]): Promise<TriggerResult> {
  if (!BATCH_PROCESS_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_BATCH_PROCESS_URL is not set' }
  }
  return postWebhook(BATCH_PROCESS_URL, { ids })
}

// Re-extract a federation from its already-discovered directory (skips discovery).
export async function triggerExtractFederation(fed: Federation): Promise<TriggerResult> {
  if (!EXTRACT_CLUBS_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_EXTRACT_CLUBS_URL is not set' }
  }
  return postWebhook(EXTRACT_CLUBS_URL, { id: fed.id })
}

// Phase 2.5: batch validate + Serper-resolve websites for clubs (async, background).
// force=true re-resolves clubs even if they already have a live website (fixes wrong
// auto-picked sites); official_list/manual URLs are still protected server-side.
// recheck=true re-runs the "does this site belong to the club?" check on existing live
// serper URLs (sets website_confidence) WITHOUT re-spending Serper. See
// specs/club-website-belongs-check.md.
export async function triggerBatchEnrich(
  ids: string[],
  force = false,
  recheck = false,
): Promise<TriggerResult> {
  if (!BATCH_ENRICH_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_BATCH_ENRICH_URL is not set' }
  }
  return postWebhook(BATCH_ENRICH_URL, { ids, force, recheck })
}

// Generate English/Latin names for clubs whose name is in a non-Latin script
// (async, background). Omit `ids` to process all clubs still missing an English
// name; pass `ids` to scope it. Idempotent. See specs/club-name-englishization.md.
export async function triggerEnglishizeClubs(ids?: string[]): Promise<TriggerResult> {
  if (!ENGLISHIZE_CLUBS_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_ENGLISHIZE_CLUBS_URL is not set' }
  }
  return postWebhook(ENGLISHIZE_CLUBS_URL, ids && ids.length ? { ids } : {})
}

// Phase 5: crawl club websites for contacts (multi-page; Apify/Gemini) and write to
// `contacts` (source_type='club_site'). Pass `ids` to scope to the current Clubs filter;
// omit to run over all live clubs (skipping already-scraped). Async/background.
// See specs/club-site-contact-scraper.md.
export async function triggerSiteScrape(ids?: string[], force = false): Promise<TriggerResult> {
  if (!SITE_SCRAPE_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_SITE_SCRAPE_URL is not set' }
  }
  // force=true scrapes even low-confidence (C) sites — used by the per-club action where the
  // user explicitly picked one club. Batch runs leave force off (C gated out).
  return postWebhook(SITE_SCRAPE_URL, ids && ids.length ? { ids, force } : { onlyNew: true })
}

// Site-scrape via the QUEUE (the reliable, at-scale path): enqueue clubs; the n8n cron
// drains them in bounded chunks with backpressure. Pass `ids` or a PB `filter` to enqueue;
// `clear:true` empties the queued backlog. See specs/club-scrape-queue.md.
export async function triggerScrapeEnqueue(
  opts: { ids?: string[]; filter?: string; force?: boolean; clear?: boolean },
): Promise<TriggerResult> {
  if (!SCRAPE_ENQUEUE_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_SCRAPE_ENQUEUE_URL is not set' }
  }
  return postWebhook(SCRAPE_ENQUEUE_URL, opts)
}

// Discovery v2: generate localized keyword CANDIDATES for a target (returns them; persists
// nothing). The UI shows the candidates so the user can pick which to queue, then creates the
// chosen `search_keywords` rows directly (status='pending'). The `search-discover-drain` cron
// then runs them. See specs/search-led-discovery.md ("Generalization v2").
// Response body: { target, country, count, candidates: [{ keyword, lang }] }.
export async function triggerSearchKeywordsGenerate(
  opts: { target?: 'clubs' | 'tournaments'; country?: string; cities?: string[]; count?: number; breadth?: 'specific' | 'broad'; focus?: string },
): Promise<TriggerResult> {
  if (!SEARCH_KEYWORDS_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_SEARCH_KEYWORDS_URL is not set' }
  }
  return postWebhook(SEARCH_KEYWORDS_URL, { target: 'clubs', ...opts })
}

// Reoon email verification (manual, batch). Verifies the contacts in the current filter
// (or all when omitted), writing verification_status + verified_at back on each. Skips
// anything verified within settings.reoon.reverify_days unless force=true. Reoon bills per
// email — this is an explicit, user-triggered action. See specs/brevo-reoon-integration.md.
export async function triggerVerifyContacts(
  opts: { filter?: string; ids?: string[]; force?: boolean } = {},
): Promise<TriggerResult> {
  if (!VERIFY_CONTACTS_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_VERIFY_CONTACTS_URL is not set' }
  }
  return postWebhook(VERIFY_CONTACTS_URL, opts)
}

// Push our proven-deliverable contacts (verification_status='verified') into the Brevo
// newsletter list (settings.brevo.list_id), upserting attributes. Re-runs update existing
// Brevo contacts. Pass `filter` to scope; omit to sync all verified. The deliverability gate
// is enforced server-side regardless. See specs/brevo-reoon-integration.md.
export async function triggerBrevoSync(opts: { filter?: string } = {}): Promise<TriggerResult> {
  if (!SYNC_BREVO_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_SYNC_BREVO_URL is not set' }
  }
  return postWebhook(SYNC_BREVO_URL, opts)
}

// One-time backfill: import contacts that already exist in Brevo into our DB as
// source_type='brevo' (email only, no club). Idempotent on the email unique index — safe to
// re-run. See specs/brevo-reoon-integration.md.
export async function triggerBrevoBackfill(opts: { list_id?: number } = {}): Promise<TriggerResult> {
  if (!BREVO_BACKFILL_URL) {
    return { ok: false, status: 0, error: 'VITE_N8N_BREVO_BACKFILL_URL is not set' }
  }
  return postWebhook(BREVO_BACKFILL_URL, opts)
}
