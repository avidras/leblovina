/// <reference path="../pb_data/types.d.ts" />

// English/Latin rendering of a non-Latin club name (romanize proper nouns +
// translate generic descriptors). The native `name` is never modified; UI shows
// `name_en` as primary when present, and export's Club column = name_en || name.
// Populated by the `englishize-clubs` n8n workflow for clubs whose name is in a
// non-Latin script. Idempotent (skip if present — may be added live via the PB API).
// See specs/club-name-englishization.md.
migrate((app) => {
  const c = app.findCollectionByNameOrId("clubs");
  if (c.fields.getByName("name_en")) return;
  c.fields.add(new Field({ name: "name_en", type: "text", required: false, max: 0 }));
  return app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("clubs");
  c.fields.removeByName("name_en");
  return app.save(c);
});
