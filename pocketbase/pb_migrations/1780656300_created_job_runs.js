/// <reference path="../pb_data/types.d.ts" />

// `job_runs` — background-job activity log. Long-running n8n workflows write their
// own state here (start/heartbeat/finish) so the SPA can show a live "what's running"
// panel without ever touching the n8n API. `updated` doubles as the heartbeat; a stale
// `running` row = a died execution. Superuser-only rules (the SPA is superuser-authed).
// See specs/background-jobs.md. Idempotent.
migrate((app) => {
  try { app.findCollectionByNameOrId("job_runs"); return; } catch (e) { /* create */ }

  const collection = new Collection({
    type: "base",
    name: "job_runs",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "kind", type: "text", required: true, presentable: true, max: 0 },
      { name: "label", type: "text", required: false, max: 0 },
      { name: "status", type: "select", required: false, maxSelect: 1, values: ["running", "done", "error"] },
      { name: "total", type: "number", required: false },
      { name: "processed", type: "number", required: false },
      { name: "message", type: "text", required: false, max: 0 },
      { name: "started", type: "date", required: false },
      { name: "finished", type: "date", required: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX `idx_job_runs_status` ON `job_runs` (`status`)",
      "CREATE INDEX `idx_job_runs_updated` ON `job_runs` (`updated`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  try { return app.delete(app.findCollectionByNameOrId("job_runs")); } catch (e) { /* gone */ }
});
