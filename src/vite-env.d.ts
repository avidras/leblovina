/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PB_URL?: string
  readonly VITE_N8N_SCRAPE_FEDERATIONS_URL?: string
  readonly VITE_N8N_DISCOVER_CLUBS_URL?: string
  readonly VITE_N8N_BATCH_PROCESS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
