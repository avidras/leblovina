/// <reference path="../pb_data/types.d.ts" />

// Mirror Brevo's `emailBlacklisted` onto each contact: a blocklisted (unsubscribed /
// marked-spam) address is excluded from the Brevo sync, from Reoon verification, and
// from CSV export — kept-but-flagged so we never re-contact an opted-out address.
// Set by the brevo-backfill (import/refresh) and the brevo-unsubscribe webhook.
// See specs/brevo-reoon-integration.md. Idempotent (skip if present).
migrate((app) => {
  const c = app.findCollectionByNameOrId("contacts");
  if (c.fields.getByName("blocklisted")) return;
  c.fields.add(new Field({ name: "blocklisted", type: "bool", required: false }));
  return app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("contacts");
  c.fields.removeByName("blocklisted");
  return app.save(c);
});
