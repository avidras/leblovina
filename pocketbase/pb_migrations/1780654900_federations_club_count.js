/// <reference path="../pb_data/types.d.ts" />

// Phase 2.1 — deterministic detected club count per federation, written by the
// extractors (exact array length for API/embedded-JSON; table-row/list-item count
// for HTML/PDF). Independent of the LLM extraction so the Phase-3 count QA can flag
// under-extraction (created << club_count). See specs/implementation-roadmap.md.
migrate((app) => {
  const c = app.findCollectionByNameOrId("federations");
  c.fields.add(new Field({ name: "club_count", type: "number", required: false, onlyInt: true }));
  return app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("federations");
  c.fields.removeByName("club_count");
  return app.save(c);
});
