/// <reference path="../pb_data/types.d.ts" />

// Phase 5 — per-club outcome of the last site-scrape run (e.g. "site-scrape: 4
// contacts from beach44.ee", "site-scrape: 0 contacts — no email on site",
// "site-scrape: no content fetched (JS-rendered or blocked)"). Shown in the Clubs
// list. Idempotent (skip if present — may be added live via the PB API).
migrate((app) => {
  const c = app.findCollectionByNameOrId("clubs");
  if (c.fields.getByName("scrape_note")) return;
  c.fields.add(new Field({ name: "scrape_note", type: "text", required: false, max: 0 }));
  return app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("clubs");
  c.fields.removeByName("scrape_note");
  return app.save(c);
});
