/// <reference path="../pb_data/types.d.ts" />

// Phase 3 (brought forward) — `contacts` collection. clubs 1:N contacts.
// Seeded during Phase-2 extraction when a directory exposes contacts (list/PDF/
// detail page); Phase 3's verifier later fills verification_status/verified_at/
// quality. See specs/club-contacts-from-directory.md.
//   Domain rule #1: only ever store an email that was deterministically present
//   in the source — never pattern-guessed or AI-invented.
// Idempotent: this collection was first created live via the PB API, so on a DB
// that already has it the create is skipped (prevents a "name must be unique"
// boot failure on redeploy); on a fresh DB it creates normally.
migrate((app) => {
  try { app.findCollectionByNameOrId("contacts"); return; } catch (e) { /* not found -> create */ }

  const clubs = app.findCollectionByNameOrId("clubs");

  const collection = new Collection({
    type: "base",
    name: "contacts",
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
      { name: "email", type: "text", required: true, presentable: true, max: 0 },
      { name: "name", type: "text", required: false, max: 0 },
      { name: "position", type: "text", required: false, max: 0 },
      { name: "phone", type: "text", required: false, max: 0 },
      { name: "source_url", type: "url", required: false, exceptDomains: null, onlyDomains: null },
      {
        name: "source_type",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["directory", "club_site", "manual"],
      },
      {
        name: "verification_status",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["unverified", "mx_only", "verified", "catch_all", "undeliverable", "unknown"],
      },
      { name: "verified_at", type: "date", required: false },
      { name: "quality", type: "select", required: false, maxSelect: 1, values: ["A", "B", "C"] },
      { name: "notes", type: "text", required: false, max: 0 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_contacts_email` ON `contacts` (`email`)",
      "CREATE INDEX `idx_contacts_club` ON `contacts` (`club`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  try { return app.delete(app.findCollectionByNameOrId("contacts")); } catch (e) { /* gone */ }
});
