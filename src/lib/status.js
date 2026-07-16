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
 * Nineteen components, probed where they actually live:
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
 *   atlas_blackbox  atlas-blackbox /blackbox/health via binding
 *   atlas_quota_watch quota summary via binding; threshold breaches
 *                     are distinct from Worker reachability
 *   ramone_edge     the public Ramone status surface via binding
 *   atlas_doc_viewer, atlas_systems, status_surface
 *                   bounded public HTTP reachability probes
 *   atlas_badges, atlas_dep_audit, atlas_journey_watch
 *                   current GitHub Actions evidence from github-pulse
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
  "atlas_blackbox",
  "atlas_quota_watch",
  "ramone_edge",
  "atlas_doc_viewer",
  "atlas_systems",
  "status_surface",
  "atlas_badges",
  "atlas_dep_audit",
  "atlas_journey_watch",
];

const WORKFLOW_COMPONENTS = Object.freeze({
  "atlas-badges": "atlas_badges",
  "atlas-dep-audit": "atlas_dep_audit",
  "atlas-journey-watch": "atlas_journey_watch",
});

const COMPONENT_STATUSES = new Set(["healthy", "degraded", "down", "unknown"]);

export function componentStatus(result) {
  if (COMPONENT_STATUSES.has(result?.status)) return result.status;
  if (result?.ok === true) return "healthy";
  if (result?.ok === false) return "down";
  return "unknown";
}

function evidence(result, evidenceSource) {
  return { ...result, evidence_source: evidenceSource };
}

async function probeBinding(binding, url, judge, evidenceSource = url) {
  if (!binding || typeof binding.fetch !== "function") {
    return evidence(
      { ok: false, status: "unknown", detail: "binding missing" },
      evidenceSource,
    );
  }
  const started = Date.now();
  try {
    const res = await binding.fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    const verdict = await judge(res);
    verdict.ms = Date.now() - started;
    return evidence(verdict, evidenceSource);
  } catch (err) {
    return evidence(
      { ok: false, detail: String(err.message || err).slice(0, 120) },
      evidenceSource,
    );
  }
}

async function probeUrl(url, judge = judgeStatusOnly, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "atlas-api-public/1.1" },
    });
    const verdict = await judge(res);
    verdict.ms = Date.now() - started;
    return evidence(verdict, url);
  } catch (err) {
    return evidence(
      { ok: false, detail: String(err.message || err).slice(0, 120) },
      url,
    );
  }
}

async function judgeStatusOnly(res) {
  return res.ok
    ? { ok: true, detail: `http ${res.status}` }
    : { ok: false, detail: `http ${res.status}` };
}

async function judgeJsonOk(res) {
  if (!res.ok) return { ok: false, detail: `http ${res.status}` };
  const body = await res.json().catch(() => null);
  return body?.ok === true
    ? { ok: true, detail: `http ${res.status}` }
    : { ok: false, detail: "reachable but does not report ok" };
}

async function judgeQuota(res) {
  if (!res.ok) return { ok: false, detail: `http ${res.status}` };
  const body = await res.json().catch(() => null);
  if (body?.ok !== true || !Array.isArray(body.meters)) {
    return { ok: false, status: "unknown", detail: "quota contract unavailable" };
  }
  if (body.meters.some((meter) => meter.breach === true)) {
    return { ok: false, status: "down", detail: "one or more quota limits breached" };
  }
  const threshold = Number(body.warn_threshold_pct);
  if (
    Number.isFinite(threshold)
    && body.meters.some((meter) => Number(meter.pct) >= threshold)
  ) {
    return { ok: true, status: "degraded", detail: "one or more quota meters above warning threshold" };
  }
  return { ok: true, status: "healthy", detail: "quota meters below warning threshold" };
}

async function judgeRamoneEdge(res) {
  if (!res.ok) return { ok: false, detail: `http ${res.status}` };
  const body = await res.json().catch(() => null);
  if (typeof body?.awake !== "boolean") {
    return { ok: false, status: "unknown", detail: "status contract unavailable" };
  }
  return {
    ok: true,
    status: "healthy",
    detail: body.awake ? "edge reachable; local AI awake" : "edge reachable; local AI sleeping",
    measured_at: body.checked_at ?? null,
  };
}

/**
 * One fetch, two verdicts. The pipeline verdict (specular) preserves
 * the original component's semantics exactly, so its history stays
 * continuous; the edge verdict (specular_edge) records reachability
 * of the Worker itself and starts accruing from this deploy.
 */
async function probeSpecular(env) {
  const binding = env.SPECULAR_EDGE;
  const source = "service-binding:specular-edge/specular";
  if (!binding || typeof binding.fetch !== "function") {
    return {
      specular: evidence(
        { ok: false, status: "unknown", detail: "binding missing" },
        source,
      ),
      specular_edge: evidence(
        { ok: false, status: "unknown", detail: "binding missing" },
        source,
      ),
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
        specular: evidence({ ok: false, detail: `http ${res.status}`, ms }, source),
        specular_edge: evidence({ ok: false, detail: `http ${res.status}`, ms }, source),
      };
    }
    const body = await res.json().catch(() => null);
    const pipeline =
      body && body.online === false
        ? { ok: false, detail: "worker up, telemetry pipeline offline", ms }
        : { ok: true, detail: "telemetry flowing", ms };
    return {
      specular: evidence(pipeline, source),
      specular_edge: evidence({ ok: true, detail: `http ${res.status}`, ms }, source),
    };
  } catch (err) {
    const detail = String(err.message || err).slice(0, 120);
    return {
      specular: evidence({ ok: false, detail }, source),
      specular_edge: evidence({ ok: false, detail }, source),
    };
  }
}

async function probeCorpus(env) {
  const source = `${env.CORPUS_ORIGIN}/health`;
  const started = Date.now();
  try {
    const res = await fetch(`${env.CORPUS_ORIGIN}/health`, {
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "atlas-api-public/1.0" },
    });
    const ms = Date.now() - started;
    if (!res.ok) return evidence({ ok: false, detail: `http ${res.status}`, ms }, source);
    const body = await res.json().catch(() => null);
    return evidence(body && body.ok === true
      ? { ok: true, detail: `${body.chunks ?? "?"} chunks indexed`, ms }
      : { ok: false, detail: "reachable but reports degraded", ms }, source);
  } catch (err) {
    return evidence(
      { ok: false, detail: String(err.message || err).slice(0, 120) },
      source,
    );
  }
}

async function probeWorkflowHealth(env) {
  const missing = () => Object.fromEntries(
    Object.values(WORKFLOW_COMPONENTS).map((name) => [
      name,
      {
        ok: false,
        status: "unknown",
        detail: "workflow evidence unavailable",
        evidence_source: "service-binding:github-pulse/pulse/workflows",
        measured_at: null,
      },
    ]),
  );
  if (!env.GITHUB_PULSE || typeof env.GITHUB_PULSE.fetch !== "function") {
    return missing();
  }
  try {
    const res = await env.GITHUB_PULSE.fetch(
      "https://github-pulse/pulse/workflows",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return missing();
    const body = await res.json().catch(() => null);
    return Object.fromEntries(
      Object.entries(WORKFLOW_COMPONENTS).map(([workflowId, componentName]) => {
        const item = body?.workflows?.[workflowId];
        const status = componentStatus(item);
        return [componentName, {
          ok: status === "healthy" || status === "degraded",
          status,
          detail: item?.detail ?? "workflow evidence unavailable",
          evidence_source:
            item?.evidence_source
            ?? `service-binding:github-pulse/pulse/workflows#${workflowId}`,
          measured_at: item?.measured_at ?? null,
        }];
      }),
    );
  } catch {
    return missing();
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
    atlasBlackbox,
    atlasQuotaWatch,
    ramoneEdge,
    atlasDocViewer,
    atlasSystems,
    statusSurface,
    workflowHealth,
  ] = await Promise.all([
    probeBinding(
      env.REGISTRY,
      "https://atlas-api-index/_meta",
      judgeStatusOnly,
      "service-binding:atlas-api-index/_meta",
    ),
    probeBinding(
      env.ATLAS_NOTIFY,
      "https://atlas-notify/health",
      judgeStatusOnly,
      "service-binding:atlas-notify/health",
    ),
    probeSpecular(env),
    probeCorpus(env),
    probeBinding(
      env.RAMONE_TRIGGER,
      "https://ramone-trigger/trigger/_meta",
      judgeStatusOnly,
      "service-binding:ramone-trigger/trigger/_meta",
    ),
    probeBinding(
      env.GITHUB_PULSE,
      "https://github-pulse/pulse",
      judgeStatusOnly,
      "service-binding:github-pulse/pulse",
    ),
    probeBinding(
      env.SITE_PULSE,
      "https://site-pulse/site-pulse/health",
      judgeStatusOnly,
      "service-binding:site-pulse/site-pulse/health",
    ),
    probeBinding(
      env.DEPLOY_WATCH,
      "https://deploy-watch/deploy-watch/health",
      judgeStatusOnly,
      "service-binding:deploy-watch/deploy-watch/health",
    ),
    probeBinding(
      env.ATLAS_BLACKBOX,
      "https://atlas-blackbox/blackbox/health",
      judgeJsonOk,
      "service-binding:atlas-blackbox/blackbox/health",
    ),
    probeBinding(
      env.ATLAS_QUOTA_WATCH,
      "https://atlas-quota-watch/quota",
      judgeQuota,
      "service-binding:atlas-quota-watch/quota",
    ),
    probeBinding(
      env.RAMONE_EDGE,
      "https://ramone-edge/status",
      judgeRamoneEdge,
      "service-binding:ramone-edge/status",
    ),
    probeUrl("https://cv.atlas-systems.uk", judgeStatusOnly, { method: "HEAD" }),
    probeUrl("https://atlas-systems.uk", judgeStatusOnly, { method: "HEAD" }),
    probeUrl("https://status.atlas-systems.uk", judgeStatusOnly, { method: "HEAD" }),
    probeWorkflowHealth(env),
  ]);

  const infra = await readState(env);
  let machine;
  if (!infra) {
    machine = {
      ok: false,
      status: "unknown",
      detail: "no sentinel reports yet",
      evidence_source: "specular-sentinel:infra state",
      measured_at: null,
    };
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
    machine.evidence_source = "specular-sentinel:infra state";
    machine.measured_at = infra.last_report_at ?? null;
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
    atlas_blackbox: atlasBlackbox,
    atlas_quota_watch: atlasQuotaWatch,
    ramone_edge: ramoneEdge,
    atlas_doc_viewer: atlasDocViewer,
    atlas_systems: atlasSystems,
    status_surface: statusSurface,
    ...workflowHealth,
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
  const total = COMPONENTS.length;
  const operational = COMPONENTS.filter(
    (name) => snapshot.components?.[name]?.ok === true,
  ).length;
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
