# Tournament-led club discovery ("Tournaments" route)

> **Status: BUILT (v1, 2026-06-09).** Schema + processor + drain routing + UI live. As-built
> deltas from this design: (a) the processor **renders with Firecrawl** (homepage → find
> participants link → render participants page → LLM extract) because most tournament sites are
> JS/Cloudflare (static fetch returned nothing on CEV/Challonge); (b) provenance is the
> **`tournament` relation**, not `website_source` — the resolve step legitimately flips
> `website_source` to `serper` once it finds a club's site, so the Clubs filter / dashboard group
> key on `tournament != ''`; (c) clubs are created `website_source='tournament'` then
> **batch-enrich (resolve) + scrape-enqueue** continue the pipeline. Validated on Italian SuperLega
> → 8 real clubs, 6 auto-resolved to A-confidence sites. Known gap: bespoke pro SPAs (CEV) and
> homepages without a discoverable participants link still yield 0 → `no_participants`/`needs_review`
> (tune the participant-link finder against real targets — spec Phase 2).
>
> **Driven by the unified discovery engine.** Per `search-led-discovery.md`'s "Generalization
> (v2)", tournament discovery is `target='tournaments'` in the shared `search_keywords` queue —
> the keyword (a tournament name) is added manually or via the opt-in generator, the shared drain
> dispatches it, and `search-keyword-process` branches to the tournament logic below. So the
> `tournaments` collection here is the **entity store** (discovered tournaments), **not** a keyword
> registry, and there is no separate `tournament-add` webhook (manual keyword add with
> `target='tournaments'` replaces it).

## Goal

A **third lead-gathering route**, parallel to *federations* and *Google search*: find volleyball
**tournaments** on the open web, save each tournament + its participants page, extract the
participating teams as **clubs**, then hand those clubs to the existing pipeline —
website-resolve (Serper) when there's no site, then contact-scrape.

Tournaments are a rich, under-covered lead source: a single regional/youth tournament can list
dozens of small clubs that appear in **no federation directory** and may not surface via a plain
Google club search. Keywords here are **tournament names, supplied by the user**.

```
tournament name (user) -> Google/Serper -> tournament site -> participants page
  -> extract teams -> keep real CLUBS -> resolve website (Serper) -> scrape contacts
```

## Decisions (agreed via questionnaire)

1. **`federation` becomes optional on `clubs`.** A club can belong to a `federation` *or* a
   `tournament` (or neither, transiently). We add a `tournament` relation rather than reusing a
   pseudo-federation (the Google route's GGL pseudo-fed stays as-is; not migrated here).
2. **Auto-extract.** Once a tournament's site + participants page are found and the event is
   classified as a real (club-bearing) volleyball tournament, its clubs are extracted
   automatically. New clubs land `status='needs_review'`.
3. **Keep each team as its own club**, plus a **manual Merge** tool in the UI. Tournament
   participant lists are *teams*, often many-per-club ("VC Dresden U18", "VC Dresden Damen").
   We do **not** auto-collapse; we create one club per team (idempotent per tournament) and let
   a human merge duplicates (within a tournament, across tournaments, and across routes).
4. **Keep all tournaments; filter the *participants* to real clubs.** We do **not** judge a
   tournament by prestige. We process any volleyball tournament (incl. international & pro **club**
   events), but the participant filter **drops non-club entries** — national teams, country names,
   all-star/select squads — so we never create a junk lead like a club named "Germany". National
   squads are the federation route's concern, not this one.

## Schema

### `tournaments` collection (new) — discovered tournament **entities**
> Keywords (tournament names) live in the shared `search_keywords` queue (`target='tournaments'`),
> not here. A `tournaments` row is **created by the processor** when a real tournament is found for
> a keyword; it tracks that tournament's site, participants page, and extraction outcome.
| field | type | notes |
|-------|------|-------|
| name | text | tournament name = the user keyword — **unique** (re-adds idempotent) |
| country | text | optional hint (improves the search) |
| website_url | url | discovered tournament site root |
| participants_url | url | the page listing participating teams/clubs |
| platform | text | detected platform (dataproject / challonge / sportsengine / custom / …) — routes extraction |
| status | select | `pending` / `searching` / `found` (site+participants located) / `extracted` / `no_participants` / `error` / `needs_review` |
| source | select | `google` (default) / `manual` |
| results_count | number | organic results Serper returned |
| participants_count | number | teams found on the participants page |
| clubs_found | number | net-new clubs created (kept-each-team, after the non-club filter) |
| attempts | number | drain dispatch attempts (backpressure / stale-retry) |
| last_run | date | |
| notes | text | errors / detail |
| created / updated | autodate | |
Indexes: unique `name`, index `status`.

### `clubs` changes
- **`federation` → optional** (`required:false`, `minSelect:0`). Existing federation clubs
  unaffected; tournament clubs leave it empty.
- New **`tournament`** relation (→ `tournaments`, optional, `maxSelect:1`, cascade on delete? **no**
  — deleting a tournament should not delete leads; set null) — provenance of a tournament club.
- `website_source` gains **`tournament`** (migration + `pb.ts` `WebsiteSource`).
- New club shape: `{ tournament:<id>, federation:'', name:<team>, country, city?, website_url?:<if
  the participant row exposed one>, website_source:'tournament', status:'needs_review',
  dedup_key:'tournament:<tid>:<uslug(team)>' }`. Confidence/type are set later by resolve, as for
  any club without a vetted site.
- **dedup_key** = `tournament:<tournamentId>:<uslug(teamName)>` → re-running a tournament is
  idempotent, while the **same club in two tournaments yields two records by design** (keep-each-
  team; reconciled via Merge).

### Drain control — reuses `settings.search_discover`
No separate control row: tournament keywords ride the shared discovery queue/drain, paused/capped
by the existing `settings.search_discover`.

## Workflows (n8n) — drain → processor split (mirrors the search route)

> Same rationale as `search-led-discovery.md`: Serper/Anthropic/Firecrawl are credentialed HTTP
> nodes, so the cron **dispatches** each tournament to a per-tournament **processor**.

### Add — via the unified discovery queue (no dedicated webhook)
Tournament names are added as `search_keywords` rows with `target='tournaments'` — manual single
add or the opt-in generator (`search-keywords-generate` with `target='tournaments'`, producing
tournament-name candidates by region/level). The shared `search-discover-drain` dispatches them.

### Drain — the shared `search-discover-drain` (no new cron)
The existing discovery drain dispatches any `pending` keyword regardless of `target`, gated by
`settings.search_discover`. (No separate `tournament_discover` settings row — one queue, one drain.)

### Processor — the `tournaments` branch of `search-keyword-process` (one keyword per call)
1. **Serper** search the tournament name (+country) → pick the **official tournament/event site**.
   *Do NOT* blocklist results platforms here (DataProject / Challonge / SportsEngine / etc.) —
   those often *are* the tournament and its participant source. Detect `platform`. Save
   `website_url`.
2. **Find the participants page**: locate the "teams / participants / registered / draw / groups /
   Mannschaften / squadre / drużyny" page (LLM link-pick + per-platform known routes, e.g.
   DataProject `CompetitionTeamSearch.aspx` — reuse `extract-clubs-dataproject`). Save
   `participants_url`. If none found → `status='no_participants'` / `needs_review`.
3. **Extract participants** (teams): fetch the page (HTTP → Firecrawl/Apify for JS/PDF), extract
   team entries (name + city/club/website where shown). Reuse the directory extractors by platform.
4. **Filter to real clubs**: drop national teams, country names (ISO/country list), and
   all-star/select/"Team <Country>" squads (deterministic country-name match + a strict LLM check
   when ambiguous). National-team events simply yield few/no club rows — fine.
5. **Create clubs** (keep-each-team): one club per surviving team with the shape above. Idempotent
   via `dedup_key`.
6. **Continue the pipeline** per new club:
   - if the participant row exposed a club website → set it (`website_source` stays `tournament`,
     let resolve/recheck grade it); else → **resolve** via `enrich-club` (Serper → A/B/C + type).
   - then **enqueue** into the existing **`scrape_queue`** for contact harvesting.
   (Reuses `enrich-club` + the scrape queue + drain verbatim.)
7. Write back the tournament row: `status`, `participants_count`, `clubs_found`, `notes`.

## UI

### New **Tournaments** nav view (`src/features/tournaments/TournamentsPage.tsx`)
Mirrors the Discovery view: a table (name, country, website, participants page, platform, status,
clubs_found, last run — sortable/filterable/CSV), an **"Add tournaments"** control (paste names),
**Pause/Resume** the drain (+ live stats), and **per-row + bulk "Re-run"** (reset to `pending`).
Open a tournament → its discovered participants/clubs.

### Clubs
- Tournament clubs show `website_source='tournament'`; add `tournament` to the **Source** filter
  (and an "Exclude tournaments" option, paralleling the Google one).
- **Merge clubs** action (the keep-each-team companion): select 2+ clubs → choose the survivor →
  re-point `contacts` + `scrape_queue` to it (handle the `email` unique constraint: skip/merge
  dupes), keep the best `website_url`/relations, delete the losers. Works across routes.
- Club detail tolerates an empty `federation` and shows the `tournament` instead when present.

### Dashboard
- "By confederation" gains a **"Tournaments"** group (clubs/contacts where `tournament != ''` or
  `website_source='tournament'`), like the "No federation (Google search and scrape)" row.
- A new **"How it works"** step for the tournament route (Serper → participants page → club
  extraction → resolve → contacts; tools: Serper, Firecrawl, Claude/Gemini, platform extractors).

## Build phases (proposed)
1. **Schema** — `tournaments` collection; `clubs.federation` optional + `tournament` relation +
   `website_source += tournament`; `search_keywords.target += tournaments`; `pb.ts` types. (Idempotent
   migration + live-API apply, per the established pattern.)
2. **Processor** — `tournament-process` (the hard part: site → participants page → extract →
   club-filter → create → resolve+enqueue). Build/validate against 2–3 real tournaments first.
3. **Drain + Add** — `tournament-discover-drain` cron + `tournament-add` webhook (clone the search
   route).
4. **UI** — Tournaments view + Source filter value + dashboard group + How-it-works step.
5. **Merge clubs** — the manual de-dup tool (also retro-useful for the Google route).
6. **Pilot** — run a handful of user-supplied tournament names; read `clubs_found`, spot-check
   participant→club precision and the national-team filter; tune.

## Out of scope (v1)
- Auto-generating tournament keywords (names are user-provided).
- Multiple editions/years per tournament name (take the single best match; multi-edition later).
- Automatic fuzzy/global club de-dup (Merge is **manual** by decision #3).
- Parsing brackets/scores/standings — we only want the **participant list**.
- Migrating the existing GGL (Google) pseudo-fed clubs to the new federation-optional model.

## Risks / notes
- **Tournament sites are heterogeneous** (custom sites, PDFs, SPAs, registration platforms). The
  participants-page-find + extract is the hard, variable step; lean on the existing per-platform
  extractors (DataProject etc.) + Firecrawl/Apify, and fall back to `needs_review` when no clean
  list is found.
- **Making `federation` optional** touches: the Clubs detail/filters (handle empty fed), the
  dashboard grouping, and `enrich-club` (already guards an empty federation host). Audit these.
- **Keep-each-team inflates club counts** with intended duplicates → the Merge tool is the relief
  valve; surface dup-likely clusters to make merging cheap.
- National-team filtering relies on a country-name list + classifier; review false drops where a
  club is literally named after a place.
