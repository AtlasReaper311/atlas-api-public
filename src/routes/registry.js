/**
 * /v1/registry: the estate registry in a stable public shape.
 *
 * Reads atlas-api-index over its service binding rather than REGISTRY_KV
 * directly: the binding couples this Worker to the registry's public
 * contract, KV would couple it to internal storage layout. The upstream
 * document is already KV-cached with an hourly cron behind it; a sixty
 * second edge cache here just absorbs card-refresh bursts.
 *
 * The reshape is the versioning promise in action: /v1 consumers get
 * this shape whatever the registry does internally, and the flattened
 * meta fields are exactly what the Lab's API panel already reads
 * (workers[*].meta.endpoints, surfaced as workers[*].endpoints).
 */

import { json, errorResponse } from "../lib/http.js";

export async function handleRegistry(_request, env, ctx) {
  const cache = globalThis.caches ? globalThis.caches.default : null;
  const cacheKey = new Request("https://atlas-api-public.internal/v1/registry");
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let upstream;
  try {
    upstream = await env.REGISTRY.fetch("https://atlas-api-index/", {
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return errorResponse(502, "registry upstream unreachable");
  }
  if (!upstream.ok) {
    return errorResponse(502, `registry upstream answered ${upstream.status}`);
  }

  const doc = await upstream.json();
  const body = {
    ok: true,
    generated_at: doc.generated_at,
    counts: doc.counts,
    workers: (doc.workers || []).map((worker) => ({
      name: worker.name,
      documented: Boolean(worker.documented),
      description: worker.meta?.description ?? null,
      version: worker.meta?.version ?? null,
      endpoints: worker.meta?.endpoints ?? [],
    })),
    source: "atlas-api-index",
  };

  const response = json(body, 200, { "cache-control": "public, max-age=60" });
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
