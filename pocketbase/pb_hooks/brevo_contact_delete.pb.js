/// <reference path="../pb_data/types.d.ts" />

// Brevo delete sync: when a contact is removed here (UI, PB admin, API, or a club
// cascade-delete), tell n8n to hard-delete it in Brevo so the two never drift.
// The Brevo API key stays in n8n — this hook only POSTs the email to the webhook.
// Non-fatal: a Brevo/n8n outage logs and is ignored, never blocking the PB delete.
// See specs/brevo-reoon-integration.md.
onRecordAfterDeleteSuccess((e) => {
  const email = e.record.get("email");
  if (email) {
    const url = $os.getenv("N8N_BREVO_DELETE_URL") ||
      "https://n8n-2.biceps.digital/webhook/brevo-contact-delete";
    try {
      $http.send({
        url: url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
        timeout: 10,
      });
    } catch (err) {
      console.log("brevo delete hook failed for", email, "-", err);
    }
  }
  e.next();
}, "contacts");
