/**
 * /v1/slo: the raw material for error budget maths, served thin.
 *
 * The per-day probe counters already accrued for /v1/stats are the
 * estate's only real availability history, so this route exposes them
 * as data instead of pre-chewed verdicts. Targets live with the status
 * page (a static slo.json it can tune without touching this Worker);
 * the burn-down is arithmetic the client can do honestly because the
 * window, the start date, and every day bucket are all in the response.
 *
 * Older buckets predate probe duration capture and carry no ms fields;
 * the aggregates below treat absence as zero observations, never as
 * zero milliseconds.
 */

import { json, nowIso } from "../lib/http.js";
import { readUptime, COMPONENTS } from "../lib/status.js";

export async function handleSlo(_request, env) {
  const doc = await readUptime(env);
  const components = {};

  if (doc && doc.components) {
    for (const name of COMPONENTS) {
      const days = doc.components[name];
      if (!days) continue;
      let ok = 0;
      let total = 0;
      let msSum = 0;
      let msCount = 0;
      const dayKeys = Object.keys(days).sort();
      for (const key of dayKeys) {
        const bucket = days[key];
        ok += bucket.ok || 0;
        total += bucket.total || 0;
        msSum += bucket.ms_sum || 0;
        msCount += bucket.ms_count || 0;
      }
      components[name] = {
        days,
        days_observed: dayKeys.length,
        first_day: dayKeys[0] || null,
        ok,
        total,
        avg_ms: msCount > 0 ? Math.round(msSum / msCount) : null,
      };
    }
  }

  return json(
    {
      ok: true,
      measuring_since: doc?.started_at || null,
      window_days: doc?.window_days ?? Number(env.UPTIME_WINDOW_DAYS || "30"),
      components,
      note: "per-day probe counters, one pass every ten minutes, pruned past the window; measurement began at first deploy and no older history exists",
      generated_at: nowIso(),
    },
    200,
    { "cache-control": "public, max-age=60" },
  );
}
