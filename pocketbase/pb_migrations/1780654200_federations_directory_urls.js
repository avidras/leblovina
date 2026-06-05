/// <reference path="../pb_data/types.d.ts" />

// Phase 2 — store discovered club-list directories as JSON on the federation.
// One entry per club-list page: { url, region, extraction_method }.
// (Decision: keep directory info on federations rather than a separate collection.)
migrate((app) => {
  const collection = app.findCollectionByNameOrId("federations");
  collection.fields.add(new Field({
    name: "directory_urls",
    type: "json",
    required: false,
    maxSize: 0,
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("federations");
  collection.fields.removeByName("directory_urls");
  return app.save(collection);
});
