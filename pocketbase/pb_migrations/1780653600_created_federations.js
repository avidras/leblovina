/// <reference path="../pb_data/types.d.ts" />

// Phase 1 — `federations` collection.
// Schema as code so it's versioned (CLAUDE.md: define schema via migrations).
// API shape matches PocketBase v0.23+ (modern `app` + `fields` migrations).
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "federations",
    // Locked down by default — access goes through the app/n8n, not public.
    // Open these rules up later if the UI talks to PB without an admin token.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "name",
        type: "text",
        required: true,
        presentable: true,
        max: 0,
      },
      {
        name: "country",
        type: "text",
        required: true,
        max: 0,
      },
      {
        // CEV / AVC / CAVB / NORCECA / CSV — also the region tag.
        name: "confederation",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["CEV", "AVC", "CAVB", "NORCECA", "CSV"],
      },
      {
        name: "website_url",
        type: "url",
        required: false,
        exceptDomains: null,
        onlyDomains: null,
      },
      {
        // The page listing member clubs — input to Phase 2.
        name: "club_directory_url",
        type: "url",
        required: false,
        exceptDomains: null,
        onlyDomains: null,
      },
      {
        name: "extraction_method",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["static", "js", "api_endpoint", "pdf", "none"],
      },
      {
        // Provenance — where we found this federation.
        name: "source_url",
        type: "url",
        required: false,
        exceptDomains: null,
        onlyDomains: null,
      },
      {
        name: "status",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["new", "scraped", "error", "needs_review"],
      },
      {
        // Null until first scrape.
        name: "last_scraped",
        type: "date",
        required: false,
      },
      {
        name: "notes",
        type: "text",
        required: false,
        max: 0,
      },
      {
        name: "created",
        type: "autodate",
        onCreate: true,
        onUpdate: false,
      },
      {
        name: "updated",
        type: "autodate",
        onCreate: true,
        onUpdate: true,
      },
    ],
    // Dedup across reruns is enforced here (CLAUDE.md domain rule 2).
    indexes: [
      "CREATE UNIQUE INDEX `idx_federations_country` ON `federations` (`country`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("federations");
  return app.delete(collection);
});
