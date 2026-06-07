import { pb, type Federation } from './pb'

// UI triggers n8n workflows via webhook URLs held in env vars (never hardcoded).
const DISCOVER_CLUBS_URL = import.meta.env.VITE_N8N_DISCOVER_CLUBS_URL as string | undefined
const BATCH_PROCESS_URL = import.meta.env.VITE_N8N_BATCH_PROCESS_URL as string | undefined
const EXTRACT_CLUBS_URL = import.meta.env.VITE_N8N_EXTRACT_CLUBS_URL as string | undefined
const BATCH_ENRICH_URL = import.meta.env.VITE_N8N_BATCH_ENRICH_URL as string | undefined

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
