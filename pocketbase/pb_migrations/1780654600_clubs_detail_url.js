/// <reference path="../pb_data/types.d.ts" />

// Phase 2 — capture the catalog's per-club detail-page URL when present
// (e.g. Bulgaria's /subMenu/clubs/clubsList/club/138). These pages hold richer
// contact data (address, president, email, website) for Phase 3. See specs/club-discovery.md.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  collection.fields.add(new Field({
    name: "detail_url",
    type: "url",
    required: false,
    exceptDomains: null,
    onlyDomains: null,
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  collection.fields.removeByName("detail_url");
  return app.save(collection);
});
