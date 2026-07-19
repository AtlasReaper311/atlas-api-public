/**
 * /v1/reliability: derived reliability results, served honestly.
 *
 * The counters live in this Worker's KV and the canonical targets arrive
 * through the same fingerprint-verified ingest pattern the assurance
 * evidence already uses, so this Worker is the natural runtime owner of the
 * derivation. The mathematics is the vendored port in lib/reliability.js,
 * pinned to the atlas-infra reference by shared vectors.
 *
 * Honesty rules for every route here: a missing evaluation is a 503 with
 * the producing precondition named, a stale document is served with an
 * explicit stale marker and never re-dressed as current, and a service
 * without an approved objective is `unmeasured`, never healthy.
 */

import { bearerOk, errorResponse, json, nowIso, readJson } from "../lib/http.js";
import { notify } from "../lib/notify.js";
import { readUptime } from "../lib/status.js";
import {
  buildReleaseBaseline,
  canonicalJson,
  evaluate,
  planNotifications,
  sha256Hex,
} from "../lib/reliability.js";

export const POLICY_KEY = "reliability:policy:v1";
export const RESULT_KEY = "reliability:latest:v1";
export const STATE_KEY = "reliability:state:v1";

const EXPECTED_POLICY_SCHEMA = "atlas-reliability-policy/v1";
const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function verifyFingerprint(document) {
  const clone = structuredClone(document);
  delete clone.fingerprint;
  const computed = await sha256Hex(canonicalJson(clone));
  return computed === document.fingerprint;
}

export async function readPolicyWrapper(env) {
  try {
    return await env.ATLAS_PUBLIC_KV.get(POLICY_KEY, "json");
  } catch {
    return null;
  }
}

export function policyState(wrapper, nowMs) {
  if (!wrapper || !wrapper.document) return "missing";
  const staleSeconds =
    wrapper.document.evaluator_config?.policy_stale_after_seconds ?? 691200;
  const storedMs = Date.parse(wrapper.stored_at ?? "");
  if (!Number.isFinite(storedMs)) return "stale";
  return nowMs - storedMs > staleSeconds * 1000 ? "stale" : "fresh";
}

async function readResult(env) {
  try {
    return await env.ATLAS_PUBLIC_KV.get(RESULT_KEY, "json");
  } catch {
    return null;
  }
}

function resultEnvelope(report, wrapper, now) {
  const stale = Date.parse(report.stale_after) < now.getTime();
  return {
    ok: true,
    policy_state: policyState(wrapper, now.getTime()),
    stale,
    report,
    generated_at: nowIso(),
  };
}

/** GET /v1/reliability */
export async function handleReliability(_request, env) {
  const report = await readResult(env);
  if (!report) {
    return errorResponse(
      503,
      "no reliability evaluation has been produced",
      "the reliability policy must be published and one cron pass must complete",
    );
  }
  const wrapper = await readPolicyWrapper(env);
  return json(resultEnvelope(report, wrapper, new Date()), 200, {
    "cache-control": "public, max-age=60",
  });
}

/** GET /v1/reliability/services/{service_id} */
export async function handleReliabilityService(_request, env, serviceId) {
  if (!SERVICE_ID_PATTERN.test(serviceId)) {
    return errorResponse(400, "service_id must be lower-case kebab-case");
  }
  const report = await readResult(env);
  if (!report) {
    return errorResponse(
      503,
      "no reliability evaluation has been produced",
      "the reliability policy must be published and one cron pass must complete",
    );
  }
  const entry = report.results.find((item) => item.service_id === serviceId);
  const wrapper = await readPolicyWrapper(env);
  const now = new Date();
  if (entry) {
    return json(
      {
        ok: true,
        policy_state: policyState(wrapper, now.getTime()),
        stale: Date.parse(report.stale_after) < now.getTime(),
        evaluated_at: report.evaluated_at,
        stale_after: report.stale_after,
        result: entry,
        generated_at: nowIso(),
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  }
  const unmeasured = report.unmeasured.find(
    (item) => item.service_id === serviceId,
  );
  if (unmeasured) {
    return json(
      {
        ok: true,
        policy_state: policyState(wrapper, now.getTime()),
        stale: Date.parse(report.stale_after) < now.getTime(),
        evaluated_at: report.evaluated_at,
        result: {
          service_id: serviceId,
          state: "unmeasured",
          control_plane_state: "unknown",
          reasons: [unmeasured.reason],
        },
        generated_at: nowIso(),
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  }
  return errorResponse(404, "unknown service_id");
}

/** GET /v1/reliability/objectives */
export async function handleReliabilityObjectives(_request, env) {
  const wrapper = await readPolicyWrapper(env);
  if (!wrapper?.document) {
    return errorResponse(
      503,
      "no reliability policy has been published",
      "run the atlas-infra reliability-policy workflow with EVIDENCE_REPORT_KEY configured",
    );
  }
  const document = wrapper.document;
  return json(
    {
      ok: true,
      schema: document.schema,
      generated_at_source: document.generated_at,
      stored_at: wrapper.stored_at,
      policy_state: policyState(wrapper, Date.now()),
      fingerprint: document.fingerprint,
      objectives: document.objectives.map((objective) => ({
        objective_id: objective.objective_id,
        service_id: objective.service_id,
        indicator: objective.indicator,
        component: objective.measurement_source.component,
        window_days: objective.window_days,
        target_pct: objective.target_pct,
        domain: objective.display.domain,
        label: objective.display.label,
      })),
      unmeasured: document.unmeasured ?? [],
      generated_at: nowIso(),
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

/** GET /v1/reliability/baseline/{service_id} */
export async function handleReliabilityBaseline(_request, env, serviceId) {
  if (!SERVICE_ID_PATTERN.test(serviceId)) {
    return errorResponse(400, "service_id must be lower-case kebab-case");
  }
  const wrapper = await readPolicyWrapper(env);
  if (policyState(wrapper, Date.now()) !== "fresh") {
    return errorResponse(
      503,
      "no fresh reliability policy is available",
      "baselines require a current published policy",
    );
  }
  const hasObjective = wrapper.document.objectives.some(
    (objective) => objective.service_id === serviceId,
  );
  if (!hasObjective) {
    return errorResponse(404, "no approved objective exists for this service");
  }
  const uptime = await readUptime(env);
  const baseline = await buildReleaseBaseline(
    wrapper.document,
    { started_at: uptime?.started_at, window_days: uptime?.window_days, components: componentsOf(uptime) },
    nowIso(),
    serviceId,
  );
  if (!baseline) {
    return errorResponse(
      503,
      "measured history cannot support an honest baseline",
      "insufficient, stale, or unavailable evidence for this service",
    );
  }
  return json({ ok: true, baseline, generated_at: nowIso() }, 200, {
    "cache-control": "public, max-age=60",
  });
}

function componentsOf(uptime) {
  return uptime && typeof uptime.components === "object"
    ? uptime.components
    : {};
}

/** POST /v1/reliability/objectives/report */
export async function handleReliabilityPolicyReport(request, env) {
  if (!bearerOk(request, env.EVIDENCE_REPORT_KEY)) {
    return errorResponse(401, "missing or incorrect bearer key");
  }
  let document;
  try {
    document = await readJson(request, 512 * 1024);
  } catch (error) {
    return errorResponse(
      400,
      error.message === "body too large" ? error.message : "body is not valid JSON",
    );
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return errorResponse(422, "policy must be a JSON object");
  }
  if (document.schema !== EXPECTED_POLICY_SCHEMA) {
    return errorResponse(422, `schema must be ${EXPECTED_POLICY_SCHEMA}`);
  }
  if (!Array.isArray(document.objectives) || document.objectives.length === 0) {
    return errorResponse(422, "objectives must be a non-empty array");
  }
  if (!document.evaluator_config || typeof document.evaluator_config !== "object") {
    return errorResponse(422, "evaluator_config must be an object");
  }
  if (!/^[0-9a-f]{64}$/.test(String(document.fingerprint || ""))) {
    return errorResponse(422, "fingerprint must be a lowercase SHA-256 hex digest");
  }
  if (!(await verifyFingerprint(document))) {
    return errorResponse(422, "fingerprint does not match canonical policy content");
  }

  const current = await readPolicyWrapper(env);
  const changed = current?.document?.fingerprint !== document.fingerprint;
  await env.ATLAS_PUBLIC_KV.put(
    POLICY_KEY,
    JSON.stringify({ stored_at: nowIso(), document }),
  );
  return json({
    ok: true,
    changed,
    fingerprint: document.fingerprint,
    generated_at: nowIso(),
  });
}

/* ------------------------------------------------------------------ */
/* Cron pass                                                           */
/* ------------------------------------------------------------------ */

const LEVEL_BY_STATE = {
  budget_at_risk: "warning",
  budget_exhausted: "failure",
  stale_evidence: "warning",
  unavailable_source: "warning",
};

const RUNBOOKS = {
  budget_at_risk: "docs/runbooks/reliability-budget-exhausted.md",
  budget_exhausted: "docs/runbooks/reliability-budget-exhausted.md",
  stale_evidence: "docs/runbooks/reliability-evidence-stale.md",
  unavailable_source: "docs/runbooks/reliability-source-unavailable.md",
};

function renderEvent(item) {
  if (item.consolidated) {
    return {
      level: "warning",
      title: `Reliability: ${item.count} services degraded in one pass`,
      message:
        "Broad degradation detected; individual notifications suppressed. " +
        "One shared cause is likelier than many separate ones.",
      fields: {
        services: item.services
          .map((entry) => `${entry.service_id}:${entry.state}`)
          .join(", ")
          .slice(0, 900),
        suppressed_individual_notifications: "true",
        runbook: "atlas-infra/docs/runbooks/reliability-source-unavailable.md",
        dedup_key: item.dedupKey,
      },
    };
  }
  const entry = item.entry;
  if (item.kind === "recovery") {
    return {
      level: "success",
      title: `Reliability recovered: ${entry.service_id}`,
      message:
        `${entry.objective_id} is back to objective_met after measured recovery` +
        ` from ${item.from_state}.`,
      fields: {
        service: entry.service_id,
        objective: entry.objective_id,
        remaining_budget: String(entry.budget?.remaining_fraction ?? "null"),
        dedup_key: item.dedupKey,
      },
    };
  }
  return {
    level: LEVEL_BY_STATE[entry.state] ?? "warning",
    title: `Reliability: ${entry.service_id} is ${entry.state.replace(/_/g, " ")}`,
    message: (entry.reasons ?? []).slice(0, 3).join("; ") || "state transition",
    fields: {
      service: entry.service_id,
      objective: entry.objective_id,
      from_state: String(item.from_state),
      to_state: entry.state,
      remaining_budget: String(entry.budget?.remaining_fraction ?? "null"),
      fast_burn: String(entry.burn?.fast?.rate ?? "null"),
      slow_burn: String(entry.burn?.slow?.rate ?? "null"),
      evaluated_at: item.evaluated_at,
      runbook: `atlas-infra/${RUNBOOKS[entry.state] ?? "docs/runbooks/reliability-budget-exhausted.md"}`,
      dedup_key: item.dedupKey,
    },
  };
}

/**
 * The reliability step of the scheduled pass. Runs after the estate probe
 * pass so the counters it reads are the ones just written. Never throws:
 * reliability derivation failing must not take the probe pipeline down.
 */
export async function runReliabilityPass(env, snapshot) {
  try {
    const wrapper = await readPolicyWrapper(env);
    const now = new Date();
    const state = policyState(wrapper, now.getTime());
    if (state !== "fresh") {
      await notifyPolicyUnavailable(env, wrapper, state, now);
      return null;
    }
    const uptime = await readUptime(env);
    const counters = uptime
      ? {
          started_at: uptime.started_at,
          window_days: uptime.window_days,
          components: componentsOf(uptime),
        }
      : null;
    const checkedAt = snapshot?.checked_at ?? nowIso();
    const report = await evaluate(
      wrapper.document,
      counters,
      nowIso(),
      checkedAt,
    );
    await env.ATLAS_PUBLIC_KV.put(RESULT_KEY, JSON.stringify(report));

    const previousState = await env.ATLAS_PUBLIC_KV.get(STATE_KEY, "json");
    const plan = planNotifications(
      previousState,
      report,
      wrapper.document.evaluator_config,
    );
    await env.ATLAS_PUBLIC_KV.put(STATE_KEY, JSON.stringify(plan.state));
    for (const item of plan.events) {
      item.evaluated_at = report.evaluated_at;
      await notify(env, renderEvent(item), "reliability");
    }
    return report;
  } catch (err) {
    console.log("reliability pass failed:", err.message);
    return null;
  }
}

/**
 * Policy missing after having been present, or aged past its bound, is a
 * notifiable condition once per UTC day. A policy that has never been
 * published is the expected pre-rollout state and stays silent.
 */
async function notifyPolicyUnavailable(env, wrapper, state, now) {
  if (state === "missing" && !wrapper) return;
  const previous = (await env.ATLAS_PUBLIC_KV.get(STATE_KEY, "json")) ?? {};
  const day = now.toISOString().slice(0, 10);
  if (previous.policy_unavailable_notified_day === day) return;
  await env.ATLAS_PUBLIC_KV.put(
    STATE_KEY,
    JSON.stringify({ ...previous, policy_unavailable_notified_day: day }),
  );
  await notify(
    env,
    {
      level: "warning",
      title: "Reliability policy unavailable",
      message:
        state === "stale"
          ? "The published reliability policy is older than its staleness bound; derived results are no longer refreshed."
          : "The reliability policy disappeared from KV after having been present.",
      fields: {
        policy_state: state,
        runbook: "atlas-infra/docs/runbooks/reliability-source-unavailable.md",
      },
    },
    "reliability",
  );
}
