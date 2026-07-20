/**
 * /v1/registry: the approved public Worker registry.
 *
 * atlas-api-index performs account-level discovery but publishes only its
 * explicit public allowlist. This route applies a second fail-closed boundary
 * from estate.manifest.json so an upstream regression cannot expose an
 * undeclared Worker through the versioned public API.
 */

import manifest from "../../data/estate.manifest.json" with { type: "json" };
import { json, errorResponse } from "../lib/http.js";

const PUBLIC_WORKERS = new Set(
  (manifest.components || [])
    .filter((component) => component?.kind === "worker" && component.indexed === true)
    .map((component) => component.name)
    .filter((name) => typeof name === "string" && name.length > 0),
);

export function publicRegistryWorkers(workers = []) {
  return workers
    .filter((worker) => worker && PUBLIC_WORKERS.has(worker.name))
    .map((worker) => ({
      name: worker.name,
      documented: Boolean(worker.documented),
      description: worker.meta?.description ?? null,
      version: worker.meta?.version ?? null,
      endpoints: worker.meta?.endpoints ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

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
  const workers = publicRegistryWorkers(doc.workers || []);
  const body = {
    ok: true,
    generated_at: doc.generated_at,
    counts: {
      workers: workers.length,
      documented: workers.filter((worker) => worker.documented).length,
      undocumented: workers.filter((worker) => !worker.documented).length,
    },
    workers,
    source: "atlas-api-index",
    projection: "public-only",
  };

  const response = json(body, 200, { "cache-control": "public, max-age=60" });
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
