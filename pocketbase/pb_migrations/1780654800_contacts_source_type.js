/// <reference path="../pb_data/types.d.ts" />

// Provenance per contact: where it came from.
//   directory  = federation directory (list / PDF / club detail page)
//   club_site  = Phase-3 crawl of the club's own website
//   manual     = entered by hand
migrate((app) => {
  const collection = app.findCollectionByNameOrId("contacts");
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
