/// <reference path="../pb_data/types.d.ts" />

// Phase 2 — `clubs` collection. See specs/club-discovery.md.
// federations 1:N clubs 1:N contacts. Dedup by a computed `dedup_key`
// (source club id when present, else <fed>:<slug(name)>:<slug(city)>).
migrate((app) => {
  const federations = app.findCollectionByNameOrId("federations");

  const collection = new Collection({
    type: "base",
    name: "clubs",
    // Locked down — access via the app/n8n, not public.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "federation",
        type: "relation",
        required: true,
        collectionId: federations.id,
        cascadeDelete: false,
        maxSelect: 1,
        minSelect: 0,
      },
      { name: "name", type: "text", required: true, presentable: true, max: 0 },
      { name: "country", type: "text", required: false, max: 0 },
      { name: "region", type: "text", required: false, max: 0 },
      { name: "city", type: "text", required: false, max: 0 },
      {
        // May be empty until Stage 3 (Serper) resolves it.
        name: "website_url",
        type: "url",
        required: false,
        exceptDomains: null,
        onlyDomains: null,
      },
      {
        // Provenance of the URL.
        name: "website_source",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["official_list", "serper", "manual", "none"],
      },
      {
        // The directory page this club was scraped from.
        name: "source_url",
        type: "url",
        required: false,
        exceptDomains: null,
        onlyDomains: null,
      },
      // Source's own club id/code if any (Italy codice, PB/Egypt id).
      { name: "source_club_id", type: "text", required: false, max: 0 },
      // Stable dedup key — see spec. Required + unique.
      { name: "dedup_key", type: "text", required: true, max: 0 },
      {
        // Club-level status (Phase 3 contact-enrichment state).
        name: "status",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["new", "contacts_found", "no_contacts", "error", "needs_review"],
      },
      { name: "last_scraped", type: "date", required: false },
      { name: "notes", type: "text", required: false, max: 0 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_clubs_dedup_key` ON `clubs` (`dedup_key`)",
      "CREATE INDEX `idx_clubs_website_url` ON `clubs` (`website_url`)",
      "CREATE INDEX `idx_clubs_federation` ON `clubs` (`federation`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  return app.delete(app.findCollectionByNameOrId("clubs"));
});
