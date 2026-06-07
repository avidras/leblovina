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

## Open leads (the user's other 3 high-potential feds — start here next session)

- **SWE (Sweden)** — `volleyboll.se` on **Profixio**. Find-a-club page points at
  `profixio.com/fx/terminliste.php?org=SVBF.SE.SVB` (**org `SVBF.SE.SVB`**). Find Profixio's
  club-registry endpoint for that org (try `profixio.com/app/...` JSON / club list) and
  enumerate. Profixio is Nordic → likely reusable for NOR.
- **SVK (Slovakia)** — `slovakvolley.sk` is a Next.js SPA on **eliterro**; API host
  `api.volley.eliterro.sk`. `/api/club|clubs|kluby|team|teams|oddiel` → 404. Inspect the
  SPA bundle / `_next/data/*.json` for the adresare route to find the real club endpoint.
- **NOR (Norway)** — `volleyball.no` WordPress, but clubs are not a WP post type and not
  inline on `/klubborganisasjon` (JS-injected from an external register — NIF/SportsAdmin or
  Profixio). Hardest. Firecrawl-render to capture the live XHR, or check Profixio.
