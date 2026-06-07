/// <reference path="../pb_data/types.d.ts" />

// Phase 2.5 — club-type axis from the post-resolve check. Orthogonal to both
// website_status (reachability) and website_confidence (belongs). Tags what KIND
// of club the resolved site is. See specs/club-website-belongs-check.md (Round 2).
//   unknown    = not classified
//   volleyball = dedicated volleyball club
//   multisport = multi-sport club with a volleyball section (still a valid lead)
// Idempotent (skip if the field already exists) per CLAUDE.md crash-loop rule.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  if (collection.fields.getByName("club_type")) return;
  collection.fields.add(new Field({
    name: "club_type",
    type: "select",
    required: false,
    maxSelect: 1,
    values: ["unknown", "volleyball", "multisport"],
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  collection.fields.removeByName("club_type");
  return app.save(collection);
});
