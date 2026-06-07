---
name: leblovina-remine-directories
description: Re-mine federation directory pages to backfill the per-club data extractors dropped — emails (contacts), website_url, and detail_url — uniformly across all federations. Use for "backfill contacts/websites/detail links from the directories", "we're missing emails that are in the source listing", "re-mine <federation/confederation/all>". One mechanism instead of fixing each extractor; idempotent. Complements the resolver (websites) and the site-scraper (deep crawl): this mines the directory listing itself.
---

# Re-mine directory pages

Extractors historically captured club **names** but dropped the email/website/detail-link that
sit inline in the directory HTML (different extractors dropped different fields → inconsistent
coverage). This re-mines each directory page once and backfills uniformly. Read `leblovina-ops`
first. Spec: `specs/club-directory-remine.md`.

## Mechanism
`extract-directory-data` (`/webhook/extract-directory-data`, returns the result synchronously):
load existing clubs for a `source_url` → fetch the page (links preserved as `[link:URL]`, emails
as `[mail:EMAIL]`) → Gemini extracts per-club `{name, website, detail_url, emails[]}` → match to
the existing club (by `uslug(name)`, or the id in its detail link vs `source_club_id`) → backfill
`website_url` (only if empty), `detail_url` (if empty), and `contacts` (find-or-create by email,
`source_type='directory'`). Idempotent; never overwrites a resolved website; never invents emails.

## Run it
- One page: `POST /webhook/extract-directory-data {"source_url":"<dir url>"}` → returns
  `{matched, unmatched, website_set, detail_set, contacts}`.
- A federation: `{"fedId":"<id>"}` (enumerates that fed's distinct source_urls).
- Everything: `{"all":true}` — or, for visibility/resumability, drive per-page from the CLI over the
  distinct `source_url` set (≈95 pages, conc ~3); log matched/contacts per page. Re-runs converge.

## At extraction time (already wired)
The generic-HTML extractors (`extract-clubs-html`, `extract-clubs-federated`) call this at the end
of their run (after clubs are created), so fresh extractions backfill automatically. process-
federation can't call it inline (extractors run async — clubs don't exist yet), so the hook lives
in the extractors' terminal node. `api`/`pdf`/platform extractors capture structured data already.
If you add a new generic directory extractor, add the same one-liner to its final node.

## Notes / follow-ups
- **`unmatched` rows = clubs on the page the original extractor missed** (e.g. FIPAV Udine: 48 on
  the page, 17 in DB). The re-mine logs these but does NOT create them (avoids dedup_key drift).
  Recovering them is a worthwhile follow-up, gated + only for name-keyed (`<FIVB>:<uslug(name)>`)
  federations.
- Directory pages whose contacts live only on per-club **detail** pages (e.g. DataProject) won't
  yield emails here — `detail_url` gets set and the **site-scraper** harvests those. Compose the two.
- Verify: `contacts` total and per-fed `website_url`/`detail_url` coverage before/after.
