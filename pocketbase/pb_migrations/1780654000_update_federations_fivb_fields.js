/// <reference path="../pb_data/types.d.ts" />

// Phase 1 — add VIS-sourced identity + federation contact fields to `federations`.
// See specs/federations-ingest.md. Append-only: do not edit the create migration.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("federations");

  // Stable find-or-create key (VIS `Code`, e.g. AFG) — replaces country as the dedup key.
  collection.fields.add(new Field({
    name: "fivb_code",
    type: "text",
    required: true,
    presentable: true,
    max: 0,
  }));

  // Federation-level contacts — real, deterministically extracted from the VIS API.
  collection.fields.add(new Field({
    name: "president",
    type: "text",
    required: false,
    max: 0,
  }));
  collection.fields.add(new Field({
    name: "general_secretary",
    type: "text",
    required: false,
    max: 0,
  }));
  collection.fields.add(new Field({
    // May hold multiple addresses (VIS returns them ;/,-separated). Stored verbatim;
    // split into per-contact rows in Phase 3.
    name: "email",
    type: "text",
    required: false,
    max: 0,
  }));
  collection.fields.add(new Field({
    name: "phone",
    type: "text",
    required: false,
    max: 0,
  }));

  // Identity moves to fivb_code; country becomes a plain (non-unique) field.
  collection.indexes = [
    "CREATE UNIQUE INDEX `idx_federations_fivb_code` ON `federations` (`fivb_code`)",
  ];

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("federations");

  collection.fields.removeByName("fivb_code");
  collection.fields.removeByName("president");
  collection.fields.removeByName("general_secretary");
  collection.fields.removeByName("email");
  collection.fields.removeByName("phone");

  collection.indexes = [
    "CREATE UNIQUE INDEX `idx_federations_country` ON `federations` (`country`)",
  ];

  return app.save(collection);
});
