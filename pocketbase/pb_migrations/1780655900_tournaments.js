/// <reference path="../pb_data/types.d.ts" />

// Tournament-led discovery — a third lead route. See specs/tournament-led-discovery.md.
//   (1) `tournaments` collection (discovered tournament entities)
//   (2) clubs.federation -> OPTIONAL (a club can belong to a federation OR a tournament)
//   (3) clubs.tournament relation (provenance of a tournament-discovered club)
//   (4) clubs.website_source += `tournament`
// Each step idempotent (CLAUDE.md crash-loop rule); also applied live via the PB API.
migrate((app) => {
  // (1) tournaments collection
  try {
    app.findCollectionByNameOrId("tournaments");
  } catch (e) {
    const col = new Collection({
      type: "base",
      name: "tournaments",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "name", type: "text", required: true, presentable: true, max: 0 },
        { name: "keyword", type: "text", required: false, max: 0 },
        { name: "country", type: "text", required: false, max: 0 },
        { name: "website_url", type: "url", required: false, exceptDomains: null, onlyDomains: null },
        { name: "participants_url", type: "url", required: false, exceptDomains: null, onlyDomains: null },
        { name: "platform", type: "text", required: false, max: 0 },
        { name: "status", type: "select", required: false, maxSelect: 1, values: ["pending", "searching", "found", "extracted", "no_participants", "error", "needs_review"] },
        { name: "source", type: "select", required: false, maxSelect: 1, values: ["google", "manual"] },
        { name: "results_count", type: "number", required: false },
        { name: "participants_count", type: "number", required: false },
        { name: "clubs_found", type: "number", required: false },
        { name: "attempts", type: "number", required: false },
        { name: "last_run", type: "date", required: false },
        { name: "notes", type: "text", required: false, max: 0 },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      // one tournament entity per discovery keyword (find-or-create on re-run)
      indexes: ["CREATE UNIQUE INDEX `idx_tournaments_keyword` ON `tournaments` (`keyword`)"],
    });
    app.save(col);
  }

  // (2) clubs.federation -> optional
  {
    const clubs = app.findCollectionByNameOrId("clubs");
    const fed = clubs.fields.getByName("federation");
    if (fed && fed.required) { fed.required = false; fed.minSelect = 0; app.save(clubs); }
  }

  // (3) clubs.tournament relation
  {
    const clubs = app.findCollectionByNameOrId("clubs");
    if (!clubs.fields.getByName("tournament")) {
      const tcol = app.findCollectionByNameOrId("tournaments");
      clubs.fields.add(new Field({
        name: "tournament", type: "relation", required: false,
        collectionId: tcol.id, cascadeDelete: false, maxSelect: 1, minSelect: 0,
      }));
      app.save(clubs);
    }
  }

  // (4) clubs.website_source += tournament
  {
    const clubs = app.findCollectionByNameOrId("clubs");
    const ws = clubs.fields.getByName("website_source");
    if (ws && Array.isArray(ws.values) && ws.values.indexOf("tournament") === -1) {
      ws.values = ws.values.concat(["tournament"]);
      app.save(clubs);
    }
  }
}, (app) => {
  // down: drop the relation + collection; leave federation optional + the enum value widened.
  try { const c = app.findCollectionByNameOrId("clubs"); c.fields.removeByName("tournament"); app.save(c); } catch (e) { /* gone */ }
  try { app.delete(app.findCollectionByNameOrId("tournaments")); } catch (e) { /* gone */ }
});
