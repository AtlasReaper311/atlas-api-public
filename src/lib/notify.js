/**
 * atlas-notify dispatch for atlas-api-public.
 *
 * Same shape as the shipped atlas-api-index module: Service Binding
 * first (Worker-to-Worker inside Cloudflare's network, no public hop),
 * URL fallback for local dev, and never throws, because a failed embed
 * must never fail the pipeline it reports on.
 *
 * One divergence from the env-var pattern, on purpose: this Worker
 * emits two signal classes (infra_health, rag_queries), so the class is
 * a per-call argument instead of a single NOTIFY_SIGNAL_CLASS var.
 * atlas-notify's CLASS_WEBHOOK_SECRETS map routes each to its channel.
 */

export async function notify(env, event, signalClass) {
  if (!env.NOTIFY_TOKEN) {
    console.log("notify: NOTIFY_TOKEN not set; skipping");
    return;
  }

  const body = {
    source: "alert",
    signal_class: signalClass || undefined,
    level: event.level,
    title: event.title,
    message: event.message,
    fields: event.fields,
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);

  const requestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.NOTIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  };

  try {
    let response;
    if (env.ATLAS_NOTIFY) {
      response = await env.ATLAS_NOTIFY.fetch("https://atlas-notify/notify", requestInit);
    } else if (env.NOTIFY_URL) {
      response = await fetch(env.NOTIFY_URL, requestInit);
    } else {
      console.log("notify: no ATLAS_NOTIFY binding or NOTIFY_URL");
      return;
    }
    console.log("notify: status", response.status, "class:", signalClass, "title:", event.title);
  } catch (err) {
    console.log("notify failed:", err.message);
  }
}
