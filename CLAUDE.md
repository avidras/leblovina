# CLAUDE.md

Project context and conventions for Claude Code. Read this fully before making changes.

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

> **Framework decision:** written for React + shadcn/ui. If we'd rather stay in Vue, swap
> to `shadcn-vue` (Vite + Vue + same component conventions); everything else in this file
> still applies. Pick one and don't mix.

## Repository layout (target)

```
/pocketbase
  docker-compose.yml      # PocketBase service
  pb_migrations/          # schema as code — COMMIT THESE
  pb_hooks/               # optional server-side JS hooks
/src
  /components/ui          # shadcn components (generated)
  /lib
    pb.ts                 # PocketBase client singleton + typed collection helpers
    utils.ts              # cn() etc.
  /features
    /federations          # Phase 1 lives here
  App.tsx
components.json           # shadcn config
.env.example
```

## Data model (PocketBase collections)

Build collections in this order — see roadmap. Define schema via **migrations** so it's
versioned (not just clicked into the admin UI).

### `federations` — Phase 1
The national federations enumerated from the FIVB confederation directories. This is the
seed inventory that later feeds club discovery.

| field                | type     | notes                                         |
|----------------------|----------|-----------------------------------------------|
| name                 | text     | federation name                               |
| country              | text     |                                               |
| confederation        | select   | CEV / AVC / CAVB / NORCECA / CSV — this is the region tag |
| website_url          | url      | federation's own site                         |
| club_directory_url   | url      | the page listing member clubs (input to Phase 2) |
| extraction_method    | select   | static / js / api_endpoint / pdf / none       |
| source_url           | url      | where we found this (provenance)              |
| status               | select   | new / scraped / error / needs_review          |
| last_scraped         | date     | null until first scrape                       |
| notes                | text     |                                               |

Unique index on `country` (or `name`) to prevent duplicates across reruns.

### `clubs` — Phase 2
| name, country, region, city, website_url, source_url, federation (relation),
  status, last_scraped |
Unique index on a normalized `website_url`/domain.

### `contacts` — Phase 3
| club (relation), email, name, role, source_url, verification_status, verified_at,
  quality |
- Unique index on `email`.
- `source_url` lives **here**, per email — one club can yield emails from several pages.

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

# UI
pnpm install
pnpm dev
npx shadcn@latest add button table input select badge   # as needed
```

> The local `pocketbase` binary and `pocketbase/pb_data/` are gitignored. Schema lives in
> `pb_migrations/` (committed) and is auto-applied on `serve` — never click schema into the
> admin UI as the source of truth.

## Deployment (production — Coolify)

- Production runs PocketBase **in Docker** via `pocketbase/Dockerfile` + `docker-compose.yml`,
  orchestrated by Coolify. The image pins the PocketBase version (never `:latest`) and builds
  natively per `TARGETARCH`.
- Coolify builds from the compose file; `pb_migrations/` is baked/mounted in and auto-applies
  on container boot, so a deploy migrates the prod DB automatically.
- Persist `pb_data` on a Coolify volume so the SQLite DB survives redeploys.
- Bump the pinned version in **both** the `Dockerfile`/`compose` and the local-dev download
  command together, so dev and prod never diverge.

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

- n8n workflow definitions, Apify actor config, the email verifier integration — all live
  in n8n.
- Sending email / Brevo logic (the app only flags which contacts are export-ready).
