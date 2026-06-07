# Spec: Post-resolve "does this site belong to the club?" check

A low-cost confirmation, run **after** a club website is resolved/validated, that the URL we
hold actually belongs to **this specific club** — not a league page, an aggregator, a
namesake club in another town, or a parked/squatted domain. Adds a confidence signal and a
review flag without ever deleting a plausible URL.

Extends Stage 3 of [`club-discovery.md`](./club-discovery.md) (Club website enrich) and the
deployed `n8n/enrich-club.json` workflow.

## Why (the gap this closes)

Stage 3 resolution today accepts a Serper URL on thin evidence:

1. HTTP responds (`enrich-club.json` Validate/Finalize treat 2xx/3xx/401/403/429 as "live"),
2. domain isn't on a social/aggregator blocklist (Finalize `blocked` regex),
3. Haiku ("Pick site" node) chose it — **from search snippets/titles only; it never sees the
   actual page**, and is explicitly told the domain "need NOT contain the club name".

Two holes:
- `club-discovery.md` §Stage-3 calls for **name-token overlap validation** on resolution, but
  the live Finalize node does **not** implement it — it trusts the LLM's snippet-based pick
  and an HTTP 200.
- Even a correct-looking domain can be the *wrong club* (same name, different city/country),
  a **league/results page** that merely lists the club, or a **parked** page.

`official_list` and `manual` URLs are trustworthy by provenance. **This check runs only on
`website_source = serper`** — the only suspect class — which also bounds its cost.

The enabler: the Finalize node **already fetches** the chosen candidate's full response
(`this.helpers.httpRequest({ ... returnFullResponse:true })`). The page body is already in
memory — Tier-0 content checks are **$0 extra** (no new request).

## Decisions (from interactive Q&A)

1. **Fail action: flag for review, keep the URL.** A failed/uncertain check never deletes the
   URL. We set a confidence grade and a review status; humans triage in the UI. Mirrors the
   existing `needs_review` + extraction-gate philosophy and loses no lead. (Hard HTTP-dead is
   still cleared as today — that path is unchanged; this check is about *wrong-but-live*.)
2. **Scope: Tier 0 (deterministic) + Haiku tiebreak on ambiguous only.** Free content
   heuristics decide the clear cases; a single Haiku call is spent **only** when Tier 0 is
   inconclusive. Strong pass / hard fail never hit the LLM.
3. **Rollout: backfill + forward.** Fold the check into the live `enrich-club` workflow for
   every future resolve, **and** run a one-off pass over all existing `website_source=serper`
   clubs to score the current backlog.
4. **Only `website_source = serper` is checked.** `official_list` / `manual` are accepted as
   `website_confidence = A` (trusted by provenance) without running the check; `none` has no
   URL to check.

## Confidence model (new field)

Add `clubs.website_confidence` (select): `unknown | A | B | C`.

| Grade | Meaning | How reached |
|---|---|---|
| `A` | Trusted — provenance or strong content match | `official_list`/`manual`; or serper + strong Tier-0 pass |
| `B` | Probable — partial corroboration, accepted | serper + Haiku-confirmed, or moderate Tier-0 |
| `C` | **Low confidence — review** | serper + Tier-0 inconclusive **and** Haiku not-confirmed |
| `unknown` | not yet checked | default / pre-backfill |

Grade `C` is the human-triage bucket. We do **not** add a new `website_status` value — status
stays `unknown|live|dead|not_found` (about reachability); confidence is the orthogonal
"belongs to club" axis. A `C` club keeps `website_status = live` and its URL.

> Open: whether `C` also flips club `status` to `needs_review`. Leaning **no** — keep
> `status` for Phase-3 contact state; filter the Clubs page on `website_confidence = C`
> instead (avoids colliding with extraction's use of `needs_review`). Revisit if the UI needs
> a single review queue.

## The check (runs in Finalize, on the already-fetched body)

Ground truth available on the club row (reliability per `club-discovery.md`): `name`
(high), `country` (high, denormalized), `city`/`region` (medium, LLM-extracted), plus the
resolved `host`. Reuse the **existing** Unicode-aware tokenizer + stop-word set already in the
Validate node (`\p{L}` normalize/diacritic-strip, length≥3, stop-words).

### Tier 0 — deterministic, $0 (on `res.body` from the candidate GET)

Extract from the HTML: `<title>`, `og:site_name`, `og:title`, first `<h1>`, and a
lowercased/diacritic-stripped slice of visible text (cap length). Then score:

- **Name-token overlap** — at least one non-stop club-name token appears in
  title/`og`/`h1` (strong) or body (moderate). *If the name yields zero usable tokens, skip
  this signal rather than fail* (same rule as resolution today).
- **Geo corroboration** — ccTLD matches country (`.it`→Italy, `.pl`→Poland…), OR country/city
  string present in page text. (`.com/.org/.eu` are neutral, not negative.)
- **Domain-slug similarity** — `uslug(host)` vs `uslug(name)` token/substring overlap (reuse
  the dedup uslug helper's logic; pure string ops — n8n sandbox has **no global `URL`**).
- **Negative signals (hard fail → `C`):**
  - **Directory/aggregator page** — the club name co-occurs with many other club-like links
    (count anchors; high count + generic title ⇒ a list, not the club's own site).
  - **Parked/for-sale** — body matches `/(domain (is )?for sale|buy this domain|parked|
    this domain may be for sale|godaddy|sedo)/i`.

**Tier-0 verdict:**
- **Strong pass** → title/og/h1 name-token hit **and** (geo corroboration **or** domain-slug
  match), no negative signal ⇒ `website_confidence = A`. **Done, no LLM.**
- **Hard fail** → a negative signal fires ⇒ `website_confidence = C`. **Done, no LLM.**
- **Ambiguous** → anything else (e.g. body-only name hit, or no name tokens, no negatives)
  ⇒ fall through to Tier 1.

### Tier 1 — one Haiku call, only on ambiguous

Reuse the existing Anthropic Haiku node pattern. Prompt with `{name, city, country}` + the
extracted `{title, og_site_name, h1, text_excerpt(~1–2k chars)}` of the **fetched page**
(not snippets):

> "Is this web page the official site of THIS specific club (same club, same city/country —
> not a namesake, not a league/results page, not a directory)? Return JSON
> `{belongs: 'yes'|'no'|'unsure', confidence: 0..1, reason}`."

- `yes` ⇒ `website_confidence = B` (accepted, probable).
- `no` / `unsure` ⇒ `website_confidence = C` (review).

Cost ceiling: at most **one** extra Haiku call per resolved-by-serper club, and only for the
ambiguous slice — most clubs resolve at Tier 0 for $0.

## Where it slots in `enrich-club.json`

All changes are inside the **Finalize** Code node (id `fin`), which already has `res.body`
for the chosen candidate, plus a conditional Haiku branch:

- After `chosen` is confirmed live, run **Tier 0** on the captured body. Set
  `website_confidence` and decide pass/fail/ambiguous.
- For **ambiguous**, call Haiku (route through a Pick-site-style agent node, or an inline
  `httpRequest` to the Anthropic API using the existing credential) and map the verdict.
- Extend the final `patch({...})` to include `website_confidence` alongside
  `website_url/website_source/website_status`.
- The non-serper / already-live fast path (`!v.needsResolve`) sets `website_confidence = A`
  for `official_list`/`manual`, leaves `unknown` for auto-sourced live-but-unchecked.
- Capture the candidate GET's body once (it's already fetched) — do **not** add a second
  request.

Keep `n8n/enrich-club.json` (the committed export) and the **deployed** workflow in sync via
the n8n public API (per CLAUDE.md): edit the JSON, `PUT` the live workflow, trigger the
webhook to confirm.

## Backfill (one-off)

Drive the existing **async batch from the Clubs page** (the "Process N" / resolve-batch path)
over the filter `website_source = serper`, with a `recheck=true` flag so Finalize runs the
belongs-check against the current `website_url` **without** re-spending Serper (validate →
if live, run Tier 0/1 → patch `website_confidence`; only resolve if actually dead). This
reuses the existing batched, gated, re-runnable trigger — no new spend path. Log counts of
A/B/C so the bad-URL backlog is visible (no silent truncation).

## Migration

New migration `pocketbase/pb_migrations/<ts>_add_website_confidence.js` — **idempotent**
(guard with `if (c.fields.getByName('website_confidence')) return;` per the repo's
crash-loop rule): add `website_confidence` select (`unknown | A | B | C`, default `unknown`)
to `clubs`. Optional non-unique index for UI filtering.

Sync: update `CLAUDE.md` (`clubs` table) and `club-discovery.md` (`clubs` collection table +
Stage 3) to document `website_confidence` and the belongs-check.

## UI (small)

- Clubs page: a **`website_confidence` filter** (esp. `C`) and a column/badge (A/B/C).
- The `C` set is the triage queue: a human opens the club, eyeballs the URL, and either
  confirms (bump to A/B manually) or clears/edits it.

## Out of scope

- Re-resolving or re-crawling beyond the single page already fetched.
- Touching `official_list`/`manual` provenance (trusted; graded `A` without the check).
- Phase-3 contact harvesting (keys off `website_url` regardless of confidence; an operator may
  choose to harvest only A/B).
- Any new `website_status` value — reachability and "belongs" stay separate axes.

## Build order

1. Migration: `clubs.website_confidence` (idempotent) + sync CLAUDE.md & club-discovery.md.
2. Finalize node: Tier-0 content checks on the captured body; set confidence; wire ambiguous
   → Haiku; extend the PATCH. `PUT` the live workflow; verify via webhook on a few known
   good/bad serper clubs.
3. Backfill: batch the `website_source=serper` filter with `recheck=true`; review A/B/C
   counts.
4. UI: confidence filter + badge; `C` triage.
