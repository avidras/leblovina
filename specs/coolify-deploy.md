# Spec: Deploy PocketBase publicly on Coolify

Stand up the PocketBase backend at a public HTTPS URL so the (public) n8n instance can write
scraped rows and the future UI can read them.

## Scope

- **In:** the combined container (PocketBase serving the built SPA — see
  `specs/frontend-container.md`). One service, one public HTTPS URL.
- **Out:** the n8n workflow import (done after PB is live); real Phase 1 UI features.

## Decisions

1. **Build pack: Dockerfile**, base directory `/` (repo root). The root Dockerfile builds the
   SPA and bakes it into the PocketBase image (single container).
2. **SPA + migrations baked into the image** — `pb_public/` (built UI) and `pb_migrations/`
   ship in the image; migrations auto-apply on container boot. Only `pb_data` is a persistent
   volume.
3. **Same pinned PocketBase version** (0.39.1) as local dev, so schemas never diverge.
4. **Superuser created post-deploy** via the Coolify container terminal (`pocketbase
   superuser upsert`). n8n's `POCKETBASE_ADMIN_*` env vars must match this superuser.

## Prereqs (in this repo)

- Root `Dockerfile` — multi-stage: builds the SPA, bakes `pb_public` + `pb_migrations` +
  `pb_hooks`; pins PB 0.39.1; native per `TARGETARCH`.
- Root `.dockerignore` — excludes `node_modules`, `dist`, `pb_data`, the local dev binary.
- Root `docker-compose.yml` — `pb_data` as a named volume (non-Coolify runs).
- `pnpm-lock.yaml` committed (frozen install in the image).
- All of the above + the federations migration **committed and pushed** — Coolify deploys
  from git, so unpushed code/migrations won't reach prod.

## Coolify steps

1. **Repo access:** connect `avidras/leblovina` (GitHub App or public repo) in Coolify.
2. **New resource → Application → Git** → pick the repo + branch `main`.
3. **Build pack: Dockerfile.** **Base Directory** = `/` (root `Dockerfile`).
4. **Port:** Exposed port `8090`.
5. **Persistent storage:** add a volume mounted at `/pb/pb_data`.
6. **Domain:** set an FQDN (e.g. `https://app.biceps.com`); Coolify provisions HTTPS (Traefik
   + Let's Encrypt). PocketBase serves plain HTTP on 8090 behind Coolify's TLS proxy. This one
   domain serves the UI (`/`), API (`/api/`), and admin (`/_/`).
7. **Deploy.** Watch logs for "Server started" and migration application.
8. **Create the superuser** (Coolify → the app → Terminal):
   `./pocketbase superuser upsert <admin-email> <strong-password>`
9. **Verify:** open `https://app.biceps.com/` (the UI shell shows PB health),
   `GET /api/health` → `{"message":"API is healthy."}`, and the `federations` collection in
   the admin UI at `/_/`.

## After PB is live

- Set on the **n8n host** env: `POCKETBASE_URL=https://app.biceps.com`,
  `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` = the superuser from step 8.
- Then import `n8n/scrape-federations.json` and trigger a run.

## Notes / risks

- **Reachability:** n8n → PB is server-to-server over the public URL; fine. (Local dev PB on a
  laptop is NOT reachable from cloud n8n — that's why we deploy PB.)
- PocketBase's admin UI is public by design; rely on a strong superuser password. Collection
  API rules stay locked (superuser-only) — n8n authenticates as the superuser.
- Redeploys rebuild the image (new migrations apply) but keep the `pb_data` volume, so data
  survives. Never delete that volume.
