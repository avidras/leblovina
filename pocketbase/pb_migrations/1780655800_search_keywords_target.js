/// <reference path="../pb_data/types.d.ts" />

// Discovery v2 — generalize the keyword queue into a target-driven engine: each
// keyword carries a `target` = which collection it fills. `clubs` is the default
// (current behavior); `tournaments` lights up when that processor lands. See
// specs/search-led-discovery.md ("Generalization (v2)"). Idempotent; also applied
// live via the PB API.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("search_keywords");
  if (collection.fields.getByName("target")) return;
  collection.fields.add(new Field({
    name: "target",
    type: "select",
    required: false,
    maxSelect: 1,
    values: ["clubs", "tournaments"],
  }));
  app.save(collection);

  // Backfill existing rows (all pre-v2 keywords were club discovery).
  const rows = app.findRecordsByFilter("search_keywords", "target='' || target=null", "", 0, 0);
  for (const r of rows) { r.set("target", "clubs"); app.save(r); }
}, (app) => {
  const collection = app.findCollectionByNameOrId("search_keywords");
  collection.fields.removeByName("target");
  return app.save(collection);
});
