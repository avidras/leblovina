/// <reference path="../pb_data/types.d.ts" />

// Search-led club discovery ("No federation – Google"). A second discovery channel:
// keyword -> web search -> strict classifier -> URL-host dedup -> create club + scrape.
// See specs/search-led-discovery.md. This migration:
//   (1) adds `search` to clubs.website_source (URL provenance for search-found clubs)
//   (2) creates `search_keywords` (registry + per-keyword tracking log; mirrors scrape_queue)
//   (3) seeds settings.search_discover (Pause/cap control, like settings.scrape_drain)
//   (4) seeds the GGL pseudo-federation that holds all search-discovered clubs
// Each step is idempotent (skip if already present) per CLAUDE.md's crash-loop rule —
// the schema is also created live via the PB API so the pilot can run before this deploys.
migrate((app) => {
  // (1) website_source gains `search`
  {
    const clubs = app.findCollectionByNameOrId("clubs");
    const f = clubs.fields.getByName("website_source");
    if (f && Array.isArray(f.values) && f.values.indexOf("search") === -1) {
      f.values = f.values.concat(["search"]);
      app.save(clubs);
    }
  }

  // (2) search_keywords collection
  try {
    app.findCollectionByNameOrId("search_keywords");
  } catch (e) {
    const collection = new Collection({
      type: "base",
      name: "search_keywords",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "keyword", type: "text", required: true, presentable: true, max: 0 },
        { name: "country", type: "text", required: false, max: 0 },
        { name: "lang", type: "text", required: false, max: 0 },
        { name: "status", type: "select", required: false, maxSelect: 1, values: ["pending", "searching", "searched", "error"] },
        { name: "searched_at", type: "date", required: false },
        { name: "results_count", type: "number", required: false },
        { name: "accepted_count", type: "number", required: false },
        { name: "new_clubs", type: "number", required: false },
        { name: "dup_count", type: "number", required: false },
        { name: "attempts", type: "number", required: false },
        { name: "notes", type: "text", required: false, max: 0 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_search_keywords_keyword` ON `search_keywords` (`keyword`)",
        "CREATE INDEX `idx_search_keywords_status` ON `search_keywords` (`status`)",
      ],
    });
    app.save(collection);
  }

  // (3) settings.search_discover control row (paused by default; same model as scrape_drain)
  {
    const settings = app.findCollectionByNameOrId("settings");
    let exists = false;
    try { app.findFirstRecordByFilter("settings", "key='search_discover'"); exists = true; } catch (e) { /* seed */ }
    if (!exists) {
      const rec = new Record(settings);
      rec.set("key", "search_discover");
      rec.set("value", { enabled: false, batch_size: 5 });
      app.save(rec);
    }
  }

  // (4) GGL pseudo-federation ("No federation – Google")
  {
    const feds = app.findCollectionByNameOrId("federations");
    let exists = false;
    try { app.findFirstRecordByFilter("federations", "fivb_code='GGL'"); exists = true; } catch (e) { /* seed */ }
    if (!exists) {
      const rec = new Record(feds);
      rec.set("fivb_code", "GGL");
      rec.set("name", "No federation – Google");
      rec.set("country", "Global");   // `country` is a required field; GGL spans all geographies
      rec.set("confederation", "");
      rec.set("status", "scraped");
      rec.set("notes", "Pseudo-federation holding clubs found by search-led discovery (see specs/search-led-discovery.md).");
      app.save(rec);
    }
  }
}, (app) => {
  // Down: drop the collection + seeded rows; leave the website_source enum widened
  // (removing an in-use enum value would orphan data).
  try { app.delete(app.findCollectionByNameOrId("search_keywords")); } catch (e) { /* gone */ }
  try { app.delete(app.findFirstRecordByFilter("settings", "key='search_discover'")); } catch (e) { /* gone */ }
  try { app.delete(app.findFirstRecordByFilter("federations", "fivb_code='GGL'")); } catch (e) { /* gone */ }
});
