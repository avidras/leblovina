/// <reference path="../pb_data/types.d.ts" />

// Site-scrape page-capture audit trail. clubs 1:N scrape_pages. For each page the
// site-scraper fetched we record metadata + the cleaned text the LLM saw + the raw
// HTML/markdown (as a file attachment, stored on disk not in SQLite). Re-scrape
// replaces a club's rows. See specs/club-scrape-page-capture.md.
// Idempotent: also created live via the PB API, so on a DB that already has it the
// create is skipped (prevents a "name must be unique" boot failure on redeploy).
migrate((app) => {
  try { app.findCollectionByNameOrId("scrape_pages"); return; } catch (e) { /* not found -> create */ }

  const clubs = app.findCollectionByNameOrId("clubs");

  const collection = new Collection({
    type: "base",
    name: "scrape_pages",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "club",
        type: "relation",
        required: true,
        collectionId: clubs.id,
        cascadeDelete: true,
        maxSelect: 1,
        minSelect: 0,
      },
      { name: "url", type: "text", required: false, presentable: true, max: 0 },
      { name: "role", type: "select", required: false, maxSelect: 1, values: ["homepage", "candidate", "detail"] },
      { name: "method", type: "select", required: false, maxSelect: 1, values: ["http", "firecrawl"] },
      { name: "http_status", type: "number", required: false },
      { name: "bytes", type: "number", required: false },
      { name: "used", type: "bool", required: false },
      { name: "emails_found", type: "number", required: false },
      { name: "text", type: "text", required: false, max: 0 },
      {
        name: "raw",
        type: "file",
        required: false,
        maxSelect: 1,
        maxSize: 5242880,
        mimeTypes: [],
        thumbs: [],
        protected: false,
      },
      { name: "run_at", type: "date", required: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX `idx_scrape_pages_club` ON `scrape_pages` (`club`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  try { return app.delete(app.findCollectionByNameOrId("scrape_pages")); } catch (e) { /* gone */ }
});
