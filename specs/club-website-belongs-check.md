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
5. **Club-type axis (volleyball vs general sports club).** The same pass also classifies the
   resolved site as `volleyball` (dedicated club), `multisport` (volleyball is one section of a
   multi-sport club — *still a valid lead*, just tagged so outreach targets the volleyball
   section), or `unknown`. Stored as a new `clubs.club_type`. Independently, **a serper-resolved
   site with no volleyball signal at all** is a likely false positive (e.g. a same-named football
   club or a town sports portal) → it feeds the confidence axis as a negative signal (→ `C`),
   but we do **not** assert a `non_volleyball` tag (the homepage may simply bury volleyball on a
   subpage — `club_type` stays `unknown`). Multi-sport clubs are kept, never rejected.

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

### Club-type tag (new field)

Add `clubs.club_type` (select): `unknown | volleyball | multisport`. A third axis, orthogonal
to both status (reachability) and confidence (belongs). Default `unknown`; only set on
serper-checked clubs (or later by other sources). `multisport` is **not** a downgrade — it is a
kept lead, tagged so Phase-3/outreach can target the volleyball section's contact and so quality
scoring (domain rule #7, club fit) can weight it. Only "no volleyball signal" affects confidence
(→ `C`), never `club_type` directly.

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
  - **No volleyball signal** — none of the multilingual volleyball terms appear anywhere on the
    page (`volleyball|volley|voleibol|voleibol|voleyball|pallavolo|siatków|odbojk|röplabda|
    tinklin|odbojka|волейбол|воле|hava topu|lentopallo|volleybol|sulæk; …`, Unicode/diacritic-
    folded). A volleyball club's own homepage should mention the sport; absence on a serper-
    resolved site is a strong wrong-org indicator ⇒ `C`.
- **Volleyball-term scan (drives `club_type`, not a fail by itself):** detect volleyball terms
  (above) and multi-sport markers (`abteilung|sektion|sezione|polisportiva|polideportivo|
  section|seksjon|multisport|department|sportverein` + several distinct sport names). Heuristic:
  volleyball term in domain/title/`h1` and few other sports ⇒ `volleyball`; volleyball present
  but alongside multi-sport markers / many sports ⇒ `multisport`; otherwise leave for the LLM
  (ambiguous) or `unknown`.

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
> not a namesake, not a league/results page, not a directory)? Also classify the site as a
> dedicated volleyball club, a multi-sport club with a volleyball section, or neither. Return
> JSON `{belongs: 'yes'|'no'|'unsure', club_type: 'volleyball'|'multisport'|'unknown',
> confidence: 0..1, reason}`."

- `belongs=yes` ⇒ `website_confidence = B` (accepted, probable).
- `belongs=no`/`unsure` ⇒ `website_confidence = C` (review).
- `club_type` from the LLM is written when Tier 0 couldn't decide it (the LLM may also return
  `unknown` if it is neither a volleyball nor a recognizable multi-sport club — that's a
  belongs-suspect signal too).

Cost ceiling: at most **one** extra Haiku call per resolved-by-serper club, and only for the
ambiguous slice — most clubs resolve at Tier 0 for $0. The classification rides the **same**
call, so `club_type` adds no extra cost.

## Where it slots in `enrich-club.json` (as implemented)

The original single **Finalize** node was split so the LLM can see the fetched page. The tail is:

```
Pick site → Resolve site → Ambiguous? ─true→ Belongs check (Haiku) → Patch → Respond
                                       └false─────────────────────────→ Patch
```

- **Resolve site** (Code) — resolves the URL (or keeps the live one on recheck), fetches the
  candidate body **once**, runs **Tier 0** (name/geo/domain + parked/directory + volleyball-term
  scan), and emits `{chosen, source, status, confidence, club_type, verdict, page, …}`. Strong
  pass ⇒ `confidence A`; hard fail ⇒ `C`; else `verdict='ambiguous'`. Sets `club_type` when the
  term scan is conclusive.
- **Ambiguous?** (IF) — routes `verdict==='ambiguous'` to the LLM; everything else straight to Patch.
- **Belongs check** (HTTP → Anthropic Messages, `predefinedCredentialType: anthropicApi`) — one
  Haiku call returning `{belongs, club_type, confidence, reason}`. `onError: continueRegularOutput`.
- **Patch** (Code) — maps the LLM verdict (yes⇒B, no/unsure⇒C), then PATCHes `website_url,
  website_source, website_status, website_confidence, club_type` on the club.

The non-serper / already-live fast path (`!v.needsResolve`) sets `website_confidence = A` for
`official_list`/`manual`, leaves `unknown` otherwise. Keep `n8n/enrich-club.json` (the committed
export) and the **deployed** workflow in sync via the n8n public API (per CLAUDE.md): edit the
JSON, `PUT` the live workflow, trigger the webhook to confirm.

## Backfill (one-off)

Drive the existing **async batch from the Clubs page** (the "Process N" / resolve-batch path)
over the filter `website_source = serper`, with a `recheck=true` flag so Finalize runs the
belongs-check against the current `website_url` **without** re-spending Serper (validate →
if live, run Tier 0/1 → patch `website_confidence`; only resolve if actually dead). This
reuses the existing batched, gated, re-runnable trigger — no new spend path. Log counts of
A/B/C so the bad-URL backlog is visible (no silent truncation).

## Migrations

- `1780655100_clubs_website_confidence.js` — `website_confidence` select
  (`unknown | A | B | C`), idempotent-guarded. **Shipped.**
- `<ts>_clubs_club_type.js` — `club_type` select (`unknown | volleyball | multisport`, default
  `unknown`), same idempotent guard.

Sync: update `CLAUDE.md` (`clubs` table) and `club-discovery.md` (`clubs` collection table +
Stage 3) to document both `website_confidence` and `club_type`.

## UI (small)

- Clubs page: a **`website_confidence` filter** (esp. `C`) + A/B/C badge, and a **`club_type`
  filter** + badge (volleyball / multisport).
- The `C` set is the triage queue: a human opens the club, eyeballs the URL, and either
  confirms (bump to A/B manually) or clears/edits it. `multisport` rows are a cue that the
  useful contact is the volleyball section, not the general club office.

## Out of scope

- Re-resolving or re-crawling beyond the single page already fetched.
- Touching `official_list`/`manual` provenance (trusted; graded `A` without the check).
- Phase-3 contact harvesting (keys off `website_url` regardless of confidence; an operator may
  choose to harvest only A/B).
- Any new `website_status` value — reachability and "belongs" stay separate axes.

## Build order

**Round 1 — belongs-check (shipped):**
1. Migration `clubs.website_confidence` + sync docs. ✓
2. Workflow split `Resolve site → Ambiguous? → Belongs check → Patch`; Tier-0 + Haiku tiebreak;
   `PUT` live + smoke-test. ✓
3. Backfill `website_source=serper` with `recheck=true`; review A/B/C counts. ✓
4. UI confidence filter + badge + "Re-check confidence" button. ✓

**Round 2 — club-type axis (this expansion):**
5. Migration `clubs.club_type` (idempotent) + sync docs.
6. Resolve site: add the volleyball-term scan (no-volleyball ⇒ `C`; conclusive ⇒ `club_type`).
   Belongs check: extend the prompt/return to include `club_type`. Patch: write `club_type`.
   `PUT` live + smoke-test.
7. Re-run the `recheck=true` backfill (idempotent) to populate `club_type` + reconfirm confidence.
8. UI: `club_type` filter + badge.
