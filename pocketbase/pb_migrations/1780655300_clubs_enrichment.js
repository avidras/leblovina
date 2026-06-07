/// <reference path="../pb_data/types.d.ts" />

// Phase 2.6 — resolve-time website enrichment. Signals mined from the club's own
// page (already fetched during resolve) to pre-load Phase-3 contact extraction,
// plus a deep/section URL distinct from the canonical homepage root.
// See specs/club-website-enrichment.md.
//   website_emails = deterministically-extracted emails from the resolved page (json array)
//   contact_url    = best contact/impressum/about page link
//   socials        = {facebook,instagram,youtube,tiktok,twitter,linkedin} (present keys only)
//   site_lang      = 2-letter page language
//   section_url    = volleyball-section / deep link when distinct from the root
// Idempotent (skip each field that already exists) per CLAUDE.md crash-loop rule.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  if (!collection.fields.getByName("website_emails")) {
    collection.fields.add(new Field({
      name: "website_emails",
      type: "json",
      required: false,
      maxSize: 0,
    }));
  }
  if (!collection.fields.getByName("contact_url")) {
    collection.fields.add(new Field({
      name: "contact_url",
      type: "url",
      required: false,
      exceptDomains: null,
      onlyDomains: null,
    }));
  }
  if (!collection.fields.getByName("socials")) {
    collection.fields.add(new Field({
      name: "socials",
      type: "json",
      required: false,
      maxSize: 0,
    }));
  }
  if (!collection.fields.getByName("site_lang")) {
    collection.fields.add(new Field({
      name: "site_lang",
      type: "text",
      required: false,
    }));
  }
  if (!collection.fields.getByName("section_url")) {
    collection.fields.add(new Field({
      name: "section_url",
      type: "url",
      required: false,
      exceptDomains: null,
      onlyDomains: null,
    }));
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("clubs");
  ["website_emails", "contact_url", "socials", "site_lang", "section_url"].forEach((f) => {
    try { collection.fields.removeByName(f); } catch (e) {}
  });
  return app.save(collection);
});
