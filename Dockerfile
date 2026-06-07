# syntax=docker/dockerfile:1
# Single container: PocketBase serving the built Vite SPA from pb_public.
# UI, REST API, and admin all run on one port (8090). See specs/frontend-container.md.

# ---- Stage 1: build the Vite/React SPA ----
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /app
# Vite inlines VITE_* into the bundle at BUILD time. Coolify must pass these as build args
# (mark each env var "Available at Buildtime"); we promote them to ENV so `pnpm build` sees
# them. Changing any of these requires a redeploy (rebuild). VITE_PB_URL is optional in prod
# (the app falls back to same-origin, since PocketBase serves this SPA).
# NOTE: these are OPTIONAL — src/lib/n8n.ts defaults every webhook URL to the n8n instance +
# path, so the app works even if none are passed. Set a var here (+ in Coolify, buildtime) only
# to override a specific webhook (e.g. point at a different n8n).
ARG VITE_PB_URL
ARG VITE_N8N_BASE_URL
ARG VITE_N8N_DISCOVER_CLUBS_URL
ARG VITE_N8N_BATCH_PROCESS_URL
ARG VITE_N8N_EXTRACT_CLUBS_URL
ARG VITE_N8N_BATCH_ENRICH_URL
ARG VITE_N8N_ENGLISHIZE_CLUBS_URL
ARG VITE_N8N_SITE_SCRAPE_URL
ARG VITE_N8N_SCRAPE_ENQUEUE_URL
ARG VITE_N8N_SEARCH_KEYWORDS_URL
ENV VITE_PB_URL=$VITE_PB_URL \
    VITE_N8N_BASE_URL=$VITE_N8N_BASE_URL \
    VITE_N8N_DISCOVER_CLUBS_URL=$VITE_N8N_DISCOVER_CLUBS_URL \
    VITE_N8N_BATCH_PROCESS_URL=$VITE_N8N_BATCH_PROCESS_URL \
    VITE_N8N_EXTRACT_CLUBS_URL=$VITE_N8N_EXTRACT_CLUBS_URL \
    VITE_N8N_BATCH_ENRICH_URL=$VITE_N8N_BATCH_ENRICH_URL \
    VITE_N8N_ENGLISHIZE_CLUBS_URL=$VITE_N8N_ENGLISHIZE_CLUBS_URL \
    VITE_N8N_SITE_SCRAPE_URL=$VITE_N8N_SITE_SCRAPE_URL \
    VITE_N8N_SCRAPE_ENQUEUE_URL=$VITE_N8N_SCRAPE_ENQUEUE_URL \
    VITE_N8N_SEARCH_KEYWORDS_URL=$VITE_N8N_SEARCH_KEYWORDS_URL
# Install deps first for layer caching (packageManager pin drives the pnpm version).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build                      # -> /app/dist

# ---- Stage 2: fetch the pinned PocketBase binary (never :latest) ----
FROM alpine:3.20 AS pb
ARG PB_VERSION=0.39.1
# TARGETARCH (amd64/arm64) is provided by buildkit; matches PocketBase asset names.
ARG TARGETARCH
RUN apk add --no-cache ca-certificates unzip wget
WORKDIR /pb
RUN wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O pb.zip \
    && unzip pb.zip \
    && rm pb.zip

# ---- Final: PocketBase + baked schema + built SPA ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /pb
COPY --from=pb /pb/pocketbase /pb/pocketbase
# Schema as code — auto-applies on boot. Only pb_data is a runtime volume.
COPY pocketbase/pb_migrations /pb/pb_migrations
COPY pocketbase/pb_hooks /pb/pb_hooks
# The SPA: PocketBase serves /pb/pb_public at "/" (with SPA index fallback).
COPY --from=web /app/dist /pb/pb_public

EXPOSE 8090
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
