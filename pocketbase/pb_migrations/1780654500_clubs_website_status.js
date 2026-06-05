/// <reference path="../pb_data/types.d.ts" />

// Phase 2.5 — club website enrichment. Track validate/resolve outcome per club.
// See specs/club-discovery.md (Stage 3).
//   unknown   = not checked yet
//   live      = website_url validated (responds)
//   dead      = provided URL was dead (404/unreachable) -> cleared
//   not_found = Serper searched, no credible site found (club likely has no website)
migrate((app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  collection.fields.add(new Field({
    name: "website_status",
    type: "select",
    required: false,
    maxSelect: 1,
    values: ["unknown", "live", "dead", "not_found"],
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  collection.fields.removeByName("website_status");
  return app.save(collection);
});
