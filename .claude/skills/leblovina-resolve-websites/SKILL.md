---
name: leblovina-resolve-websites
description: Resolve and enrich club WEBSITES — find each club's official site via Serper+AI, grade A/B/C "does it belong", and harvest signals (emails/contact page/socials/language). Drives enrich-club / batch-enrich over a filter (e.g. a confederation/country), in resolve / harvest / recheck modes, plus the cross-club aggregator cleanup. Use for "resolve websites for <country/CEV>", "harvest contact signals on live clubs", "re-check confidence", "clean aggregator URLs". Not the contact crawler — that's leblovina-scrape-contacts.
---

# Resolve & enrich club websites

Stage-3 website resolution + enrichment. Read `leblovina-ops` first. Context:
`specs/club-website-belongs-check.md`, `specs/club-website-enrichment.md`.

## Modes (per club: `POST /webhook/enrich-club {id, force?, recheck?}`)
- **resolve unresolved** — clubs with no live website: Serper(2 queries) + AI pick + validate +
  belongs-check (A/B/C) + harvest. Default when `website_status` is unknown/empty.
- **force** (`force:true`) — re-resolve from scratch even if already live (fixes wrong picks).
  Protected `official_list`/`manual` URLs are kept server-side unless they were auto/empty-sourced.
- **recheck/harvest** (`recheck:true`) — re-run belongs-check on an existing live URL AND harvest
  emails/contact_url/section_url/socials/site_lang — **no Serper spend** (reuses the page fetch).
- Outputs on the club: `website_url`, `website_source`, `website_status`, `website_confidence`
  (A/B/C), `club_type` (volleyball/multisport), plus harvested `website_emails` (hint),
  `contact_url`, `section_url`, `socials`, `site_lang`.

## Batch over a filter (driver fans out per club)
The driver `POST /webhook/batch-enrich {ids, force, recheck}` loops sequentially in the
background — fine for a few hundred. For large sets (thousands), **drive it yourself** with
bounded concurrency calling `/webhook/enrich-club` directly (≈conc 6, ~5s/club), resumable by
re-querying the unresolved/target set. Build the work list per federation to avoid heavy OR
filters. Log A/B/C + email counts; the run is idempotent.
- Target a confederation: get `confederation='CEV'` fed ids → per fed page the clubs you want
  (`website_status='unknown'||''` to resolve; `website_confidence='C'` to re-resolve/clean;
  `website_status='live'` to harvest).

## Quality: aggregator cleanup (run after a large resolve)
The per-club resolver can't see that a host is reused across clubs. Some aggregator/portal/
federation domains (e.g. `sportmap.cz`, `jouevolleyball.fr`, regional associations) resolve —
often to confidence A — for many clubs. After a big run, tally the resolved host across
serper-sourced live clubs and **clear any host used by ≥3 distinct clubs** (set
`website_url=''`, `website_status='not_found'`, reset source/confidence/club_type and harvested
fields). Scope to `website_source='serper'` only (never touch official_list/manual). Log every
flagged host before clearing; it's reversible (re-resolve later).

## Gotchas
- Ecosystem domains (cev.eu, dataproject.com, worldofvolley.com, fivb.*, the federation's own
  domain) are blocked in the resolver; leftover C URLs from older runs self-clean on re-resolve.
- The deployed `enrich-club` workflow and `n8n/enrich-club.json` must stay in sync if you edit it.
- The UI exposes these as Clubs-page actions (Resolve unresolved / Re-resolve all / Re-check
  confidence / Light contact scrape) — the CLI path is for scope/scale the UI can't drive.
