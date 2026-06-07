/// <reference path="../pb_data/types.d.ts" />

// Phase 2.5 — post-resolve "does this site belong to the club?" check.
// Orthogonal to website_status (reachability): website_confidence is the
// "belongs to THIS club" axis. See specs/club-website-belongs-check.md.
//   unknown = not checked yet
//   A       = trusted (official_list/manual provenance, or strong content match)
//   B       = probable (Haiku-confirmed, or moderate content match)
//   C       = low confidence -> human triage on the Clubs page
// Idempotent (skip if the field already exists) per CLAUDE.md crash-loop rule.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  if (collection.fields.getByName("website_confidence")) return;
  collection.fields.add(new Field({
    name: "website_confidence",
    type: "select",
    required: false,
    maxSelect: 1,
    values: ["unknown", "A", "B", "C"],
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  collection.fields.removeByName("website_confidence");
  return app.save(collection);
});
