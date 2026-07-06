/**
 * Estate status: one computation, three consumers (cron writes it,
 * /v1/stats and /v1/badge/status read it).
 *
 * "Uptime pulled from atlas-status" resolved honestly: the status page
 * is a client-side live checker with no history, so no uptime history
 * exists anywhere in the estate. This module accrues its own, one
 * probe pass per cron tick into per-day counters, and every reader
 * labels the observation window. Measured-since-deploy beats invented
 * history; a senior reader trusts the first and discounts the second.
 *
 * Five components, probed where they actually live:
 *   registry   atlas-api-index /_meta via service binding
 *   notify     atlas-notify /health via service binding
 *   specular   specular-edge /specular via binding; online:false means
 *              the tunnel pipeline is down even though the Worker is up
 *   corpus     corpus.atlas-systems.uk /health over the public tunnel,
 *              ok only when the service itself says ok
 *   machine    sentinel report freshness plus its overall verdict
 *
 * The machine sleeping drops specular, corpus, and machine together;
 * that is three real systems genuinely down, not double counting, and
 * the uptime numbers should say so.
 */

import { nowIso } from "./http.js";
import { readState, staleAfterMs } from "../routes/infra.js";

export const ESTATE_KEY = "estate:latest:v1";
export const UPTIME_KEY = "uptime:days:v1";
export const COMPONENTS = ["registry", "notify", "specular", "corpus", "machine"];

async function probeBinding(binding, url, judge) {
  if (!binding || typeof binding.fetch !== "function") {
    return { ok: false, detail: "binding missing" };
  }
  try {
    const res = await binding.fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    return await judge(res);
  } catch (err) {
    return { ok: false, detail: String(err.message || err).slice(0, 120) };
  }
}

async function judgeStatusOnly(res) {
  return res.ok
    ? { ok: true, detail: `http ${res.status}` }
    : { ok: false, detail: `http ${res.status}` };
}

export async function probeEstate(env) {
  const [registry, notifyHealth, specular, corpus] = await Promise.all([
    probeBinding(env.REGISTRY, "https://atlas-api-index/_meta", judgeStatusOnly),
    probeBinding(env.ATLAS_NOTIFY, "https://atlas-notify/health", judgeStatusOnly),
    probeBinding(env.SPECULAR_EDGE, "https://specular-edge/specular", async (res) => {
      if (!res.ok) return { ok: false, detail: `http ${res.status}` };
      const body = await res.json().catch(() => null);
      if (body && body.online === false) {
        return { ok: false, detail: "worker up, telemetry pipeline offline" };
      }
      return { ok: true, detail: "telemetry flowing" };
    }),
    (async () => {
      try {
        const res = await fetch(`${env.CORPUS_ORIGIN}/health`, {
          signal: AbortSignal.timeout(5000),
          headers: { "user-agent": "atlas-api-public/1.0" },
        });
        if (!res.ok) return { ok: false, detail: `http ${res.status}` };
        const body = await res.json().catch(() => null);
        return body && body.ok === true
          ? { ok: true, detail: `${body.chunks ?? "?"} chunks indexed` }
          : { ok: false, detail: "reachable but reports degraded" };
      } catch (err) {
        return { ok: false, detail: String(err.message || err).slice(0, 120) };
      }
    })(),
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

  return { registry, notify: notifyHealth, specular, corpus, machine };
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
    if (components[name].ok) bucket.ok += 1;
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
