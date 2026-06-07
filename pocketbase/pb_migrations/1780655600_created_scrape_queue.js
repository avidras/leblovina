/// <reference path="../pb_data/types.d.ts" />

// Site-scrape queue. The UI/enqueue webhook adds clubs (status='queued'); the
// `scrape-queue-drain` cron drains them in small bounded chunks with backpressure
// (queued -> processing -> done). One active row per club (unique). See
// specs/club-scrape-queue.md. Idempotent (also created live via the PB API).
migrate((app) => {
  try { app.findCollectionByNameOrId("scrape_queue"); return; } catch (e) { /* create */ }

  const clubs = app.findCollectionByNameOrId("clubs");

  const collection = new Collection({
    type: "base",
    name: "scrape_queue",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "club", type: "relation", required: true, collectionId: clubs.id, cascadeDelete: true, maxSelect: 1, minSelect: 0 },
      { name: "status", type: "select", required: false, maxSelect: 1, values: ["queued", "processing", "done", "error"] },
      { name: "force", type: "bool", required: false },
      { name: "enqueued_at", type: "date", required: false },
      { name: "processed_at", type: "date", required: false },
      { name: "attempts", type: "number", required: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_scrape_queue_club` ON `scrape_queue` (`club`)",
      "CREATE INDEX `idx_scrape_queue_status` ON `scrape_queue` (`status`)",
    ],
  });

  return app.save(collection);
}, (app) => {
  try { return app.delete(app.findCollectionByNameOrId("scrape_queue")); } catch (e) { /* gone */ }
});
