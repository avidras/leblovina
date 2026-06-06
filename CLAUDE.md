# CLAUDE.md

Project context and conventions for Claude Code. Read this fully before making changes.

> **Resuming work?** Read `specs/STATUS.md` first — live state, resource IDs, and open items.

## Always-on rules

- **Never commit or push** unless the user explicitly asks you to. Do not create commits,
  amend commits, or push to any remote without direct instruction.
- **Write a spec before implementing any non-trivial feature or refactor.** For anything
  beyond a small isolated edit, write a spec file in `specs/<short-kebab-name>.md` (or a
  subdirectory under `specs/` for grouped specs) and save it to the repo before writing any
  code. The spec captures the agreed plan after the interactive questionnaire concludes —
  goals, scope, decisions taken with rationale, schema/data migrations, file-level changes
  grouped by step, and out-of-scope items. Reuse the structure of existing files in
  `specs/` as the format reference (this repo is new — once the first spec lands, match its
  shape). Only after the spec is saved do you start implementing.
- **When designing a new feature, drive open questions as an interactive questionnaire.**
  Whenever a non-trivial new function, feature, or refactor is being planned and there are
  open design decisions, do not list them in prose for the user to answer in one shot —
  drive them as an interactive Q&A using `AskUserQuestion`, **one question at a time**
  unless the questions are genuinely independent. After each answer, fold the decision into
  the plan and ask the next question. This applies to anything where you'd otherwise write
  "do you want X or Y?" in a plan.
- **Keep feature specs in sync with code.** When modifying a feature that has an existing
  spec in `specs/`, update the spec to reflect the change — new collections/fields, schema
  changes, altered behaviour, new n8n webhooks, etc. The spec is the canonical design
  document; if it drifts from the code, future work will be based on wrong assumptions.
  This applies only to features that already have a spec file; you do not need to create
  specs for features that don't have one.
- **Keep these docs in sync.** When you change behaviour covered by this file or by a doc
  under `.claude/docs/`, update that doc in the same change. If you add a new cross-cutting
  rule or topic area, add it to the relevant doc (or create one under `.claude/docs/`) and
  link it from this file.

## Project: Volleyball club lead-gen — app & database

This repo is **the data layer + the team-facing UI** for a volleyball-club lead-generation
pipeline. It owns the PocketBase database (schema, migrations, Docker setup) and a React
admin UI that lets the team browse, filter, and trigger scrapes over that data.

It does **not** own the scraping logic. Crawling, email extraction, verification, and
enrichment live in **n8n** (orchestration) + **Apify** (site crawling) + a paid email
verifier, and outreach happens in **Brevo**. Those are separate systems. This repo
integrates with n8n by reading the rows n8n writes and by triggering n8n workflows via
webhooks.

## How this repo fits the larger system

```
                    ┌─────────── this repo ───────────┐
 n8n (scrape) ─────▶│  PocketBase  ◀──reads/filters──  UI (React + shadcn) │
   ▲                │  (SQLite)                                            │
   └──── webhook ───┴──── "scrape" / "rescrape" buttons in UI ─────────────┘
                                    │
                          verified A/B contacts ──▶ Brevo
```

- n8n writes scraped rows into PocketBase via its REST API.
- The UI reads/filters those rows and triggers (re)scrapes by POSTing to n8n webhooks.
- PocketBase realtime pushes new rows to the UI live during a scrape run.

## Tech stack

- **PocketBase** — single Go binary, embedded SQLite. Gives us DB + REST API + realtime
  subscriptions + auth + an admin UI for free. Chosen over Postgres for trivial Docker
  setup.
- **React + Vite + TypeScript** — the UI.
- **shadcn/ui + Tailwind** — components.
- **PocketBase JS SDK** (`pocketbase` npm package) — all DB access from the UI.
- **Single container:** in production PocketBase serves the built SPA from `pb_public/`, so
  UI + REST API + admin are all same-origin on port 8090. `src/lib/pb.ts` uses
  `VITE_PB_URL` in dev and `window.location.origin` in prod.

> **Framework decision:** built on React + shadcn/ui (Tailwind v4 via `@tailwindcss/vite`).
> Locked in — don't reintroduce Vue.

## Repository layout

The frontend and PocketBase ship as **one container**: PocketBase serves the built Vite SPA
from `pb_public/`. So the Docker build lives at the repo **root** (multi-stage: build SPA →
bake into the PocketBase image). See `specs/frontend-container.md`.

```
Dockerfile                # root, multi-stage: builds SPA -> PocketBase serves it (port 8090)
docker-compose.yml        # builds the combined image; pb_data volume
.dockerignore
index.html                # Vite entry
vite.config.ts            # @ alias -> /src; React + Tailwind v4 plugins
package.json              # pnpm; "build" -> dist/ (baked into the image's pb_public)
components.json           # shadcn config
.env.example
/pocketbase
  pb_migrations/          # schema as code — COMMIT THESE (baked into the image)
  pb_hooks/               # optional server-side JS hooks (baked in)
  pb_data/                # runtime SQLite — gitignored; the only persistent volume
  pocketbase              # local dev binary — gitignored (prod uses the binary in the image)
/src
  /components/ui          # shadcn components (button.tsx so far)
  /lib
    pb.ts                 # PocketBase client singleton + typed collection helpers
    utils.ts              # cn() etc.
  /features
    /federations          # Phase 1 UI lives here
  App.tsx
  main.tsx
  index.css               # @import "tailwindcss";
/n8n                      # version-controlled n8n workflow exports
/specs                    # design specs (write before non-trivial work)
```

## Data model (PocketBase collections)

Build collections in this order — see roadmap. Define schema via **migrations** so it's
versioned (not just clicked into the admin UI).

### `federations` — Phase 1
The national federations enumerated from the FIVB directory. This is the seed inventory that
later feeds club discovery.

**Data source:** the FIVB **VIS** XML API (`GetFederationList` on
`https://www.fivb.org/Vis2009/XmlRequest.asmx`) returns all ~218 federations in one call —
the directory page's "Load more" is just a client-side slice, not real pagination. n8n
ingests this — workflow export at `n8n/scrape-federations.json`. See
`specs/federations-ingest.md`.

| field                | type     | notes                                         |
|----------------------|----------|-----------------------------------------------|
| fivb_code            | text     | VIS `Code` (e.g. AFG) — **stable dedup key**, unique |
| name                 | text     | federation name                               |
| country              | text     | VIS `TeamName` (human, e.g. "Afghanistan")    |
| confederation        | select   | CEV / AVC / CAVB / NORCECA / CSV — this is the region tag |
| website_url          | url      | federation's own site (normalize: prepend `https://`) |
| president            | text     | VIS `NamePresident`                           |
| general_secretary    | text     | VIS `NameGeneralSecretary`                    |
| email                | text     | VIS `eMailAddress` — verbatim, may be multi-address (split in Phase 3) |
| phone                | text     | VIS `PhoneNo`                                 |
| club_directory_url   | url      | the primary page listing member clubs (input to Phase 2) |
| directory_urls       | json     | discovered club-list pages: `[{ url, region, extraction_method }]` — Phase 2; **`extraction_method` is per directory entry** (federated feds have many) |
| extraction_method    | select   | static / js / api_endpoint / pdf / none — summary/dominant value |
| gate_override        | select   | default / always_review / always_auto — per-fed override of the UI extraction gate |
| source_url           | url      | where we found this (provenance)              |
| status               | select   | new / scraped / error / needs_review          |
| last_scraped         | date     | null until first scrape                       |
| notes                | text     |                                               |

Unique index on `fivb_code` to prevent duplicates across reruns (it's stable even when a
country name is normalized differently). `country` is a plain, non-unique field.

### `clubs` — Phase 2
The bridge entity: a club + (eventually) its website, so Phase 3 can harvest contacts.
See `specs/club-discovery.md`. Discovered via an agentic, search-led, tiered pipeline
(Serper + Firecrawl/Apify + HTTP), Europe (CEV) first.

| field          | type     | notes |
|----------------|----------|-------|
| federation     | relation | → `federations` |
| name           | text     | required |
| country        | text     | denormalized for export/filtering |
| region         | text     | state / Land / committee / RVA / prefecture |
| city           | text     | |
| website_url    | url      | may be empty until Serper resolves it (Stage 3) |
| website_source | select   | official_list / serper / manual / none — URL provenance |
| website_status | select   | unknown / live / dead / not_found — Stage 3 validate+resolve outcome |
| source_url     | url      | the directory page the club came from |
| detail_url     | url      | the catalog's per-club detail page (richer contact data for Phase 3), if any. The html extractor backfills it from each club's listing link (LLM + deterministic link-map fallback) |
| source_club_id | text     | source's own id/code if any |
| dedup_key      | text     | **required, unique**. Html/PDF directories: **name-only** `<fed>:<uslug(name)>` (city dropped — it was LLM-variable, e.g. country-as-city, and broke re-run idempotency; see below). Catalog/API sources with stable per-club ids: `<fed>:<urlPath(detail)>`. `uslug` keeps non-Latin letters (no Cyrillic collapse). See `specs/club-dedup-stability.md` |
| status         | select   | new / contacts_found / no_contacts / error / needs_review |
| last_scraped   | date     | |
| notes          | text     | |

Unique index on `dedup_key` (websites are too sparse to dedup on). Non-unique indexes on
`website_url` and `federation`.

### `settings` — config (not an entity)
`key` (text, unique) + `value` (json). UI-controllable knobs the n8n workflow reads — notably
`extraction_gate` (`review_all | auto_safe | auto_all`, seeded `auto_safe`). The discovery
gate is driven from here, not hardcoded in n8n. See `specs/club-discovery.md`.

### `contacts` — Phase 3 (collection now exists; seeded early during extraction)
| club (relation), email (**required**), name, position, phone, source_url,
  source_type, verification_status, verified_at, quality |
- `source_type`: `directory` (federation list/PDF/detail) / `club_site` (Phase-3 site crawl) /
  `manual` — provenance tag shown on the Contacts page.
- Unique index on `email`.
- `source_url` lives **here**, per email — one club can yield emails from several pages.
- **Seeded during Phase-2 extraction** when a directory already exposes contacts (list/PDF/
  detail page — e.g. Portugal, Estonia, Czechia, Bulgaria); stored `unverified`. Phase 3's
  verifier fills `verification_status`/`verified_at`/`quality`. See
  `specs/club-contacts-from-directory.md`. `email` is the only required field; `position`
  (role/title) and `phone` are optional. Never invent an email (domain rule #1).

Enums:
- `verification_status`: `unverified | mx_only | verified | catch_all | undeliverable | unknown`
- `quality`: `A | B | C`

## Domain rules (non-negotiable)

1. **Never invent or guess emails.** The UI and DB only ever hold addresses that were
   deterministically extracted from a real page. No placeholder, pattern-guessed, or
   AI-generated addresses — anywhere, ever.
2. **Dedup is enforced by unique indexes.** PocketBase has **no `ON CONFLICT` upsert**.
   So: n8n does find-or-create (query by key, then update or create); the UI must catch
   the unique-constraint error gracefully on manual inserts. Treat reruns as idempotent —
   the index is what guarantees it.
3. **`verification_status` is a state + `verified_at` timestamp, not a boolean.** Emails
   decay; we re-verify, and we skip re-checking anything verified recently to save credits.
4. **Provenance per contact.** Every email stores its own `source_url`.
5. **Region tagging + priority.** Priority order for scraping/outreach:
   Europe → Turkey/Israel/Middle East/Asia → US/Canada → Central/South America last.
   (Israel sits under CEV.)
6. **Required export shape** (CSV / Excel / Airtable):
   `Club, Country, Region, City, Email, Website, Source URL, Quality`.
7. **Quality A/B/C** is a blend: contact directness (named coach > club info@ > form-only)
   × verification state × club fit (youth program, priority country). Computed downstream,
   stored on the contact.

## n8n integration

- The UI triggers scrapes by POSTing to n8n webhook URLs held in env vars
  (`VITE_N8N_SCRAPE_FEDERATIONS_URL`, etc.). Never hardcode webhook URLs.
- **Rescrape** is passed as a flag/header on the webhook call (matching the existing n8n
  pattern where `rescrape` is read from request headers). A rescrape re-runs extraction
  for a federation even if `last_scraped` is set.
- Subscribe to PocketBase realtime on the relevant collection so the table updates live
  as n8n writes rows mid-run.

### Managing deployed workflows directly (n8n + PocketBase APIs)

The committed JSON exports under `n8n/` are **not** auto-applied — n8n only runs what's
imported into the live instance. So a fix to an export does nothing until the deployed
workflow is updated. **Use the credentials in the local `.env` to drive both APIs directly**
— the same way for n8n as for PocketBase — to inspect, patch, and verify deployed workflows
and data from the CLI (e.g. updating a Code node, then triggering the webhook to confirm).
The `.env` is gitignored (never committed); these are operational creds, not app config.

- **n8n public API** — `N8N_BASE_URL` + `N8N_API_KEY` (header `X-N8N-API-KEY`). List/get/PUT
  workflows at `$N8N_BASE_URL/api/v1/workflows[/{id}]`; trigger a workflow with
  `POST $N8N_BASE_URL/webhook/<path>`. A `PUT` accepts only `name`, `nodes`, `connections`,
  `settings` — strip the other fields the `GET` returns. **Keep the `n8n/` export in sync:**
  edit the repo JSON and PUT the live workflow together, so committed exports never drift
  from what's deployed.
- **PocketBase admin API** — `PB_ADMIN_EMAIL` + `PB_ADMIN_PASSWORD`. Auth via
  `POST $VITE_PB_URL/api/collections/_superusers/auth-with-password` and pass the returned
  `token` as the `Authorization` header to read/patch records (clubs aren't publicly listable).
- Other provider keys in `.env` (`SERPER_API_KEY`, `FIRECRAWL_API_KEY`, `APIFY_API_TOKEN`,
  `ANTHROPIC_API_KEY`) are there for reproducing/debugging an n8n node's call locally. The app
  itself still needs none of them — at runtime those secrets live in n8n (see Conventions).

## Dev setup

**Local dev runs PocketBase as a bare binary — no Docker.** PocketBase is a single binary;
running it directly is faster to iterate on and needs nothing installed. Docker is reserved
for **production deploys on Coolify** (see Deployment). Both run the *same* pinned version
and the *same* `pb_migrations/`, so dev and prod schemas stay identical.

```bash
# PocketBase (local dev — bare binary, version pinned to match the Docker image)
cd pocketbase
# one-time: download the pinned binary for your platform (gitignored, not committed)
curl -sL -o /tmp/pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.39.1/pocketbase_0.39.1_darwin_arm64.zip \
  && unzip -o /tmp/pb.zip pocketbase && rm /tmp/pb.zip
./pocketbase serve                            # admin UI at :8090/_/; migrations auto-apply
# first run prints a link to create the superuser, or:
./pocketbase superuser upsert EMAIL PASS

# UI (from the repo root, in a second terminal)
corepack enable pnpm          # one-time; pnpm version is pinned via package.json
pnpm install
pnpm dev                      # Vite dev server (:5173), talks to PB via VITE_PB_URL
pnpm build                    # -> dist/ (this is what gets baked into the image's pb_public)
npx shadcn@latest add table input select badge          # as needed
```

In dev the SPA runs on Vite's :5173 and hits PocketBase at `VITE_PB_URL`
(`http://localhost:8090`). In prod there's no separate dev server — PocketBase serves the
built SPA, so the UI and API are same-origin.

> The local `pocketbase` binary and `pocketbase/pb_data/` are gitignored. Schema lives in
> `pb_migrations/` (committed) and is auto-applied on `serve` — never click schema into the
> admin UI as the source of truth.
>
> **Don't create schema via the live PB API either.** If you add a collection/field with the
> REST API (e.g. for speed against prod) and *also* write the matching create-migration, the
> migration re-runs on the next deploy against a DB that already has the object and **fails
> ("name must be unique") — crash-looping the container (503)**. Either apply schema *only*
> via migrations, or make every migration **idempotent** (skip if the collection/field already
> exists: `try { app.findCollectionByNameOrId(name); return } catch(e){}` for collections,
> `if (c.fields.getByName(f)) return` for fields). All migrations here are idempotent for this
> reason.

## Deployment (production — Coolify)

Full walkthrough: `specs/coolify-deploy.md`.

- Production runs the **combined image** (PocketBase + SPA) built from the **root**
  `Dockerfile` via Coolify's **Dockerfile build pack** (base directory `/`). One service, one
  port (8090) serving UI + API + admin. Pins the PocketBase version (never `:latest`); builds
  natively per `TARGETARCH`.
- The image **bakes in** the built SPA (`pb_public/`), `pb_migrations/`, and `pb_hooks/`.
  Migrations auto-apply on container boot, so a deploy migrates the prod DB automatically.
  Only `pb_data` is a runtime volume.
- Persist `pb_data` on a Coolify volume (mount `/pb/pb_data`) so the SQLite DB survives
  redeploys. Never delete that volume.
- Create the superuser post-deploy via the Coolify terminal (`pocketbase superuser upsert`);
  n8n's `POCKETBASE_ADMIN_*` must match it.
- Bump the pinned version in the `Dockerfile`/`compose` and the local-dev download command
  together, so dev and prod never diverge.

`.env` (see `.env.example`):
```
VITE_PB_URL=http://localhost:8090
VITE_N8N_SCRAPE_FEDERATIONS_URL=
```

## Conventions

- One PocketBase client singleton in `src/lib/pb.ts`; never `new PocketBase()` in components.
- Type collections with TS interfaces mirroring the schema; keep them next to `pb.ts`.
- Keep secrets (Serper, Apify, BuiltWith, verifier API keys) **out of this repo** — they
  belong to n8n. This app only needs the PB URL and n8n webhook URLs.
- shadcn components go in `src/components/ui` (generated, lightly customized). Feature code
  in `src/features/*`. Keep the UI plain and functional — filterable data tables first,
  polish later.
- Commit `pb_migrations/`. Schema changes happen via migration files, not only the admin UI.

## Build roadmap

- **Phase 1 (current): federations.**
  Collection + a UI page listing federations with filters (confederation, country, status,
  last_scraped). A "Scrape federations" button and a per-row "Rescrape" button that POST to
  the n8n webhook. Verify rows land and the table live-updates.
- **Phase 2:** `clubs` — club discovery from federation directories (+ Serper gap-fill).
- **Phase 3:** `contacts` — Apify harvest + MX/verifier results + A/B/C quality.
- **Phase 4:** advanced filtering, CSV/Excel/Airtable export, Brevo push (A/B tiers only).

Do not build ahead of the current phase. Get federations + rescrape solid first.

## Out of scope for this repo

- Apify actor config and the email verifier integration — live in n8n.
- n8n workflows **run** in n8n; we keep version-controlled JSON **exports** under `n8n/`
  for reproducibility (e.g. `n8n/scrape-federations.json`). Secrets/credentials stay in n8n,
  never in the committed export.
- Sending email / Brevo logic (the app only flags which contacts are export-ready).
