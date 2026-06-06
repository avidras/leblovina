/// <reference path="../pb_data/types.d.ts" />

// Provenance per contact: directory / club_site / manual.
// Idempotent: the field may already exist (added live via the PB API, or created
// inline by 1780654700 on a fresh DB) — skip if present to avoid a boot failure.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("contacts");
  if (collection.fields.getByName("source_type")) return;
  collection.fields.add(new Field({
    name: "source_type",
    type: "select",
    required: false,
    maxSelect: 1,
    values: ["directory", "club_site", "manual"],
  }));
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("contacts");
  collection.fields.removeByName("source_type");
  return app.save(collection);
});
