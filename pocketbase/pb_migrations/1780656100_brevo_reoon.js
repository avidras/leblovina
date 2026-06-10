/// <reference path="../pb_data/types.d.ts" />

// Brevo sync + Reoon verification. See specs/brevo-reoon-integration.md.
//   - contacts.club becomes optional (backfilled Brevo contacts have no club).
//   - contacts.source_type gains "brevo".
//   - seed settings.brevo (push target list + last_sync) and settings.reoon (verify config).
// Idempotent throughout (re-runs on an already-migrated DB are no-ops): a field is only
// mutated if it still needs it, and a settings row is only seeded if its key is absent —
// otherwise a redeploy crash-loops the container on a duplicate write.
migrate((app) => {
  const contacts = app.findCollectionByNameOrId("contacts");

  // club: required -> optional (only flip if still required).
  const club = contacts.fields.getByName("club");
  if (club && club.required) {
    club.required = false;
    app.save(contacts);
  }

  // source_type: add "brevo" (only if missing).
  const st = contacts.fields.getByName("source_type");
  if (st && !st.values.includes("brevo")) {
    st.values = st.values.concat(["brevo"]);
    app.save(contacts);
  }

  // Seed settings knobs, skipping any key that already exists.
  const settings = app.findCollectionByNameOrId("settings");
  const seed = (key, value) => {
    try { app.findFirstRecordByData("settings", "key", key); return; } catch (e) { /* absent */ }
    const rec = new Record(settings);
    rec.set("key", key);
    rec.set("value", value);
    app.save(rec);
  };
  // list_id = the Brevo contact list the newsletter audience lives in (set via PB admin).
  seed("brevo", { list_id: null, last_sync: null });
  // mode = Reoon depth (power|quick); reverify_days = skip-window (domain rule #3).
  seed("reoon", { mode: "power", reverify_days: 90, last_run: null });
}, (app) => {
  // Down: drop "brevo" from source_type and re-require club. (Leave settings rows; harmless.)
  try {
    const contacts = app.findCollectionByNameOrId("contacts");
    const st = contacts.fields.getByName("source_type");
    if (st && st.values.includes("brevo")) {
      st.values = st.values.filter((v) => v !== "brevo");
      app.save(contacts);
    }
  } catch (e) { /* gone */ }
});
