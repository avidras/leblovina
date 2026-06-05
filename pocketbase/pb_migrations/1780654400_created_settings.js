/// <reference path="../pb_data/types.d.ts" />

// Phase 2 — `settings` key/value collection for UI-controllable workflow knobs.
// Notably `extraction_gate` (review_all | auto_safe | auto_all). See specs/club-discovery.md.
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "settings",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "key", type: "text", required: true, presentable: true, max: 0 },
      // JSON so a knob can hold a string, number, or object.
      { name: "value", type: "json", required: false, maxSize: 0 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_settings_key` ON `settings` (`key`)",
    ],
  });
  app.save(collection);

  // Seed the default gate policy.
  const rec = new Record(collection);
  rec.set("key", "extraction_gate");
  rec.set("value", "auto_safe");
  app.save(rec);
}, (app) => {
  return app.delete(app.findCollectionByNameOrId("settings"));
});
