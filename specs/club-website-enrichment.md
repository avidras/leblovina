# Spec: Resolve-time website enrichment (signals + better URLs + fallback)

Raise the quality of the resolved-website list and pre-load Phase-3 contact extraction by
mining the page we already fetch, picking better URLs, and falling back to other search
results when the first pick is a miss. Extends Stage 3 of
[`club-discovery.md`](./club-discovery.md), the [`club-website-belongs-check.md`](./club-website-belongs-check.md)
flow, and the deployed `n8n/enrich-club.json` workflow.

## Why (the gap this closes)

`Resolve site` already downloads the full HTML of the chosen candidate and extracts
`title/og/h1/excerpt` — then **discards all of it** except the ambiguous-only LLM call.
`Patch` persists only `website_url/source/status/confidence/club_type`. Four concrete losses:

1. **Discarded page = discarded contacts.** The club's own homepage is the richest, cheapest
   contact surface we will ever hold, and it is already in memory. Emails / contact-page link
   / socials / language can be harvested for **$0** and handed to Phase 3.
2. **URL collapsed to bare root.** `const cand='https://'+host` strips the path, so a
   multisport club's *volleyball-section* page (the page Phase 3 most wants) is overwritten
   by the generic homepage. `www`/`http`-only sites and post-redirect canonical URLs are also
   lost.
3. **One candidate, one shot.** If the single LLM pick fails the live/belongs check we fall
   straight to `not_found`, ignoring the other ranked Serper results already fetched.
4. **Rigid query.** Always `name + city + country + "volleyball"`; a multisport club's
   official site often will not rank for "volleyball", so we never see it.

## Decisions (from interactive Q&A)

1. **Scope = A + B + C + D**, plus a **major re-resolve** that also upgrades already-resolved
   clubs.
2. **Harvested signals land on the `clubs` row** (enrichment metadata), **not** the `contacts`
   collection — keeps this in-bounds and out of Phase-3 contact-state. Phase 3 reads them as a
   head start. (Domain rule #1 respected: emails are *deterministically extracted from a real
   page*, never guessed.)
3. **Keep `website_url` = canonical homepage root; store the deep/section link separately**
   (`section_url`) so existing consumers (export "Website" column, Phase-3 keying) are
   unaffected while the section page is preserved.
4. **Backfill via the existing batch + `recheck=true`** — re-running the resolve over already
   resolved clubs now also harvests signals and canonicalizes, no new spend path.

## A — Harvest page signals (on the already-fetched body, $0)

When we end with a live `body`, run a deterministic harvest:

- **Emails** — `mailto:` hrefs + a plain-text email regex over the de-scripted body.
  Lowercased, deduped, junk-filtered (image extensions, `example.`, `sentry`, `wixpress`,
  `your-email`, `test@`, …), capped at 15. Stored in `website_emails` (json array).
- **Contact-page URL** — first anchor whose href/label matches
  `kontakt|contact|impressum|imprint|about|o-nas|chi-siamo|contatti|contacto|mentions-legales|…`,
  resolved to absolute. Stored in `contact_url`.
- **Socials** — first profile URL per network (facebook/instagram/youtube/tiktok/twitter-x/
  linkedin). Stored in `socials` (json object).
- **Language** — `<html lang>` or `og:locale` 2-letter code. Stored in `site_lang`.

Harvest is **source-agnostic** (also runs on `official_list`/`manual` sites when a body is
fetched) — emails are valuable regardless of provenance. Only written when a real body
(>200 chars) was fetched, so a no-fetch fast-path run never blanks prior values.

## B — Better URLs (canonical root + section link)

- **www/http fallback + canonicalization.** Try `https://<host>`, then `https://www.<host>`,
  then `http://<host>`; keep whichever is live. Prefer the `<link rel="canonical">` host
  variant when present and same registrable host (fixes www vs non-www). `website_url` = this
  canonical root.
- **`section_url`** — when the picked/accepted candidate URL had a path beyond `/` (e.g.
  `…/abteilungen/volleyball`), store the full deep link in `section_url`. Empty when the pick
  was already the root. Phase 3 prefers `section_url` when set.

n8n's HTTP helper does not reliably expose the final post-redirect URL, so redirect handling
is done via the explicit www/http probes + the canonical tag (both $0 / cheap), not by reading
axios internals.

## C — Next-best-result fallback

`Resolve site` builds an ordered candidate list: **[LLM pick] + [query-1 organic links] +
[query-2 organic links]**, deduped by host, blocklist-filtered. It walks the list (cap **5**
fetches; log how many tried — no silent truncation) and:

- accepts the **first live candidate that has a volleyball signal and is not parked/directory**
  (→ evaluated as strong/ambiguous as today); else
- keeps the **first live candidate** as a best-effort fallback (graded down the existing
  belongs path — e.g. `novb` ⇒ `C`); else
- `not_found` / `dead`.

Because the LLM pick is first, a good pick still wins immediately; the fallback only engages
when the pick is a hard miss.

## D — Requery without "volleyball"

`Validate` emits a second query `query2 = name + city + country` (no sport term). A second
Serper node (**Serper Search 2**) runs it. Its `organic` results feed **only** the C fallback
pool — **Pick site still sees only the volleyball-query results**, preserving its precision.
Cost: +1 Serper credit per run (Serper is ~$0.001/query; ~$8 one-time over the full backlog).
Both Serper nodes are `onError: continueRegularOutput` so a search failure degrades to the
other query / `not_found` rather than crashing.

## Major re-resolve (upgrade already-resolved clubs)

The existing `recheck=true` flag (belongs-check an existing live URL without re-spending
Serper) is extended: on the fast path (`!needsResolve`), when `recheck` is set we now **fetch
the current URL, harvest signals (A), and run the belongs check** — so a batch re-run over
already-resolved clubs back-fills `website_emails/contact_url/socials/site_lang` and refreshes
confidence. To keep trusted provenance stable, the fast path does **not** rewrite
`website_url` (no re-rooting/section split for already-stored URLs); it only adds signals.
`force=true` still re-resolves auto/empty-sourced clubs from scratch (full A+B+C+D path).

Backfill = drive the existing Clubs-page batch with `recheck=true` (optionally filtered), exactly
as the belongs-check backfill did. Log A/B/C + harvested-email counts.

## New `clubs` fields (migration)

`<ts>_clubs_enrichment.js` (idempotent, one migration):

| field            | type | notes |
|------------------|------|-------|
| `website_emails` | json | deterministically-found emails from the resolved page (array) |
| `contact_url`    | url  | best contact/impressum/about page link |
| `socials`        | json | `{facebook,instagram,youtube,tiktok,twitter,linkedin}` (present keys only) |
| `site_lang`      | text | 2-letter page language |
| `section_url`    | url  | volleyball-section / deep link when distinct from the root |

Until this migration is deployed, PocketBase silently drops these unknown fields on PATCH
(same as the harmless `scrape_note`-on-federation case) — the workflow is forward-compatible;
fields populate after deploy.

## Where it slots in `enrich-club.json`

```
Validate → Serper Search → Serper Search 2 → Pick site → Resolve site → Ambiguous? ─true→ Belongs check → Patch → Respond
            (q+volleyball)   (q, no sport)    (q1 only)   (iterate+harvest)            └false──────────────→ Patch
```

- **Validate** — add `query2`.
- **Serper Search 2** (new HTTP node) — `query2`, same credential, `onError: continue`.
- **Resolve site** (rewrite) — candidate iterator (C) over pick + q1 + q2 (D); www/http +
  canonical (B); harvest (A); section split (B); fast-path harvest on `recheck`. Emits the new
  fields + a `harvested` flag.
- **Patch** — persist `website_url/source/status/confidence/club_type` (as today) **plus**,
  when `harvested`, the new signal fields (write non-empty values only, so a fluke run never
  blanks good data; `website_emails` written only when ≥1 found).
- **Belongs check** — unchanged (ambiguous-only Haiku).

Keep `n8n/enrich-club.json` and the deployed workflow in sync via the n8n public API (PUT),
per CLAUDE.md.

## Relationship to the club-site contact scraper (no duplication)

This enrichment deliberately **overlaps narrowly** with the Phase-5
[`club-site-contact-scraper.md`](./club-site-contact-scraper.md) — only on *email extraction*
and *contact-link discovery*. To avoid two competing sources of truth, the two are a
**producer → consumer pipeline**, not duplicates (decision from Q&A):

- **Resolve is the cheap producer.** Every resolve already fetches the homepage, so it emits
  the *directional signals* for free: `contact_url` (best contact/impressum page),
  `section_url` (where volleyball lives on a multisport site), `socials`, `site_lang`, and a
  **non-authoritative** `website_emails` *hint* (homepage-only, no de-noise/role association).
- **The scraper is the authoritative extractor.** It owns emails → `contacts`
  (`source_type='club_site'`): multi-page crawl, de-noise (drop designer/CMS/3rd-party
  addresses, prefer own-domain), LLM name/position/phone association, Apify escalation, scale.
- **Handoff:** the scraper's page-discovery step should **seed from `clubs.contact_url` and
  `clubs.section_url`** (fetch them first, before generic link discovery) and may use
  `website_emails` to corroborate — so Resolve's free work makes the scraper cheaper and
  better instead of being redone. `website_emails` is a hint surfaced in the UI now; the
  scraper's `contacts` supersede it. (Wiring this into the live `site-scrape-club` workflow is
  a Phase-5 task — captured in `club-site-contact-scraper.md`, not done here.)

## Out of scope

- **Resolve writing to the `contacts` collection** — emails stay a clubs-row hint; the
  club-site scraper is the single source of truth for `contacts`.
- Multi-page crawling — only the single homepage already fetched (plus the cheap www/http
  probes) is read.
- New `website_status` values — reachability and belongs stay separate axes.

## Build order

1. Migration `clubs` enrichment fields (idempotent) + sync docs.
2. Workflow: Validate `query2`; add Serper Search 2; rewrite Resolve site (A+B+C+D + fast-path
   harvest); extend Patch. PUT live + smoke-test one club.
3. Major re-resolve: drive the existing batch with `recheck=true`; log A/B/C + email counts.
4. (Later / optional) UI surfacing of emails/contact_url/socials; promote emails to contacts.
