# Spec: Frontend + PocketBase in one container

The React/Vite SPA and PocketBase ship and run as a **single container**.

## Decision

**PocketBase serves the built SPA from `pb_public/`.** PocketBase's static handler serves
`pb_public` at `/`, with built-in SPA index fallback (verified: unknown client routes like
`/federations` return `index.html`, real assets serve directly, `/api/` and `/_/` keep
working). One Go process, one port (8090); UI + REST API + admin are same-origin.

Rejected: nginx + PocketBase as two processes (more moving parts, no benefit here);
separate containers (the requirement was one container).

## Shape

- Root **multi-stage `Dockerfile`**:
  1. `node:22-alpine` → `pnpm install --frozen-lockfile` → `pnpm build` → `/app/dist`.
  2. `alpine` → download the pinned PocketBase binary (`TARGETARCH`, never `:latest`).
  3. final `alpine` → copy binary + `pocketbase/pb_migrations` + `pocketbase/pb_hooks` +
     `dist` → `/pb/pb_public`. `CMD pocketbase serve`.
- Build context = repo **root** (Coolify base directory `/`).
- `.dockerignore` keeps `node_modules`, `dist`, `.git`, `pocketbase/pb_data`, the local
  macOS `pocketbase` binary, and env files out of the image.
- Only `pb_data` is a runtime volume; SPA + schema are baked in (rebuilt each deploy).

## Frontend stack

- Vite + React 19 + TypeScript; Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js`).
- shadcn/ui conventions: `components.json`, `src/lib/utils.ts` (`cn()`),
  `src/components/ui/*`. First component: `button.tsx` (cva-based).
- `src/lib/pb.ts` — PocketBase singleton + typed `Federation` interface mirroring the schema.
  Uses `VITE_PB_URL` in dev, `window.location.origin` in prod (same-origin).
- `pnpm` pinned via `package.json#packageManager`; `pnpm-lock.yaml` committed for
  reproducible image builds.

## Dev vs prod

- **Dev:** bare PocketBase binary (:8090) + `pnpm dev` Vite server (:5173); SPA → PB via
  `VITE_PB_URL`.
- **Prod:** the combined image; PocketBase serves the SPA. No dev server, no CORS (same-origin).

## Out of scope

- Real Phase 1 UI (the federations data table + scrape buttons) — this spec only covers the
  container/build wiring and a minimal app shell.
