/**
 * Reliability suite: vector parity, route honesty, and transition rules.
 *
 * The vectors under test/fixtures/reliability/vectors/ are copied from
 * atlas-infra/tests/fixtures/reliability/vectors/ and pin this Worker's
 * vendored evaluator to the canonical Python reference byte-for-byte,
 * fingerprints included. If either implementation changes without the
 * other, this suite fails, which is exactly its job.
 *
 * No test here performs any network delivery: notifications are recorded
 * by an in-memory binding stub and rendered payloads are asserted as data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  evaluate,
  buildReleaseBaseline,
  planNotifications,
  roundPlaces,
} from "../src/lib/reliability.js";
import {
  handleReliability,
  handleReliabilityBaseline,
  handleReliabilityObjectives,
  handleReliabilityPolicyReport,
  handleReliabilityService,
  runReliabilityPass,
  POLICY_KEY,
  RESULT_KEY,
  STATE_KEY,
} from "../src/routes/reliability.js";
import { UPTIME_KEY } from "../src/lib/status.js";

const VECTOR_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/reliability/vectors",
);

function loadVector(name) {
  const input = JSON.parse(
    readFileSync(path.join(VECTOR_ROOT, name, "input.json"), "utf8"),
  );
  const expected = JSON.parse(
    readFileSync(path.join(VECTOR_ROOT, name, "expected.json"), "utf8"),
  );
  return { input, expected };
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    if (!this.values.has(key)) return null;
    const value = this.values.get(key);
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

function makeEnv(overrides = {}) {
  const notifications = [];
  return {
    notifications,
    ATLAS_PUBLIC_KV: new MemoryKv(),
    EVIDENCE_REPORT_KEY: "evidence-key",
    NOTIFY_TOKEN: "notify-token-fixture",
    ATLAS_NOTIFY: {
      fetch: async (_url, init) => {
        notifications.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
    ...overrides,
  };
}

function getRequest() {
  return new Request("https://api.atlas-systems.uk/v1/reliability");
}

function postPolicy(document, key = "evidence-key") {
  return new Request(
    "https://api.atlas-systems.uk/v1/reliability/objectives/report",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(document),
    },
  );
}

async function seedPolicy(env, policy, storedAt = new Date().toISOString()) {
  await env.ATLAS_PUBLIC_KV.put(
    POLICY_KEY,
    JSON.stringify({ stored_at: storedAt, document: policy }),
  );
}

/**
 * Fresh counters ending now: the cron pass evaluates at wall clock, so
 * route and transition tests generate their windows relative to today
 * instead of reusing the frozen vector dates.
 */
function freshCounters(okPerDay, totalPerDay, avgMs = 180, daysBack = 6) {
  const component = {};
  const now = new Date();
  for (let offset = daysBack; offset >= 1; offset -= 1) {
    const day = new Date(now.getTime() - offset * 86400000)
      .toISOString()
      .slice(0, 10);
    component[day] = {
      ok: okPerDay,
      total: totalPerDay,
      ms_sum: okPerDay * avgMs,
      ms_count: okPerDay,
    };
  }
  const today = now.toISOString().slice(0, 10);
  const partial = Math.max(
    Math.min(Math.floor((now.getTime() - Date.parse(`${today}T00:00:00Z`)) / 600000), totalPerDay),
    1,
  );
  const okToday = Math.min(okPerDay, partial);
  component[today] = {
    ok: okToday,
    total: partial,
    ms_sum: okToday * avgMs,
    ms_count: okToday,
  };
  const startDay = new Date(now.getTime() - daysBack * 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    started_at: `${startDay}T00:00:00Z`,
    window_days: 30,
    components: { alpha: component },
  };
}

// ------------------------------------------------------------------ //
// Vector parity                                                       //
// ------------------------------------------------------------------ //

test("every shared vector matches the canonical reference exactly", async () => {
  const names = readdirSync(VECTOR_ROOT).sort();
  assert.ok(names.length >= 14, "vector set went missing");
  for (const name of names) {
    const { input, expected } = loadVector(name);
    const actual = await evaluate(
      input.policy,
      input.uptime,
      input.now,
      input.source_checked_at,
    );
    assert.deepEqual(actual, expected, `vector ${name} diverged`);
    assert.equal(
      actual.fingerprint,
      expected.fingerprint,
      `vector ${name} fingerprint diverged`,
    );
  }
});

test("rounding matches the reference sequence", () => {
  assert.equal(roundPlaces(1.0, 4), 1);
  assert.equal(roundPlaces(0.855, 2), 0.86);
  assert.equal(roundPlaces(-0.855, 2), -0.86);
});

// ------------------------------------------------------------------ //
// Routes                                                              //
// ------------------------------------------------------------------ //

test("reliability routes answer an honest 503 before any evaluation", async () => {
  const env = makeEnv();
  const summary = await handleReliability(getRequest(), env);
  assert.equal(summary.status, 503);
  const service = await handleReliabilityService(getRequest(), env, "atlas-notify");
  assert.equal(service.status, 503);
  const objectives = await handleReliabilityObjectives(getRequest(), env);
  assert.equal(objectives.status, 503);
});

test("policy ingest verifies bearer, schema, and fingerprint", async () => {
  const env = makeEnv();
  const { input } = loadVector("healthy");
  const policy = input.policy;

  const unauthorised = await handleReliabilityPolicyReport(
    postPolicy(policy, "wrong"),
    env,
  );
  assert.equal(unauthorised.status, 401);

  const wrongSchema = await handleReliabilityPolicyReport(
    postPolicy({ ...policy, schema: "nope/v1" }),
    env,
  );
  assert.equal(wrongSchema.status, 422);

  const brokenFingerprint = await handleReliabilityPolicyReport(
    postPolicy({ ...policy, fingerprint: "0".repeat(64) }),
    env,
  );
  assert.equal(brokenFingerprint.status, 422);

  const accepted = await handleReliabilityPolicyReport(postPolicy(policy), env);
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.equal(body.changed, true);
  assert.equal(body.fingerprint, policy.fingerprint);

  const repeat = await handleReliabilityPolicyReport(postPolicy(policy), env);
  const repeatBody = await repeat.json();
  assert.equal(repeatBody.changed, false);
});

test("the cron pass evaluates, serves, and marks unmeasured services", async () => {
  const env = makeEnv();
  const { input } = loadVector("healthy");
  await seedPolicy(env, input.policy);
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(freshCounters(144, 144)));

  const report = await runReliabilityPass(env, {
    checked_at: new Date().toISOString(),
  });
  assert.ok(report);
  assert.equal(report.results[0].state, "objective_met");

  const summary = await handleReliability(getRequest(), env);
  assert.equal(summary.status, 200);
  const body = await summary.json();
  assert.equal(body.policy_state, "fresh");
  assert.equal(body.report.results[0].service_id, "service-a");

  const service = await handleReliabilityService(getRequest(), env, "service-a");
  const serviceBody = await service.json();
  assert.equal(serviceBody.result.state, "objective_met");

  const unmeasured = await handleReliabilityService(getRequest(), env, "service-x");
  const unmeasuredBody = await unmeasured.json();
  assert.equal(unmeasuredBody.result.state, "unmeasured");

  const unknown = await handleReliabilityService(getRequest(), env, "service-nope");
  assert.equal(unknown.status, 404);
});

test("a stale or missing policy degrades honestly and notifies once per day", async () => {
  const env = makeEnv();
  const { input } = loadVector("healthy");
  await seedPolicy(
    env,
    input.policy,
    new Date(Date.now() - 9 * 86400000).toISOString(),
  );
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(freshCounters(144, 144)));

  const report = await runReliabilityPass(env, { checked_at: new Date().toISOString() });
  assert.equal(report, null);
  assert.equal(env.notifications.length, 1);
  assert.equal(env.notifications[0].signal_class, "reliability");
  assert.match(env.notifications[0].title, /policy unavailable/i);

  const second = await runReliabilityPass(env, { checked_at: new Date().toISOString() });
  assert.equal(second, null);
  assert.equal(env.notifications.length, 1, "one policy alert per day");
});

test("a never-published policy stays silent before rollout", async () => {
  const env = makeEnv();
  const report = await runReliabilityPass(env, { checked_at: null });
  assert.equal(report, null);
  assert.equal(env.notifications.length, 0);
});

test("the baseline route serves the journey-watch contract or an honest 503", async () => {
  const env = makeEnv();
  const { input } = loadVector("healthy");
  await seedPolicy(env, input.policy);
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(freshCounters(144, 144)));

  const good = await handleReliabilityBaseline(getRequest(), env, "service-a");
  assert.equal(good.status, 200);
  const body = await good.json();
  assert.equal(body.baseline.schema_version, "atlas-journey-watch/release-baseline/v1");
  assert.equal(body.baseline.latency_metric, "avg");
  assert.equal(body.baseline.baseline.latency_ms_avg, 180);

  const missing = await handleReliabilityBaseline(getRequest(), env, "service-zz");
  assert.equal(missing.status, 404);

  // A window too small for honest evaluation refuses the baseline.
  const thin = freshCounters(36, 36, 180, 1);
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(thin));
  const refused = await handleReliabilityBaseline(getRequest(), env, "service-a");
  assert.equal(refused.status, 503);
});

// ------------------------------------------------------------------ //
// Transition planning                                                 //
// ------------------------------------------------------------------ //

function resultDoc(states, evaluatedAt = "2026-07-19T12:00:00Z") {
  return {
    evaluated_at: evaluatedAt,
    results: Object.entries(states).map(([serviceId, state]) => ({
      service_id: serviceId,
      objective_id: `${serviceId}-availability-30d`,
      state,
      reasons: [`fixture reason for ${state}`],
      budget: { remaining_fraction: state === "objective_met" ? 1 : 0.1 },
      burn: { fast: { rate: 2.5 }, slow: { rate: 0.5 } },
    })),
    unmeasured: [],
  };
}

const CONFIG = {
  notification_cooldown_seconds: 21600,
  recovery_confirmation_passes: 6,
  storm_suppression_threshold: 5,
};

test("transitions notify once and cool down", () => {
  let plan = planNotifications(null, resultDoc({ a: "objective_met" }), CONFIG);
  assert.equal(plan.events.length, 0, "first sight of healthy is not a transition");

  plan = planNotifications(plan.state, resultDoc({ a: "budget_at_risk" }), CONFIG);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].kind, "degradation");

  plan = planNotifications(plan.state, resultDoc({ a: "budget_at_risk" }), CONFIG);
  assert.equal(plan.events.length, 0, "holding a state is not a transition");

  plan = planNotifications(plan.state, resultDoc({ a: "budget_exhausted" }), CONFIG);
  assert.equal(plan.events.length, 1, "worsening is a new transition");
});

test("recovery notifies only after six measured passes", () => {
  let plan = planNotifications(null, resultDoc({ a: "objective_met" }), CONFIG);
  plan = planNotifications(plan.state, resultDoc({ a: "budget_exhausted" }), CONFIG);
  assert.equal(plan.events.length, 1);

  for (let pass = 1; pass <= 5; pass += 1) {
    plan = planNotifications(plan.state, resultDoc({ a: "objective_met" }), CONFIG);
    assert.equal(plan.events.length, 0, `pass ${pass} must stay silent`);
  }
  plan = planNotifications(plan.state, resultDoc({ a: "objective_met" }), CONFIG);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].kind, "recovery");

  plan = planNotifications(plan.state, resultDoc({ a: "objective_met" }), CONFIG);
  assert.equal(plan.events.length, 0, "recovery is announced once");
});

test("a broad outage collapses into one consolidated event", () => {
  const healthy = {};
  const degraded = {};
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    healthy[id] = "objective_met";
    degraded[id] = "unavailable_source";
  }
  let plan = planNotifications(null, resultDoc(healthy), CONFIG);
  plan = planNotifications(plan.state, resultDoc(degraded), CONFIG);
  assert.equal(plan.suppressed, true);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].consolidated, true);
  assert.equal(plan.events[0].count, 6);

  // The suppressed pass still wrote cooldown entries: no echo next pass.
  plan = planNotifications(plan.state, resultDoc(degraded), CONFIG);
  assert.equal(plan.events.length, 0);
});

test("notification payloads carry runbooks and never carry secrets", async () => {
  const env = makeEnv();
  const healthy = loadVector("healthy");
  await seedPolicy(env, healthy.input.policy);
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(freshCounters(144, 144)));
  await runReliabilityPass(env, { checked_at: new Date().toISOString() });
  assert.equal(env.notifications.length, 0);

  // Same policy, degraded counters: service-a exhausts its budget.
  await env.ATLAS_PUBLIC_KV.put(UPTIME_KEY, JSON.stringify(freshCounters(130, 144)));
  await runReliabilityPass(env, { checked_at: new Date().toISOString() });
  assert.equal(env.notifications.length, 1);
  const payload = env.notifications[0];
  assert.equal(payload.signal_class, "reliability");
  assert.equal(payload.level, "failure");
  assert.match(payload.fields.runbook, /reliability-budget-exhausted\.md$/);
  assert.match(payload.fields.dedup_key, /^reliability:service-a:/);
  const flat = JSON.stringify(payload).toLowerCase();
  assert.ok(!flat.includes("notify-token-fixture"), "credential leaked into payload");
  assert.ok(!flat.includes("evidence-key"), "bearer leaked into payload");
});
