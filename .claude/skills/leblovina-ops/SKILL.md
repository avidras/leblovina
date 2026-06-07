---
name: leblovina-ops
description: Operate the Leblovina volleyball lead-gen app from the CLI — auth to PocketBase + n8n from .env, query live DB state (club/contact counts, zero-club federations, A/B/C confidence, scrape coverage), list/trigger/inspect n8n workflows. Read this FIRST before any leblovina-* skill; it holds the shared creds, endpoints, primitives, and gotchas. Use for status checks ("how many clubs in CEV", "which federations have 0 clubs") and as the base for extract/resolve/scrape/fix tasks.
---

# Leblovina ops — shared primitives

The hub for controlling the Leblovina pipeline (PocketBase DB + n8n orchestration). Other
`leblovina-*` skills assume you've read this. Full project context: `CLAUDE.md` and `specs/`.

## Credentials & endpoints (from `.env`, gitignored — never hardcode, never commit)
- **PocketBase (prod):** `https://leblovina.tools.biceps.digital` — admin via `PB_ADMIN_EMAIL` /
  `PB_ADMIN_PASSWORD`. Collections: `federations`, `clubs`, `contacts`, `settings`.
- **n8n:** `N8N_BASE_URL` (`https://n8n-2.biceps.digital`) + `N8N_API_KEY` (header `X-N8N-API-KEY`).
  Public API: `$N8N_BASE_URL/api/v1/workflows[/{id}]`. Trigger: `POST $N8N_BASE_URL/webhook/<path>`.
- Provider keys also in `.env` for local repro: `SERPER_API_KEY`, `FIRECRAWL_API_KEY`,
  `APIFY_API_TOKEN`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.

Read `.env` with the standard parser (used in all snippets below):
```js
const fs=require('fs');const env={};
fs.readFileSync('.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();});
```

## PocketBase: auth + query
```js
const PB='https://leblovina.tools.biceps.digital';
const token=(await (await fetch(PB+'/api/collections/_superusers/auth-with-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:env.PB_ADMIN_EMAIL,password:env.PB_ADMIN_PASSWORD})})).json()).token;
const H={Authorization:token};
// count helper (totalItems with perPage=1)
const count=async(coll,filter)=>(await (await fetch(PB+`/api/collections/${coll}/records?perPage=1&filter=${encodeURIComponent(filter)}&fields=id`,{headers:H})).json()).totalItems;
```
- `clubs` aren't publicly listable — always pass the admin token.
- Filter syntax is PocketBase's (`field='v' && (a||b)`); URL-encode it.

## n8n: list / inspect / deploy
```js
const https=require('https');
const get=p=>new Promise(r=>{https.get(new URL(env.N8N_BASE_URL.replace(/\/+$/,'')+p),{headers:{'X-N8N-API-KEY':env.N8N_API_KEY}},s=>{let d='';s.on('data',c=>d+=c);s.on('end',()=>r(JSON.parse(d)));});});
// list: await get('/api/v1/workflows?limit=200')  -> .data[]
// one:  await get('/api/v1/workflows/<id>')
```
- **Deploy a workflow:** edit `n8n/<wf>.json` (committed source) AND PUT it live in the same change —
  the export and the deployed workflow must never drift (CLAUDE.md). `PUT /api/v1/workflows/{id}`
  accepts only `{name,nodes,connections,settings}` — strip other GET fields. Code-node bodies are
  large escaped strings; edit them as raw files and inject via `fs.readFileSync` + `JSON.stringify`
  (see how the `enrich-club`/`site-scrape-*` build scripts were done) rather than hand-escaping.
- **Trigger:** `POST $N8N_BASE_URL/webhook/<path>` with a JSON body. Most return immediately
  (`onReceived`) and run in the background.

## Canonical Leblovina workflows (webhook paths are stable; resolve ids via the API)
| purpose | webhook |
|---|---|
| Discover + gate + extract one federation | `/webhook/process-federation` `{id}` |
| Batch process federations | `/webhook/batch-process` `{ids}` |
| Discover club directory only | `/webhook/discover-clubs` `{id}` |
| Extract — generic html / pdf / api | `/webhook/extract-clubs-html`, `-pdf`, `/webhook/extract-clubs` `{id[,url]}` |
| Extract — federated (multi-region) / name list | `/webhook/extract-clubs-federated`, `-namelist` `{id}` |
| Extract — platform: DataProject / eliterro / FFVB / Nevobo / NIF / NVBF / SVBF-map / Swiss searchkit | `/webhook/extract-clubs-dataproject`, `-eliterro`, `-ffvb`, `-nevobo`, `-nif`, `-nor`, `-svbf-map`, `-sui` |
| Detail-page contacts | `/webhook/extract-club-contacts` `{id}` |
| Resolve/enrich club website | `/webhook/enrich-club` `{id[,force,recheck]}` |
| Batch enrich (driver) | `/webhook/batch-enrich` `{ids,force,recheck}` |
| Site-scrape contacts (driver / worker) | `/webhook/site-scrape-driver` `{ids|onlyNew|limit,force}`, `/webhook/site-scrape-club` `{id,force}` |
| Englishize names | `/webhook/englishize-clubs` `{ids?}` |

## Situational queries (read-only)
- **Counts by collection:** `count('clubs','')`, `count('contacts','')`.
- **Per-confederation:** confederation lives on `federations`, NOT `clubs`. Get fed ids first
  (`federations?filter=confederation='CEV'`), then per fed `count('clubs',"federation='<id>'")`.
- **Zero-club federations:** see `leblovina-fix-zero-clubs` (count actual `clubs` per fed — the
  `federations.club_count` field is STALE, do not trust it).
- **Resolve confidence:** `count('clubs',"website_confidence='A'")` etc. (A trusted / B probable /
  C review). **Scrape coverage:** `count('clubs',"status='contacts_found'")` / `'no_contacts'` /
  `'error'`.

## Gotchas (bite people repeatedly)
- `federations.club_count` is **stale** — always derive counts from actual `clubs` records.
- Dedup is enforced by unique indexes (no upsert): `contacts.email`, `clubs.dedup_key`. Reruns are
  idempotent by design — safe to re-trigger.
- Schema changes go through `pocketbase/pb_migrations/` (idempotent), applied on deploy — do NOT
  hand-create prod schema via the API.
- Never invent emails (domain rule #1) — only deterministically extracted addresses.
- Long batches: drivers respond immediately then run in the background; poll PB for progress.
- Big global PB queries with huge OR filters can 504 — page per federation instead.
