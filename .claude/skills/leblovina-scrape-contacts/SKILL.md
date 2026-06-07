---
name: leblovina-scrape-contacts
description: Crawl club WEBSITES and federation detail pages to extract real contacts into the contacts collection (source_type club_site/directory) via the site-scrape driver/worker. Use for "scrape contacts for <country/CEV>", "full site scrape the A/B clubs", "scrape this one club's contacts", "harvest contacts from federation detail pages". Targets trusted (A/B) live sites + any club with a federation detail page; skips already-scraped; gates out low-confidence (C) unless forced. Resolve websites first (leblovina-resolve-websites) so it crawls the right URLs.
---

# Scrape club contacts

Phase-5 contact harvesting from club sites + federation detail pages, into `contacts`. Read
`leblovina-ops` first. Context: `specs/club-site-contact-scraper.md`.

## How it works
`site-scrape-driver` lists target clubs → fans out to `site-scrape-club` (bounded concurrency).
The worker: plain-HTTP-first homepage fetch (Firecrawl only for JS shells) → seeds candidate
pages from `contact_url`/`section_url` + discovered contact/about/team links → fetches the
federation `detail_url` too → Gemini 2.5 Flash extracts `{email,name,position,phone,source}` →
upserts `contacts` (find-or-create by email; `source_type='club_site'`, or `'directory'` for
detail-page contacts) → sets club `status` (`contacts_found`/`no_contacts`/`error`) +
`last_scraped` + `scrape_note`.

## Trigger
- **Batch (driver):** `POST /webhook/site-scrape-driver {ids[], force?, onlyNew?, limit?}`.
  - `ids` → scrape exactly those (UI passes filtered ids). No `ids` → all live clubs; add
    `onlyNew:true` to skip already-scraped, `limit:N` to cap.
  - `force:true` → scrape even confidence-C sites (otherwise C is gated out).
- **One club (worker):** `POST /webhook/site-scrape-club {id, force?}` (force overrides the C gate).
- **Target set (mirror the UI default):** trusted live sites **plus** any club with a detail page,
  excluding done ones:
  `(website_status='live' && (website_confidence='A'||'B')) || detail_url!=''`
  `&& status!='contacts_found' && status!='no_contacts'`. Build ids per federation and pass them.

## Scale & verify
- Driver is sequential per execution; for thousands, drive `/webhook/site-scrape-club` yourself
  with bounded concurrency (≈conc 6), resumable (re-query the not-yet-scraped set). Idempotent —
  contacts upsert by unique `email`.
- Verify: `count('contacts','')` before/after, and per-status club counts
  (`status='contacts_found'` vs `'no_contacts'` vs `'error'`). `'error'` = fetch failed
  (anti-bot/JS) → candidates for an Apify escalation later.

## Gotchas
- **Resolve first.** Garbage URL in → garbage contacts out; the C gate + A/B targeting exist to
  avoid harvesting wrong-club/aggregator contacts. Run `leblovina-resolve-websites` (and the
  aggregator cleanup) before a big scrape.
- Detail pages carry the federation's own boilerplate emails — the worker prompt excludes them;
  if you tweak the worker, keep that exclusion and keep `n8n/site-scrape-club.json` in sync.
- Never invent emails (domain rule #1). Form-only clubs (no email) → `no_contacts`, not faked.
