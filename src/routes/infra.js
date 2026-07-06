/**
 * Infra Health: the edge half of the specular-sentinel pipeline.
 *
 * Division of labour (stated once, relied on everywhere): the sentinel
 * observes and reports facts; this module owns state, decides severity,
 * fires alerts on transitions, and serves the card. The sentinel cannot
 * report its own death, so persistent silence is handled by the cron in
 * src/cron.js marking the state stale; that is the dead-man's switch.
 *
 * Severity mapping (per the build contract): drift and degraded are
 * `warning`, fully unreachable (or silent) is `failure`, and recovery
 * back to all-checks-passing is `success`. Alerts fire on transitions,
 * never per report; a flapping check produces a transition each way,
 * not a message per five-minute pass.
 */

import {
  json,
  errorResponse,
  readJson,
  bearerOk,
  nowIso,
} from "../lib/http.js";
import { notify } from "../lib/notify.js";

export const STATE_KEY = "infra:state:v1";
export const CHECKS = ["ollama", "corpus_health", "corpus_search"];

export async function readState(env) {
  try {
    const raw = await env.ATLAS_PUBLIC_KV.get(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function staleAfterMs(env) {
  return Number(env.STALE_AFTER_SECONDS || "1200") * 1000;
}

function validateReport(r) {
  if (!r || typeof r !== "object") return "not an object";
  if (typeof r.machine !== "string" || !r.machine) return "machine";
  if (typeof r.ip_changed !== "boolean") return "ip_changed";
  if (!r.checks || typeof r.checks !== "object") return "checks";
  for (const name of CHECKS) {
    const check = r.checks[name];
    if (!check || typeof check.ok !== "boolean") return `checks.${name}`;
  }
  return null;
}

function overallFrom(checks) {
  const okCount = CHECKS.filter((name) => checks[name].ok).length;
  if (okCount === CHECKS.length) return "ok";
  if (okCount === 0) return "down";
  return "degraded";
}

function deriveState(report, prev) {
  const overall = overallFrom(report.checks);
  const now = nowIso();
  const unchanged = prev && prev.overall === overall && !prev.stale;
  return {
    overall,
    stale: false,
    machine: report.machine,
    wsl_ip: report.wsl_ip ?? null,
    ip_changed_at: report.ip_changed ? now : (prev?.ip_changed_at ?? null),
    components: Object.fromEntries(
      CHECKS.map((name) => [
        name,
        {
          ok: report.checks[name].ok,
          latency_ms: report.checks[name].latency_ms ?? null,
          detail: String(report.checks[name].detail ?? "").slice(0, 300),
        },
      ]),
    ),
    last_report_at: report.ts || now,
    last_ok_at: overall === "ok" ? now : (prev?.last_ok_at ?? null),
    since: unchanged ? prev.since : now,
    updated_at: now,
  };
}

async function alertOnTransition(env, prev, next, report) {
  // A stale previous state was already alerted as down by the cron;
  // treating it as "down" here makes the recovery transition fire.
  const prevOverall = prev ? (prev.stale ? "down" : prev.overall) : "unknown";
  const failing = CHECKS.filter((name) => !next.components[name].ok);
  const failFields = Object.fromEntries(
    failing.map((name) => [name, next.components[name].detail || "failed"]),
  );

  if (report.ip_changed) {
    // Drift is its own event, independent of overall state: the
    // portproxy refresh task should absorb it, stale .env references
    // will not, and that is exactly what the card promises to catch.
    await notify(
      env,
      {
        level: "warning",
        title: "WSL2 IP drift detected",
        message:
          "eth0 moved on " +
          next.machine +
          "; the boot portproxy task should have it, anything holding the old address will not",
        fields: {
          previous: String(report.previous_wsl_ip ?? "unknown"),
          current: String(report.wsl_ip ?? "unknown"),
        },
      },
      "infra_health",
    );
  }

  if (prevOverall === next.overall) return;

  if (next.overall === "ok") {
    await notify(
      env,
      {
        level: "success",
        title: "Infra health recovered",
        message: `all ${CHECKS.length} checks passing on ${next.machine}`,
        fields: { previously: prevOverall },
      },
      "infra_health",
    );
  } else if (next.overall === "degraded") {
    await notify(
      env,
      {
        level: "warning",
        title: "Infra health degraded",
        message: `${failing.length} of ${CHECKS.length} checks failing on ${next.machine}`,
        fields: failFields,
      },
      "infra_health",
    );
  } else {
    await notify(
      env,
      {
        level: "failure",
        title: "Infra health down",
        message: `all local checks failing on ${next.machine}`,
        fields: failFields,
      },
      "infra_health",
    );
  }
}

export async function handleInfraReport(request, env, ctx) {
  if (!bearerOk(request, env.INFRA_REPORT_KEY)) {
    return errorResponse(401, "unauthorised");
  }
  let report;
  try {
    report = await readJson(request);
  } catch {
    return errorResponse(400, "invalid JSON body");
  }
  const problem = validateReport(report);
  if (problem) return errorResponse(422, `invalid report: ${problem}`);

  const prev = await readState(env);
  const next = deriveState(report, prev);

  // Deliberate per-report write (~288/day at the five-minute cadence):
  // the card's "last checked" line must be truthful, and the Workers
  // Plus upgrade retired the write-budget argument that shaped the
  // conditional-write default (decisions.md flags those choices as
  // revisitable). Uptime and estate snapshots stay on one write per
  // cron pass; this key buys visible correctness with its writes.
  await env.ATLAS_PUBLIC_KV.put(STATE_KEY, JSON.stringify(next));
  ctx.waitUntil(alertOnTransition(env, prev, next, report));

  return json({
    ok: true,
    stored: true,
    overall: next.overall,
    generated_at: nowIso(),
  });
}

export async function handleInfraStatus(_request, env) {
  const state = await readState(env);
  if (!state) {
    return json({
      ok: true,
      overall: "unknown",
      stale: false,
      detail: "no sentinel reports received yet",
      generated_at: nowIso(),
    });
  }

  // Freshness is recomputed at read time: a status endpoint that waits
  // for the next cron pass to admit staleness would lie for up to ten
  // minutes. The cron still exists to fire the alert and persist the
  // stale flag; this keeps the public answer honest in between.
  const age = Date.now() - Date.parse(state.last_report_at);
  const fresh = Number.isFinite(age) && age < staleAfterMs(env);

  return json({
    ok: true,
    overall: fresh ? state.overall : "down",
    stale: !fresh,
    machine: state.machine,
    wsl_ip: state.wsl_ip,
    ip_changed_at: state.ip_changed_at,
    components: state.components,
    last_report_at: state.last_report_at,
    last_ok_at: state.last_ok_at,
    since: state.since,
    generated_at: nowIso(),
  });
}
