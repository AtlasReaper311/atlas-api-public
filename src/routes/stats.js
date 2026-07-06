/**
 * /v1/stats: the estate at a glance, composed from what already exists.
 *
 * Nothing here probes anything at request time except one cached pulse
 * lookup; the expensive observation happened on the cron, and this
 * endpoint reads its snapshots. Uptime is measured, windowed, and
 * labelled with when measurement began; see lib/status.js for why the
 * estate has no older history to offer.
 */

import { json, nowIso } from "../lib/http.js";
import {
  readEstate,
  readUptime,
  uptimePercent,
  COMPONENTS,
} from "../lib/status.js";
import { readState, staleAfterMs } from "./infra.js";
import { readRagSummary } from "./rag.js";

async function fetchPulseTotals(env, ctx) {
  // github-pulse is itself KV-cached upstream; the hour of edge cache
  // here is about not paying a binding hop per stats request.
  const cache = globalThis.caches ? globalThis.caches.default : null;
  const cacheKey = new Request("https://atlas-api-public.internal/pulse-totals");
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.json();
  }
  try {
    const res = await env.GITHUB_PULSE.fetch("https://github-pulse/pulse", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const doc = await res.json();
    const totals = doc && doc.totals ? doc.totals : null;
    if (totals && cache && ctx) {
      const stored = new Response(JSON.stringify(totals), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=3600",
        },
      });
      ctx.waitUntil(cache.put(cacheKey, stored));
    }
    return totals;
  } catch {
    return null;
  }
}

export async function handleStats(_request, env, ctx) {
  const [estate, uptime, infra, rag, pulse] = await Promise.all([
    readEstate(env),
    readUptime(env),
    readState(env),
    readRagSummary(env),
    fetchPulseTotals(env, ctx),
  ]);

  let infraOverall = "unknown";
  if (infra) {
    const age = Date.now() - Date.parse(infra.last_report_at);
    const fresh = Number.isFinite(age) && age < staleAfterMs(env);
    infraOverall = fresh ? infra.overall : "down";
  }

  return json(
    {
      ok: true,
      repos: pulse
        ? { public: pulse.publicRepos ?? null, stars: pulse.stars ?? null }
        : null,
      estate: estate
        ? {
            operational: estate.operational,
            total_components: estate.total,
            components: Object.fromEntries(
              COMPONENTS.map((name) => [
                name,
                Boolean(estate.components?.[name]?.ok),
              ]),
            ),
            workers: estate.worker_counts,
            checked_at: estate.checked_at,
          }
        : null,
      uptime: uptime
        ? {
            window_days: uptime.window_days ?? null,
            measuring_since: uptime.started_at,
            components: Object.fromEntries(
              COMPONENTS.map((name) => [name, uptimePercent(uptime, name)]),
            ),
            note: "accrued from live probes since first deploy; no fabricated history",
          }
        : null,
      infra: infra
        ? { overall: infraOverall, last_report_at: infra.last_report_at }
        : { overall: "unknown", last_report_at: null },
      rag: {
        queries_today: rag?.queries_today ?? 0,
        queries_total: rag?.queries_total ?? 0,
      },
      generated_at: nowIso(),
    },
    200,
    { "cache-control": "public, max-age=60" },
  );
}
