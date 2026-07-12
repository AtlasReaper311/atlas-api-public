/**
 * Estate status: one computation, four consumers (cron writes it;
 * /v1/stats, /v1/slo, and /v1/badge/status read it).
 *
 * "Uptime pulled from atlas-status" resolved honestly: the status page
 * is a client-side live checker with no history, so no uptime history
 * exists anywhere in the estate. This module accrues its own, one
 * probe pass per cron tick into per-day counters, and every reader
 * labels the observation window. Measured-since-deploy beats invented
 * history; a senior reader trusts the first and discounts the second.
 *
 * Ten components, probed where they actually live:
 *   registry        atlas-api-index /_meta via service binding
 *   notify          atlas-notify /health via service binding
 *   specular        the telemetry pipeline end to end; specular-edge
 *                   /specular via binding, ok only when online is not
 *                   false (the Worker up with the tunnel down is down)
 *   specular_edge   the same single fetch, judged on reachability
 *                   alone, so the edge Worker and the pipeline it
 *                   fronts accrue separate honest histories
 *   corpus          corpus.atlas-systems.uk /health over the public
 *                   tunnel, ok only when the service itself says ok
 *   machine         sentinel report freshness plus its overall verdict
 *   ramone_trigger  ramone-trigger /trigger/_meta via service binding
 *   github_pulse    github-pulse /pulse via service binding; probes
 *                   the real contract, cache and upstream included
 *   site_pulse      site-pulse /site-pulse/health via service binding
 *   deploy_watch    deploy-watch /deploy-watch/health via binding
 *
 * The machine sleeping drops specular, corpus, and machine together;
 * that is three real systems genuinely down, not double counting, and
 * the uptime numbers should say so. specular_edge stays up through a
 * sleep, which is exactly the distinction it exists to record.
 *
 * Probe duration rides along: a successful probe adds its round trip
 * to the day bucket (ms_sum / ms_count) so /v1/slo can serve a
 * measured average instead of a per-visitor guess. Failed probes are
 * excluded on purpose; a 5000 ms timeout is a failure fact, not a
 * latency fact, and averaging it in would poison the number.
 */

import { nowIso } from "./http.js";
import { readState, staleAfterMs } from "../routes/infra.js";

export const ESTATE_KEY = "estate:latest:v1";
export const UPTIME_KEY = "uptime:days:v1";
export const COMPONENTS = [
  "registry",
  "notify",
  "specular",
  "specular_edge",
  "corpus",
  "machine",
  "ramone_trigger",
  "github_pulse",
  "site_pulse",
  "deploy_watch",
];

async function probeBinding(binding, url, judge) {
  if (!binding || typeof binding.fetch !== "function") {
    return { ok: false, detail: "binding missing" };
  }
  const started = Date.now();
  try {
    const res = await binding.fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    const verdict = await judge(res);
    verdict.ms = Date.now() - started;
    return verdict;
  } catch (err) {
    return { ok: false, detail: String(err.message || err).slice(0, 120) };
  }
}

async function judgeStatusOnly(res) {
  return res.ok
    ? { ok: true, detail: `http ${res.status}` }
    : { ok: false, detail: `http ${res.status}` };
}

/**
 * One fetch, two verdicts. The pipeline verdict (specular) preserves
 * the original component's semantics exactly, so its history stays
 * continuous; the edge verdict (specular_edge) records reachability
 * of the Worker itself and starts accruing from this deploy.
 */
async function probeSpecular(env) {
  const binding = env.SPECULAR_EDGE;
  if (!binding || typeof binding.fetch !== "function") {
    return {
      specular: { ok: false, detail: "binding missing" },
      specular_edge: { ok: false, detail: "binding missing" },
    };
  }
  const started = Date.now();
  try {
    const res = await binding.fetch("https://specular-edge/specular", {
      signal: AbortSignal.timeout(5000),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      return {
        specular: { ok: false, detail: `http ${res.status}`, ms },
        specular_edge: { ok: false, detail: `http ${res.status}`, ms },
      };
    }
    const body = await res.json().catch(() => null);
    const pipeline =
      body && body.online === false
        ? { ok: false, detail: "worker up, telemetry pipeline offline", ms }
        : { ok: true, detail: "telemetry flowing", ms };
    return {
      specular: pipeline,
      specular_edge: { ok: true, detail: `http ${res.status}`, ms },
    };
  } catch (err) {
    const detail = String(err.message || err).slice(0, 120);
    return {
      specular: { ok: false, detail },
      specular_edge: { ok: false, detail },
    };
  }
}

async function probeCorpus(env) {
  const started = Date.now();
  try {
    const res = await fetch(`${env.CORPUS_ORIGIN}/health`, {
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "atlas-api-public/1.0" },
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, detail: `http ${res.status}`, ms };
    const body = await res.json().catch(() => null);
    return body && body.ok === true
      ? { ok: true, detail: `${body.chunks ?? "?"} chunks indexed`, ms }
      : { ok: false, detail: "reachable but reports degraded", ms };
  } catch (err) {
    return { ok: false, detail: String(err.message || err).slice(0, 120) };
  }
}

export async function probeEstate(env) {
  const [
    registry,
    notifyHealth,
    specularPair,
    corpus,
    ramoneTrigger,
    githubPulse,
    sitePulse,
    deployWatch,
  ] = await Promise.all([
    probeBinding(env.REGISTRY, "https://atlas-api-index/_meta", judgeStatusOnly),
    probeBinding(env.ATLAS_NOTIFY, "https://atlas-notify/health", judgeStatusOnly),
    probeSpecular(env),
    probeCorpus(env),
    probeBinding(
      env.RAMONE_TRIGGER,
      "https://ramone-trigger/trigger/_meta",
      judgeStatusOnly,
    ),
    probeBinding(env.GITHUB_PULSE, "https://github-pulse/pulse", judgeStatusOnly),
    probeBinding(
      env.SITE_PULSE,
      "https://site-pulse/site-pulse/health",
      judgeStatusOnly,
    ),
    probeBinding(
      env.DEPLOY_WATCH,
      "https://deploy-watch/deploy-watch/health",
      judgeStatusOnly,
    ),
  ]);

  const infra = await readState(env);
  let machine;
  if (!infra) {
    machine = { ok: false, detail: "no sentinel reports yet" };
  } else {
    const age = Date.now() - Date.parse(infra.last_report_at);
    const fresh = Number.isFinite(age) && age < staleAfterMs(env);
    if (!fresh) {
      machine = { ok: false, detail: "sentinel silent" };
    } else if (infra.overall === "down") {
      machine = { ok: false, detail: "reporting, all checks failing" };
    } else {
      machine = {
        ok: true,
        detail: infra.overall === "ok" ? "all checks passing" : "degraded",
      };
    }
  }

  return {
    registry,
    notify: notifyHealth,
    specular: specularPair.specular,
    specular_edge: specularPair.specular_edge,
    corpus,
    machine,
    ramone_trigger: ramoneTrigger,
    github_pulse: githubPulse,
    site_pulse: sitePulse,
    deploy_watch: deployWatch,
  };
}

/** Registry worker counts ride along on the snapshot for /v1/stats. */
async function registryCounts(env) {
  try {
    const res = await env.REGISTRY.fetch("https://atlas-api-index/", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const doc = await res.json();
    return doc && doc.counts ? doc.counts : null;
  } catch {
    return null;
  }
}

export async function runEstatePass(env) {
  const components = await probeEstate(env);
  const operational = COMPONENTS.filter((name) => components[name].ok).length;
  const snapshot = {
    components,
    operational,
    total: COMPONENTS.length,
    worker_counts: await registryCounts(env),
    checked_at: nowIso(),
  };
  await env.ATLAS_PUBLIC_KV.put(ESTATE_KEY, JSON.stringify(snapshot));
  await accumulateUptime(env, components);
  return snapshot;
}

export async function readEstate(env) {
  try {
    const raw = await env.ATLAS_PUBLIC_KV.get(ESTATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function accumulateUptime(env, components) {
  const windowDays = Number(env.UPTIME_WINDOW_DAYS || "30");
  let doc;
  try {
    const raw = await env.ATLAS_PUBLIC_KV.get(UPTIME_KEY);
    doc = raw ? JSON.parse(raw) : null;
  } catch {
    doc = null;
  }
  if (!doc || typeof doc !== "object" || !doc.components) {
    doc = { started_at: nowIso(), components: {} };
  }

  const today = nowIso().slice(0, 10);
  const cutoff = new Date(Date.now() - windowDays * 86400000)
    .toISOString()
    .slice(0, 10);

  for (const name of COMPONENTS) {
    const days = (doc.components[name] = doc.components[name] || {});
    const bucket = (days[today] = days[today] || { ok: 0, total: 0 });
    bucket.total += 1;
    const result = components[name];
    if (result.ok) {
      bucket.ok += 1;
      if (Number.isFinite(result.ms)) {
        bucket.ms_sum = (bucket.ms_sum || 0) + result.ms;
        bucket.ms_count = (bucket.ms_count || 0) + 1;
      }
    }
    for (const day of Object.keys(days)) {
      if (day < cutoff) delete days[day];
    }
  }

  doc.window_days = windowDays;
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(doc));
}

export async function readUptime(env) {
  try {
    const raw = await env.ATLAS_PUBLIC_KV.get(UPTIME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function uptimePercent(doc, name) {
  const days = doc?.components?.[name];
  if (!days) return null;
  let ok = 0;
  let total = 0;
  for (const bucket of Object.values(days)) {
    ok += bucket.ok;
    total += bucket.total;
  }
  if (total === 0) return null;
  return Math.round((ok / total) * 10000) / 100;
}

/**
 * Badge colour uses shields' native palette rather than brand amber:
 * the badge lives in GitHub READMEs beside other shields badges, and
 * matching that visual grammar there reads as native, not off-brand.
 * The site cards use brand tokens; each artefact matches its context.
 */
export function badgeStatus(snapshot) {
  if (!snapshot) {
    return {
      color: "#9f9f9f",
      message: "no data",
      operational: 0,
      total: COMPONENTS.length,
    };
  }
  const { operational, total } = snapshot;
  let color = "#dfb317"; // amber
  if (operational === total) color = "#4c1"; // green
  else if (operational <= total / 2) color = "#e05d44"; // red
  return {
    color,
    message: `${operational}/${total} operational`,
    operational,
    total,
  };
}
