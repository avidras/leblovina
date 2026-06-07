---
name: leblovina-fix-zero-clubs
description: For a given confederation (CEV/AVC/CAVB/NORCECA/CSV), find the federations that have ZERO clubs in the DB, then investigate and tweak/expand/fix (or build) the club extractor for each until it actually extracts clubs up to the expected roster size. Use when the user says things like "find CEV federations with no clubs and fix the extraction", "crack the remaining zero-club countries", or names a confederation to complete. Captures emails/contacts where the source exposes them.
---

# Fix zero-club federations

Goal: take a confederation from "some federations have 0 clubs" to "every federation that *can*
be enumerated has its clubs (≈ the real roster size) in the DB". This is per-platform
enumeration work, not a single button. Read `leblovina-ops` first (creds, endpoints, primitives).
Deep context: `specs/club-discovery.md`, `specs/club-extract-platform-enumeration.md`,
`specs/club-extract-robustness.md`, and the recent zero-set history in `specs/STATUS.md`.

## Step 1 — find the true zero set (don't trust `club_count`)
Get the confederation's federations, then count **actual `clubs` records** per federation
(the `federations.club_count` field is stale):
```js
const feds=(await (await fetch(PB+`/api/collections/federations/records?perPage=500&filter=${encodeURIComponent("confederation='CEV'")}&fields=id,country,fivb_code,directory_urls,club_directory_url,website_url,status,notes`,{headers:H})).json()).items;
for(const f of feds){ f.clubs=await count('clubs',`federation='${f.id}'`); }
const zero=feds.filter(f=>f.clubs===0);
console.log('zero-club:',zero.map(f=>f.fivb_code||f.country).join(', '));
```
Report the zero set. Also flag low-but-suspicious feds (far below the discovery estimate) if asked.

## Step 2 — per federation, find the real club source
Run at most ~2 federations' recon in parallel (run resources are limited). For each zero fed:
1. **Try the existing pipeline first** — `POST /webhook/process-federation {id}` (discover→gate→
   extract). Re-count clubs. If it lands a sensible number, done.
2. **If extraction yields 0**, the directory note usually overstated a "static club table" — do
   real recon on the federation's club page (`directory_urls` / `club_directory_url` /
   `website_url`). Look, in order of preference, for a deterministic backend:
   - an **open/guessable API** — `…/swagger/v1/swagger.json`, `/api/clubs|teams|kluby`,
     `/wp-json/wp/v2/*`, Next.js `/_next/data/*.json`;
   - a **POST-enumerable form** (e.g. FFVB: one committee code per request);
   - a **known platform** — DataProject, eliterro, Profixio, SportManager/Swiss Volley
     searchkit proxy, NIF/SportsAdmin, Algolia/InstantSearch, embedded JS `clubs=[…]` arrays;
   - only when there's **no reachable backend**, fall back to Firecrawl JS-render
     (`waitFor`/actions) or an Apify browser actor — and note the cost.
   Use the `.env` provider keys to reproduce a call locally while probing.

## Step 3 — fix or build the extractor
- **Tweak an existing one** when the platform already has a workflow: e.g. point a fed at
  `extract-clubs-federated` (>2 regional dirs), `-dataproject`, `-nif`/`-nor`, `-eliterro`,
  `-sui`, `-svbf-map`, or fix `extract-clubs-html` routing (static vs Firecrawl-render). Many
  fixes are just discovery/routing (`maxIterations`, js→render, restricting a wrong directory).
- **Build a dedicated deterministic extractor** when it's a new open backend — copy the shape of
  the closest existing one (`n8n/extract-clubs-nevobo.json`, `-ffvb.json`, `-eliterro.json`):
  fetch/enumerate → parse (regex/JSON) → find-or-create club by a stable `dedup_key='<FED>:<id>'`
  → find-or-create `contacts` by email (`source_type:'directory'`) → Finalize. Deploy it: write
  `n8n/extract-clubs-<x>.json` AND `PUT` it live (see `leblovina-ops` deploy notes).
- Always **capture emails/phones** when the source exposes them (most registries do) — never
  invent (domain rule #1). Encode windows-1252/latin1 decoding where accents appear.

## Step 4 — trigger, verify, iterate
- Trigger: `POST /webhook/extract-clubs-<x> {"id":"<fedId>"}` (optionally `"url"` to force one dir).
- **Verify against the expected number:** re-count `clubs` for the fed and compare to the real
  roster size (the discovery estimate, or count rows on the source page). The `club_count`
  heuristic is noisy — prefer counting the source. Iterate until it lands near the target; if a
  source is genuinely partial/empty (e.g. social-media-only, or auth-walled API), say so and mark
  the fed resolved-no-source rather than faking it.
- Re-runs are idempotent (`dedup_key` / `email` unique), so re-triggering is safe.

## Step 5 — record it
Update `specs/STATUS.md` with the per-fed outcome (N clubs / contacts, the platform + endpoint,
new workflow id|webhook), and keep the `n8n/` export in sync with the deployed workflow. If a fed
remains uncrackable, document exactly why and the next lead.

## Known platform map (history — see STATUS for specifics)
NED=Nevobo open API · FRA=FFVB adressier form · SVK=eliterro swagger · NOR=NIF ClubSearch /
NVBF klubboversikt · SUI=Swiss Volley searchkit proxy (keyless) · SWE=Profixio (browser-only,
email-less) + SVBF district JS maps · ALB/others=DataProject `.aspx`. Reuse these before inventing.
