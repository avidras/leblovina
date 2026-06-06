# Implementation roadmap — club discovery → extraction → contacts

The single, canonical plan for finishing this implementation. Supersedes the scattered
notes; per-feature detail lives in the linked specs. Read `CLAUDE.md` and `specs/STATUS.md`
alongside this.

_Last updated: 2026-06-06._

## Goal

A **universal, hands-off pipeline** that, for every federation (Europe first), finds its club
directory, extracts **all** its clubs, resolves each club's real website, and harvests
**legitimate contacts** (email required) — ending in export-ready contact data. Every fix is a
**system capability, not a per-federation patch**; we judge quality in **aggregate**.

## Guiding principles

- **Universal, not per-fed.** No hardcoded per-federation logic. Fixes go into the shared
  workflow/extraction logic and must hold across archetypes.
- **Domain rule #1 — never invent a contact.** Only persist emails deterministically present
  in a real source. No pattern-guessed/AI-generated addresses, ever.
- **Cheap-first, escalate.** Haiku for clean/structured parsing, Sonnet only for messy input;
  HTTP/Firecrawl by default, Apify (residential/anti-bot) only on failure.
- **Honest status.** Fetched-but-zero → `needs_review`; never a false `scraped`.
- **Europe (CEV) first**, per the outreach priority order.

## Already done (context, not steps)

- Robust extraction: **chunked** LLM extraction, **never-crash JSON**, **cleanliness-gated
  model** (Haiku/Sonnet), Firecrawl **`waitFor`**. See `specs/club-extract-robustness.md`.
- Dedicated **PDF extractor** (Extract-from-File, not Firecrawl). See
  `specs/club-extract-pdf-path.md`.
- **Discovery no longer blanks `directory_urls`** on an empty re-discovery.
- **`contacts` collection** + inline contact capture during extraction + a per-club
  detail-page harvest *mechanism* (works small-scale; not yet batched/integrated). See
  `specs/club-contacts-from-directory.md`.
- Federations **club-count column** + drill-down. See `specs/federation-club-counts.md`.
- _Deployed-but-uncommitted:_ discovery fix, `waitFor`, the contacts-harvester workflow.

---

## The plan — phases, in dependency order

Each step lists **Goal · Work · Done when**. `[P0/P1/P2]` = priority within the phase.

### Phase 0 — Lock in current work  `[P0]`
- **0.1 Commit & push** the 3 deployed-but-uncommitted changes (discovery fix, Firecrawl
  `waitFor`, `extract-club-contacts` workflow) and update `STATUS.md`.
  - *Done when:* working tree clean, prod and repo in sync.

### Phase 1 — Website resolution quality  *(gates all contact work)* — ✅ DONE
> `enrich-club` now picks the club's own site via an LLM judgment over the Serper results
> (rejects ticketing/registries/social/news; still finds translated-domain sites), with safety
> guards (only a result-present host, not blocklisted, must be live). Two trigger modes shipped:
> **Resolve unresolved** (web status unknown) and **Re-resolve all** (force; overrides the
> existing-live short-circuit for auto/empty-sourced clubs, protects official_list/manual).
> Verified: ticketmaster.fi→ankkuritpesis.fi, spordiregister.ee→beach44.ee, lionhearts.bg kept.
- **1.1 Fix Serper relevance `[P0]`.** Resolve currently attaches unrelated domains
  (`ticketmaster.fi`, `spordiregister.ee`). Rework candidate selection in `enrich-club`:
  - Expand the blocklist: ticketing/aggregators (ticketmaster, eventim…), national sport
    **registries** (spordiregister…), directories, marketplaces.
  - **Score** candidates by **club-name ↔ domain** similarity (not just "title contains a
    token"); strongly prefer a domain that echoes the club name; use the top organic result
    when it plausibly matches; require a real match before accepting.
  - *Done when:* the screenshot cases resolve to the club's own site (or `not_found`), and a
    sample of resolved sites is on-domain, not aggregators.
- **1.2 Two Resolve trigger modes `[P1]`.** UI + `batch-enrich`: (a) **all** clubs in filter,
  (b) **only not-yet-resolved** (`website_status` empty/`unknown`).
  - *Done when:* both buttons work; "only unresolved" skips already-resolved clubs.

### Phase 2 — Detection quality + contacts foundation
- **2.1 Reliable directory counts `[P1]`. ✅ DONE.** Extractors now write a deterministic
  `federations.club_count` independent of the LLM: **exact array length** for API/embedded-JSON;
  **table-row/list-item count** for HTML/PDF. Phase-3 QA flags `created ≪ club_count`.
- **2.1b Dedup stabilization `[P1]`. ✅ DONE (surfaced while verifying 2.1).** html/PDF dedup key
  is now **name-only** `<fed>:<uslug(name)>` — including the LLM-variable `city` was creating
  duplicates on re-run (country-as-city etc.). Cleaned 107 existing dupes across 10 federations
  (contacts moved to survivors; 1,777 survivors re-keyed). Re-runs verified idempotent — this
  unblocks the Phase-3 mass re-run. See `specs/club-dedup-stability.md` (amendment).
- **2.2 "URL → contacts" primitive, batched & integrated `[P1]`. ✅ DONE.** Detail-page
  harvester (`extract-club-contacts`) is now **async** (onReceived), runs on **Gemini 2.5 Flash**
  (the Anthropic tier 429-ed on 139 back-to-back calls — Gemini has higher headroom, and the
  `.env` now has `GEMINI_API_KEY` + an n8n `googlePalmApi` credential), agent
  `onError:continue`+retry (a rate-limited club is skipped, never aborts), idempotent (skips
  `contacts_found`), and **auto-fires from `process-federation`** after extraction. Residual: it
  writes contacts at the end of the run — if n8n kills the execution before then, nothing
  persists, but an idempotent re-run recovers (consider per-club incremental writes if Phase-3
  scale hits this). _Original spec line:_ unify inline + detail-page
  contact extraction into **one** capability: given a URL, fetch → extract contacts
  (email/name/position/phone, domain rule #1) → upsert. Make it **batched/async** (the 139-club
  sync run timed out) and **auto-run inside `process-federation`** after list extraction
  whenever clubs have `detail_url`.
  - *Done when:* a full federation's detail-page contacts harvest completes without timeout,
    automatically, as part of processing.
- **2.3 Contacts UI `[P1]`. ✅ DONE.** Contacts page (Club, Country, Email, Position, Phone,
  **From** = source_type tag, Source, Verification) with search + source + verification filters;
  Clubs page has a **Contacts count** column linking to `/contacts?club=<id>`. Added a
  `source_type` field (`directory`/`club_site`/`manual`; existing 774 backfilled `directory`;
  extractors now tag `directory`).
  - *Done when:* the 770+ contacts are visible and filterable in the app. ✓

### Phase 3 — Europe-wide run + closed-loop QA
- **3.1 Run detect + extract across all CEV federations `[P1]`.** `process-federation`
  (discover → gate → route → extract → resolve → contacts) for every European federation;
  re-extract those that already have directories.
- **3.2 Count-based QA `[P1]`.** Per federation, compare **extracted club count vs the
  (now-reliable) detected count**. Flag **under-extraction** (extracted ≪ detected) as
  extraction failures. (Over-extraction usually = real clubs the estimate missed; not a fault.)
- **3.3 Extraction-workflow revision `[P1]`.** For each flagged archetype, revise the shared
  extractor (not the federation), re-run, repeat until coverage matches. Surfaces the work for
  Phase 4.
  - *Done when:* CEV federations are either `scraped` with extracted ≈ detected, or a
    *justified* `needs_review` tied to a known hard archetype.

### Phase 4 — Hard archetypes as universal capabilities  *(driven by Phase 3 failures)*
- **4.1 Apify anti-bot escalation tier `[P2]`.** Detect a cloaked/failed Firecrawl scrape
  (e.g. Cyprus served SEO spam) and **escalate to Apify** (residential proxies) automatically.
- **4.2 Platform handlers `[P2]`.** Recognise and handle by URL pattern: **DataProject**
  league/team pages (Albania), JS-app directories (Flemish `volleyvlaanderen`), etc.
  - *Done when:* the previously-deferred archetypes extract, or are honestly out of reach.

### Phase 5 — Club-site contact scraper  *(the headline Phase-3 deliverable)*
The product is contacts; most clubs' contacts live only on **their own websites**. Gated by
**1.1** (correct URLs) and built on **2.2** (URL→contacts primitive).
- **5.1 Page-discovery / crawl layer `[P1]`.** For each club with a live, correctly-resolved
  website: fetch the homepage and follow **multilingual** contact-relevant links
  (`/contact`, `/kontakt`, `/contatti`, `/impressum`, `/o-nas`, `/team`, `/vedení`…), bounded
  to a small **page budget** (e.g. homepage + ≤3 candidates). **Default targeted fetch;
  escalate to Apify (4.1)** for JS/anti-bot sites.
- **5.2 Contact extraction + de-noising `[P1]`.** Reuse the 2.2 primitive: deterministic email
  capture + LLM name/role/phone association. **Drop** web-designer/hosting/social/third-party
  emails; **prefer the club's own domain**. Set `contacts_found`/`no_contacts`.
- **5.3 Batched/async orchestration `[P1]`.** Resumable, rate-limited, Europe-first; a
  long-running background job, not a sync webhook.
  - *Done when:* clubs with websites yield on-domain contacts at scale, written `unverified`.
  - **Spec written:** `specs/club-site-contact-scraper.md` (decisions locked: targeted crawl +
    Apify escalation; scope = all live-website clubs, Europe-first, email-dedup; form-only
    skipped; per-club incremental writes; bounded-concurrency driver to fix the harvest's
    sequential-slowness; Gemini + onError:continue + idempotent/resumable).

### Out of scope (next implementation / Phase 3+ tail)
Email **verification** (MX/SMTP), **A/B/C quality** scoring, **Brevo** push, and the
CSV/Excel/Airtable **export shape**. Noted so they aren't forgotten.

---

## Dependency chain (at a glance)

```
0.1 commit
   └─▶ 1.1 resolve relevance ─┬─▶ 5 club-site scraper (5.1→5.2→5.3)
                              │        ▲
2.1 reliable counts          │        │ reuses
   └─▶ 3 Europe run + QA ─────┘   2.2 URL→contacts primitive ──┘
2.2 primitive ─▶ 3, 5         3 failures ─▶ 4 (Apify + platform handlers) ─▶ feeds back into 3/5
2.3 contacts UI (parallel, for visibility)
```

## Open decisions to confirm before starting
1. **Phase 3 run scope:** full `process-federation` over *all* CEV (re-discovers, ~1/min,
   spends Serper/Firecrawl/LLM credits) vs re-extract only where directories exist. _(Plan
   assumes full `process-federation` for CEV feds lacking directories + re-extract for the
   rest.)_
2. **Phase 5 crawl approach:** targeted-with-Apify-escalation _(recommended)_ vs Firecrawl
   `/map` vs Apify-only.
3. **Phase 5 page budget** per club (default: homepage + ≤3 contact-candidate pages).
