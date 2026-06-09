/// <reference path="../pb_data/types.d.ts" />

// Discovery: per-keyword Serper pagination depth. Broad keywords set pages=3
// (~30 deduped results); specific/one-off keywords stay at 1 (Serper caps a
// single request at 10). The processor (search-keyword-process) loops 1..pages.
// See specs/search-led-discovery.md.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("search_keywords");
  collection.fields.add(new Field({
    name: "pages",
    type: "number",
    required: false,
    min: 1,
    max: 5,
    onlyInt: true,
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("search_keywords");
  collection.fields.removeByName("pages");
  return app.save(collection);
});
