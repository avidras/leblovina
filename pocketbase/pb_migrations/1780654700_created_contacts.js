/// <reference path="../pb_data/types.d.ts" />

// Phase 3 (brought forward) — `contacts` collection. clubs 1:N contacts.
// Seeded during Phase-2 extraction when a directory exposes contacts (list/PDF/
// detail page); Phase 3's verifier later fills verification_status/verified_at/
// quality. See specs/club-contacts-from-directory.md.
//   Domain rule #1: only ever store an email that was deterministically present
//   in the source — never pattern-guessed or AI-invented.
migrate((app) => {
  const clubs = app.findCollectionByNameOrId("clubs");

  const collection = new Collection({
    type: "base",
    name: "contacts",
    // Locked down — access via the app/n8n, not public.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        name: "club",
        type: "relation",
        required: true,
        collectionId: clubs.id,
        cascadeDelete: true,
        maxSelect: 1,
        minSelect: 0,
      },
      // The only required contact field. Never invented (domain rule #1).
      { name: "email", type: "text", required: true, presentable: true, max: 0 },
      // Contact person name, optional.
      { name: "name", type: "text", required: false, max: 0 },
      // Role/title, optional (e.g. "President", "Secretary").
      { name: "position", type: "text", required: false, max: 0 },
      { name: "phone", type: "text", required: false, max: 0 },
      {
        // Provenance per contact — the list/PDF/detail page it came from.
        name: "source_url",
        type: "url",
        required: false,
        exceptDomains: null,
        onlyDomains: null,
      },
      {
        // State, not a boolean. Directory-harvested contacts start unverified.
        name: "verification_status",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["unverified", "mx_only", "verified", "catch_all", "undeliverable", "unknown"],
      },
      { name: "verified_at", type: "date", required: false },
      {
        // Computed in Phase 3, null now.
        name: "quality",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["A", "B", "C"],
      },
      { name: "notes", type: "text", required: false, max: 0 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      // Outreach-level dedup — find-or-create by email.
      "CREATE UNIQUE INDEX `idx_contacts_email` ON `contacts` (`email`)",
      "CREATE INDEX `idx_contacts_club` ON `contacts` (`club`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  return app.delete(app.findCollectionByNameOrId("contacts"));
});
