# Per-platform club enumeration (Nevobo / FFVB pattern)

Some federations don't expose a scrapable HTML directory — their clubs live behind a
backend (open API, POST-enumerable form, or SPA data route). When that backend is
reachable, the right move is a **dedicated deterministic extractor** that enumerates it,
rather than Firecrawl-rendering pages. These are fast (seconds), clean (no LLM needed),
and usually carry **emails + websites** inline → clubs *and* contacts in one pass.

Build one when you find: an open/guessable JSON API, a `<form>` you can POST per
region/committee, or a Next.js `_next/data/*.json` route. Fall back to Firecrawl-render /
Apify only when no backend is reachable.

## Done

### NED — Nevobo open API  (`extract-clubs-nevobo` 42Ur1JEWgaQkDZ0a)
`api.nevobo.nl/relatiebeheer/verenigingen?page=N` (Hydra JSON-LD, ~58 pages). dedup
`NED:<organisatiecode>`. **0 → 1,739 clubs + ~1,600 contacts** (email/phone). ~100s.

### FRA — FFVB adressier  (`extract-clubs-ffvb` Vz1NsAbq4JWzwZr8 | `/webhook/extract-clubs-ffvb`)
The find-a-club form `ffvbbeach.org/ffvbapp/adressier/recherche.php` POSTs a committee
code to `rech_aff_club.php`. **Enumeration key:** `ws_new_comit` (département code; 105
of them, embedded in the workflow's "Committees" node). One POST per committee returns an
HTML page listing every club with a 7-digit code, name, `mailto:` email, and website.

- POST body: `ws_new_ligue=0&ws_new_comit=<NNN>`, `Content-Type: application/x-www-form-urlencoded`.
- Response is **windows-1252** → fetch with `encoding:'arraybuffer'`, `Buffer.from(resp).toString('latin1')` (accents come out clean).
- Parse: regex per club, anchored on the 7-digit code + `<td class='lienquestion'>NAME</td>`;
  read email/website from a bounded ~1400-char window after the match. Skip codes ending
  `0000` (those are the département committee, not a club). Drop social URLs from website.
- dedup `FRA:<7-digit code>`. Clubs + contacts (`source_type:'directory'`). region = département name.
- **0 → 1,310 clubs + 1,255 contacts (687 w/ website) in ~58s.**

> Note: the Finalize node (copied from Nevobo) PATCHes `scrape_note` onto the *federation*,
> but that field only exists on `clubs` — PB silently drops it. Harmless (`status` +
> `club_count` persist). If a fed-level run note is ever wanted, write to `notes` instead.

### NOR — NIF MinIdrett ClubSearch  (`extract-clubs-nif` zA8cUjhYy1469qHl | `/webhook/extract-clubs-nif`)
`volleyball.no/klubboversikt` embeds the national NIF registry (`minidrett.no/idrettslag`). Real
backend: **`POST restdistribution.nif.no/api/v1/ClubSearch`** with
`{ClubName:'',RegionId:0,ActivityId:38,PageSize:100,Index:N}` — **ActivityId 38 = Volleyball**,
keyless, paginated (`Count`=311). Returns name/city/zip/LocalCouncil; **no email/website**
(`ClubDetails` needs auth → 401). Swagger: `restdistribution.nif.no/swagger/docs/v1`. dedup
`NOR:<OrgId>`. **0 → 311 clubs.** Found via Apify puppeteer-scraper capturing the live XHRs.

### UKR + ALB — DataProject teams  (`extract-clubs-dataproject` x0JKgaz4Y2lOSLc9 | `/webhook/extract-clubs-dataproject`)
**Reusable** across any federation whose results sit on `*.dataproject.com`. Team-search pages
`https://<dpHost>.dataproject.com/CompetitionTeamSearch.aspx?ID=<comp>` render each club as a logo
`<img title="CLUB NAME" ... src=".../TeamLogo_<TeamID>.jpg">` in **static** HTML (UTF-8 — no browser,
no latin1). Parse `title`+`TeamID`, dedup `<FEDCODE>:<TeamID>`, iterate competition IDs (get them
from the federation's "clubs"/league menu, which links to `CompetitionHome.aspx?ID=`). Name-only
records (city/website/contacts via Resolve + site-scrape later). Baked-in PROFILES: **UKR**
(`uvf-web`, comps 162-182 → 275 clubs), **ALB** (`fshv-web`, comps 108/114/115/116/117/122 → 25
clubs). Override anything via body `{id,fedcode,dpHost,country,comps:[...]}`. **To add a new
DataProject fed:** find its `*.dataproject.com` host + competition IDs, add a PROFILE (or pass via
body), trigger.

## Recon tool

**Apify `puppeteer-scraper` actor `YJCnS9qogi9XxDgLB`** (approved). Use it to (a) capture live XHRs
(`preNavigationHooks` → `page.on('response',…)` collecting JSON/api bodies) to find a hidden API,
or (b) render nav/DOM to locate the real club page or results platform. Run via
`POST api.apify.com/v2/acts/YJCnS9qogi9XxDgLB/run-sync-get-dataset-items?token=$APIFY_API_TOKEN`.
This is how NOR's NIF API and UKR/ALB's DataProject hosts were discovered. **Pattern: render to
discover the backend, then build a keyless deterministic extractor — don't scrape via the browser.**

## Open leads (start here next session)

_SVK (eliterro), SWE (Profixio partial), NOR (NIF), UKR + ALB (DataProject) are DONE — see
above / STATUS.md._ Remaining CEV zero-club feds (all marginal, pursue only on request):

- **CYP (Cyprus)** — `volleyball.org.cy/somatia` is **compromised** (SEO-spam defacement, no
  club table, 0 mailtos). Need an alternative Cyprus federation domain/source. ~30 clubs.
- **GIB (Gibraltar)** — no website/club directory (social only). Mark resolved-no-source.
- **LAT (Latvia)** — `volejbols.lv/komandas` is ~15 league-group rosters (team + coach only,
  no city/site/email). Thin; low value.
- **MON (Monaco)** — ~1-2 clubs. Tiny.

**Other DataProject feds:** many CEV/AVC federations run results on `*.dataproject.com`. To
add one to the reusable extractor: find its host + competition IDs (from the fed's league
menu → `CompetitionHome.aspx?ID=`), add a PROFILE or pass via body, trigger.
