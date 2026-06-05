/// <reference path="../pb_data/types.d.ts" />

// Phase 2 — per-federation override for the UI-controlled extraction gate.
// See specs/club-discovery.md (decision 5).
migrate((app) => {
  const collection = app.findCollectionByNameOrId("federations");
  collection.fields.add(new Field({
    name: "gate_override",
    type: "select",
    required: false,
    maxSelect: 1,
    values: ["default", "always_review", "always_auto"],
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("federations");
  collection.fields.removeByName("gate_override");
  return app.save(collection);
});
