/**
 * Reliability evaluator: the runtime port of the canonical reference
 * implementation in atlas-infra/scripts/reliability_evaluator.py.
 *
 * The shared vectors under test/fixtures/reliability/vectors/ (copied from
 * atlas-infra/tests/fixtures/reliability/vectors/) pin this port to the
 * reference byte-for-byte: identical inputs must produce identical canonical
 * JSON, fingerprints included. Every formula here mirrors the reference
 * sequence exactly; a change on either side without the other fails the
 * vector suite, which is the point.
 *
 * Honesty rules: missing, malformed, stale or insufficient evidence is a
 * stated condition, never health. Burn windows are day-granular because the
 * counters are day-granular. Percentiles are structurally impossible from
 * ms_sum/ms_count aggregates and are always reported unsupported.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const STATE_TO_CONTROL_PLANE = {
  objective_met: "healthy",
  budget_at_risk: "warning",
  budget_exhausted: "failed",
  insufficient_evidence: "unknown",
  stale_evidence: "stale",
  unavailable_source: "unavailable",
  malformed_evidence: "unavailable",
  unmeasured: "unknown",
};

/** Round half away from zero; mirrors round_places in the reference. */
export function roundPlaces(value, places) {
  const factor = 10 ** places;
  const scaled = Math.floor(Math.abs(value) * factor + 0.5) / factor;
  return value >= 0 ? scaled : -scaled;
}

function parseUtc(value) {
  return new Date(value.replace(/Z$/, "") + "Z");
}

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function formatInstant(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Canonical JSON: lexicographically sorted keys, compact separators. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function digestJson(value) {
  return sha256Hex(canonicalJson(value));
}

function isPlainInt(value) {
  return typeof value === "number" && Number.isInteger(value);
}

function bucketErrors(day, bucket, today) {
  if (!DAY_PATTERN.test(day)) return [`day key '${day}' is not a UTC date`];
  if (day > today) return [`day ${day} is in the future`];
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    return [`day ${day} bucket is not an object`];
  }
  const problems = [];
  for (const name of ["ok", "total"]) {
    const value = bucket[name];
    if (!isPlainInt(value) || value < 0) {
      problems.push(`day ${day} ${name} is not a non-negative integer`);
    }
  }
  if (problems.length === 0 && bucket.ok > bucket.total) {
    problems.push(`day ${day} counts ok above total`);
  }
  for (const name of ["ms_sum", "ms_count"]) {
    if (name in bucket) {
      const value = bucket[name];
      if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
        problems.push(`day ${day} ${name} is not a non-negative number`);
      }
    }
  }
  if (
    problems.length === 0 &&
    isPlainInt(bucket.ms_count) &&
    bucket.ms_count > bucket.ok
  ) {
    problems.push(`day ${day} ms_count exceeds ok samples`);
  }
  return problems;
}

function burn(windowDays, days, bucketDays, minimumSamples, allowedFraction) {
  const recent = windowDays.slice(-bucketDays);
  let ok = 0;
  let total = 0;
  for (const day of recent) {
    ok += days[day].ok ?? 0;
    total += days[day].total ?? 0;
  }
  if (total < minimumSamples) {
    return {
      rate: null,
      samples: total,
      bucket_days: bucketDays,
      reason: `insufficient samples for burn window (${total} of ${minimumSamples})`,
    };
  }
  if (allowedFraction <= 0) {
    return {
      rate: null,
      samples: total,
      bucket_days: bucketDays,
      reason: "a 100 percent target has no burn allowance",
    };
  }
  const rate = (total - ok) / total / allowedFraction;
  return {
    rate: roundPlaces(rate, 2),
    samples: total,
    bucket_days: bucketDays,
    reason: null,
  };
}

/**
 * Evaluate every objective in the policy against the counters document.
 * Pure function of its inputs; `now` and `sourceCheckedAt` are ISO strings.
 */
export async function evaluate(policy, uptime, nowIso, sourceCheckedAt = null) {
  const config = policy.evaluator_config;
  const now = parseUtc(nowIso);
  const today = utcDay(now);
  const staleSeconds = config.result_stale_after_seconds;
  const staleAfter = formatInstant(new Date(now.getTime() + staleSeconds * 1000));
  const percentileReason = config.percentile_reason;
  const expectedPerDay = config.expected_samples_per_day;

  const uptimeValid =
    uptime !== null &&
    typeof uptime === "object" &&
    !Array.isArray(uptime) &&
    uptime.components !== null &&
    typeof uptime.components === "object" &&
    !Array.isArray(uptime.components);

  let measuringSince = null;
  let windowDaysCount = null;
  if (uptimeValid) {
    if (typeof uptime.started_at === "string") {
      const parsed = parseUtc(uptime.started_at);
      if (!Number.isNaN(parsed.getTime())) measuringSince = uptime.started_at;
    }
    if (
      isPlainInt(uptime.window_days) &&
      uptime.window_days >= 1 &&
      uptime.window_days <= 90
    ) {
      windowDaysCount = uptime.window_days;
    }
  }

  const results = [];
  for (const objective of policy.objectives) {
    results.push(
      evaluateObjective(
        objective,
        uptimeValid ? uptime : null,
        config,
        now,
        today,
        measuringSince,
        sourceCheckedAt,
        percentileReason,
        expectedPerDay,
      ),
    );
  }

  const document = {
    schema_version: "atlas-control-plane/reliability-result/v1",
    evaluated_at: formatInstant(now),
    stale_after: staleAfter,
    policy_fingerprint: policy.fingerprint,
    source: {
      provider: "atlas-api-public/v1/slo",
      window_days: windowDaysCount !== null ? windowDaysCount : 30,
      measuring_since: measuringSince,
      checked_at: sourceCheckedAt,
    },
    results,
    unmeasured: (policy.unmeasured ?? []).map((item) => ({
      service_id: item.service_id,
      reason: item.reason,
    })),
  };
  document.fingerprint = await digestJson(document);
  return document;
}

function evaluateObjective(
  objective,
  uptime,
  config,
  now,
  today,
  measuringSince,
  sourceCheckedAt,
  percentileReason,
  expectedPerDay,
) {
  const target = objective.target_pct;
  const allowedFraction = (100 - target) / 100;
  const reasons = [];
  const windowLimit = objective.window_days;
  const cutoff = utcDay(new Date(now.getTime() - windowLimit * 86400000));

  const result = {
    service_id: objective.service_id,
    objective_id: objective.objective_id,
    indicator: objective.indicator,
    target_pct: target,
    state: "unavailable_source",
    control_plane_state: "unavailable",
    reasons,
    window: { start_day: null, end_day: null, days_observed: 0 },
    samples: { ok: 0, failed: 0, total: 0 },
    availability_pct: null,
    coverage: { fraction: null, observed: 0, expected: 0 },
    latency: {
      avg_ms: null,
      percentiles_supported: false,
      percentile_reason: percentileReason,
    },
    budget: {
      allowed_failures: null,
      remaining_fraction: null,
      consumed_fraction: null,
    },
    burn: {
      fast: {
        rate: null,
        samples: 0,
        bucket_days: config.fast_burn.bucket_days,
        reason: "source unavailable",
      },
      slow: {
        rate: null,
        samples: 0,
        bucket_days: config.slow_burn.bucket_days,
        reason: "source unavailable",
      },
    },
    freshness: {
      evidence_stale_after_seconds:
        objective.freshness.evidence_stale_after_seconds,
    },
  };

  const finish = (state) => {
    result.state = state;
    result.control_plane_state = STATE_TO_CONTROL_PLANE[state];
    return result;
  };

  if (uptime === null) {
    reasons.push("probe counters document is missing or malformed");
    return finish("unavailable_source");
  }

  const componentName = objective.measurement_source.component;
  const component = uptime.components[componentName];
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    reasons.push(`component ${componentName} has no counters`);
    return finish("unavailable_source");
  }

  const structural = [];
  for (const day of Object.keys(component).sort()) {
    structural.push(...bucketErrors(day, component[day], today));
  }
  if (structural.length > 0) {
    reasons.push(...structural.slice(0, 8));
    return finish("malformed_evidence");
  }

  const windowDays = Object.keys(component)
    .filter((day) => day >= cutoff)
    .sort();
  let ok = 0;
  let total = 0;
  for (const day of windowDays) {
    ok += component[day].ok;
    total += component[day].total;
  }
  const failed = total - ok;

  result.window = {
    start_day: windowDays.length > 0 ? windowDays[0] : null,
    end_day: windowDays.length > 0 ? windowDays[windowDays.length - 1] : null,
    days_observed: windowDays.length,
  };
  result.samples = { ok, failed, total };

  if (total > 0) {
    result.availability_pct = roundPlaces((ok / total) * 100, 2);
  }

  let msSum = 0;
  let msCount = 0;
  for (const day of windowDays) {
    msSum += component[day].ms_sum ?? 0;
    msCount += component[day].ms_count ?? 0;
  }
  if (msCount > 0) {
    result.latency.avg_ms = roundPlaces(msSum / msCount, 0);
  }

  // Expected sample volume mirrors the reference: full cadence for every
  // elapsed day since measurement effectively began, plus today's elapsed
  // portion at one probe per 600 seconds.
  let effectiveStart = cutoff;
  if (measuringSince !== null) {
    const sinceDay = utcDay(parseUtc(measuringSince));
    if (sinceDay > effectiveStart) effectiveStart = sinceDay;
  }
  let expected = 0;
  if (effectiveStart <= today) {
    const startDate = parseUtc(`${effectiveStart}T00:00:00Z`);
    const todayDate = parseUtc(`${today}T00:00:00Z`);
    const fullDays = Math.max(
      Math.round((todayDate.getTime() - startDate.getTime()) / 86400000),
      0,
    );
    const secondsToday = (now.getTime() - todayDate.getTime()) / 1000;
    expected = fullDays * expectedPerDay + Math.floor(secondsToday / 600);
  }
  result.coverage.observed = total;
  result.coverage.expected = expected;
  if (expected > 0) {
    result.coverage.fraction = roundPlaces(Math.min(total / expected, 1), 4);
  }

  const fast = burn(
    windowDays,
    component,
    config.fast_burn.bucket_days,
    config.fast_burn.minimum_samples,
    allowedFraction,
  );
  const slow = burn(
    windowDays,
    component,
    config.slow_burn.bucket_days,
    config.slow_burn.minimum_samples,
    allowedFraction,
  );
  result.burn = { fast, slow };

  // Staleness beats budget maths: old numbers presented as current would be
  // the exact dishonesty this system exists to prevent.
  const evidenceStaleSeconds =
    objective.freshness.evidence_stale_after_seconds;
  if (sourceCheckedAt !== null) {
    const age = (now.getTime() - parseUtc(sourceCheckedAt).getTime()) / 1000;
    if (age > evidenceStaleSeconds) {
      reasons.push(
        `counters were last confirmed ${Math.floor(age)} seconds ago,` +
          ` past the ${evidenceStaleSeconds} second bound`,
      );
      return finish("stale_evidence");
    }
  } else if (
    windowDays.length > 0 &&
    windowDays[windowDays.length - 1] < utcDay(new Date(now.getTime() - 86400000))
  ) {
    reasons.push(
      `newest counters day ${windowDays[windowDays.length - 1]} is older than one day`,
    );
    return finish("stale_evidence");
  }

  const minimum = config.minimum_evaluation_samples;
  if (total < minimum) {
    reasons.push(`only ${total} samples of the ${minimum} required`);
    return finish("insufficient_evidence");
  }

  const allowed = total * allowedFraction;
  result.budget.allowed_failures = roundPlaces(allowed, 2);
  if (allowed > 0) {
    result.budget.remaining_fraction = roundPlaces((allowed - failed) / allowed, 4);
    result.budget.consumed_fraction = roundPlaces(failed / allowed, 4);
  } else {
    result.budget.remaining_fraction = failed === 0 ? 0 : -1;
    result.budget.consumed_fraction = failed === 0 ? 0 : 1;
    reasons.push("a 100 percent target leaves no failure allowance");
  }

  const coverageFraction = result.coverage.fraction;
  if (
    coverageFraction !== null &&
    coverageFraction < config.coverage_confidence_floor
  ) {
    reasons.push(`coverage ${coverageFraction} is below the confidence floor`);
  }

  if (
    result.budget.remaining_fraction !== null &&
    result.budget.remaining_fraction <= 0
  ) {
    reasons.push("the error budget for the window is exhausted");
    return finish("budget_exhausted");
  }

  let atRisk = false;
  if (fast.rate !== null && fast.rate >= config.fast_burn.at_risk_threshold) {
    reasons.push(`fast burn rate ${fast.rate} is at or above the risk threshold`);
    atRisk = true;
  }
  if (slow.rate !== null && slow.rate >= config.slow_burn.at_risk_threshold) {
    reasons.push(`slow burn rate ${slow.rate} is at or above the risk threshold`);
    atRisk = true;
  }
  if (
    result.budget.remaining_fraction !== null &&
    result.budget.remaining_fraction <= config.remaining_budget_at_risk_fraction
  ) {
    reasons.push(
      `remaining budget ${result.budget.remaining_fraction} is at or below the risk fraction`,
    );
    atRisk = true;
  }
  if (atRisk) return finish("budget_at_risk");
  return finish("objective_met");
}

/**
 * Build the release baseline document served to atlas-journey-watch.
 * Mirrors build_release_baseline in the reference; returns null whenever the
 * evidence cannot support an honest comparison.
 */
export async function buildReleaseBaseline(
  policy,
  uptime,
  nowIso,
  serviceId,
  sourceCheckedAt = null,
) {
  const result = await evaluate(policy, uptime, nowIso, sourceCheckedAt);
  const entry = result.results.find((item) => item.service_id === serviceId);
  if (
    !entry ||
    [
      "unavailable_source",
      "malformed_evidence",
      "stale_evidence",
      "insufficient_evidence",
    ].includes(entry.state)
  ) {
    return null;
  }

  const objective = policy.objectives.find(
    (item) => item.service_id === serviceId,
  );
  const config = policy.evaluator_config;
  const thresholds = config.release_baseline ?? {};
  const component = uptime.components[objective.measurement_source.component];
  const now = parseUtc(nowIso);
  const cutoff = utcDay(
    new Date(now.getTime() - objective.window_days * 86400000),
  );
  const windowDays = Object.keys(component)
    .filter((day) => day >= cutoff)
    .sort();
  const fastDays = windowDays.slice(-config.fast_burn.bucket_days);
  const baseDays = windowDays.filter((day) => !fastDays.includes(day));

  const windowStats = (dayList) => {
    let ok = 0;
    let total = 0;
    let msSum = 0;
    let msCount = 0;
    for (const day of dayList) {
      ok += component[day].ok;
      total += component[day].total;
      msSum += component[day].ms_sum ?? 0;
      msCount += component[day].ms_count ?? 0;
    }
    if (total === 0 || msCount === 0) return null;
    return {
      latency_ms_avg: roundPlaces(msSum / msCount, 0),
      error_rate: roundPlaces((total - ok) / total, 4),
    };
  };

  const baseline = windowStats(baseDays);
  const observed = windowStats(fastDays);
  if (!baseline || !observed || baseline.latency_ms_avg === 0) return null;
  const staleSeconds = thresholds.stale_after_seconds ?? 1800;
  return {
    schema_version: "atlas-journey-watch/release-baseline/v1",
    generated_at: formatInstant(now),
    stale_after: formatInstant(new Date(now.getTime() + staleSeconds * 1000)),
    service_id: serviceId,
    latency_metric: "avg",
    baseline,
    observed,
    thresholds: {
      latency_regression_percent: thresholds.latency_regression_percent ?? 25,
      error_rate_increase: thresholds.error_rate_increase ?? 0.02,
    },
  };
}

/**
 * Derive notification decisions from consecutive evaluations.
 *
 * State document shape (KV reliability:state:v1):
 *   { services: { "<service_id>:<objective_id>": {
 *       state, entered_at, met_streak,
 *       last_notified: { "<dedup key>": iso } } } }
 *
 * Transition rules: notify on entering budget_at_risk, budget_exhausted,
 * stale_evidence, or unavailable_source from a different measured state, and
 * on recovery to objective_met only after the recovered state has held for
 * `recovery_confirmation_passes` consecutive evaluations. Each dedup key
 * cools down for `notification_cooldown_seconds`. When
 * `storm_suppression_threshold` or more services transition in one pass, one
 * consolidated event replaces the individual ones and says so.
 */
export function planNotifications(previousState, resultDocument, config) {
  const nowIso = resultDocument.evaluated_at;
  const nowMs = parseUtc(nowIso).getTime();
  const cooldownMs = config.notification_cooldown_seconds * 1000;
  const recoveryPasses = config.recovery_confirmation_passes;
  const services = { ...(previousState?.services ?? {}) };
  const candidates = [];

  const NOTIFY_STATES = new Set([
    "budget_at_risk",
    "budget_exhausted",
    "stale_evidence",
    "unavailable_source",
  ]);

  for (const entry of resultDocument.results) {
    const key = `${entry.service_id}:${entry.objective_id}`;
    const previous = services[key] ?? null;
    const previousStateName = previous?.state ?? null;
    const lastNotified = { ...(previous?.last_notified ?? {}) };
    let metStreak = previous?.met_streak ?? 0;
    let enteredAt = previous?.entered_at ?? nowIso;
    if (previousStateName !== entry.state) enteredAt = nowIso;

    if (entry.state === "objective_met") {
      metStreak += 1;
    } else {
      metStreak = 0;
    }

    const record = {
      state: entry.state,
      entered_at: enteredAt,
      met_streak: metStreak,
      last_notified: lastNotified,
    };
    services[key] = record;

    let kind = null;
    let fromState = previousStateName;
    if (
      NOTIFY_STATES.has(entry.state) &&
      previousStateName !== null &&
      previousStateName !== entry.state
    ) {
      kind = "degradation";
    } else if (
      entry.state === "objective_met" &&
      previous?.pending_recovery === true &&
      metStreak >= recoveryPasses
    ) {
      kind = "recovery";
      fromState = previous?.recovered_from ?? null;
    }

    // Track that a recovery is owed once a notified degradation clears.
    if (NOTIFY_STATES.has(entry.state)) {
      record.pending_recovery = true;
      record.recovered_from = entry.state;
    } else if (previous?.pending_recovery === true && kind !== "recovery") {
      record.pending_recovery = true;
      record.recovered_from = previous.recovered_from;
    }

    if (kind === null) continue;
    const day = nowIso.slice(0, 10);
    const dedupKey = `reliability:${key}:${fromState}->${entry.state}:${day}`;
    const lastIso = lastNotified[dedupKey];
    if (lastIso && nowMs - parseUtc(lastIso).getTime() < cooldownMs) continue;

    candidates.push({ kind, entry, dedupKey, from_state: fromState });
    if (kind === "recovery") {
      record.pending_recovery = false;
      record.recovered_from = null;
    }
  }

  const state = { services };
  const threshold = config.storm_suppression_threshold;
  const degradations = candidates.filter((item) => item.kind === "degradation");
  let events = [];
  let suppressed = false;
  if (degradations.length >= threshold) {
    suppressed = true;
    const listed = degradations.slice(0, 10);
    events = [
      {
        consolidated: true,
        suppressed_individual_notifications: true,
        count: degradations.length,
        services: listed.map((item) => ({
          service_id: item.entry.service_id,
          state: item.entry.state,
        })),
        dedupKey: `reliability:estate:broad-degradation:${nowIso.slice(0, 10)}`,
      },
      ...candidates.filter((item) => item.kind === "recovery"),
    ];
  } else {
    events = candidates;
  }

  // Record the send time for every key this plan will notify.
  for (const item of events) {
    if (item.consolidated) continue;
    const key = `${item.entry.service_id}:${item.entry.objective_id}`;
    services[key].last_notified = {
      ...services[key].last_notified,
      [item.dedupKey]: nowIso,
    };
  }
  if (suppressed) {
    for (const item of degradations) {
      const key = `${item.entry.service_id}:${item.entry.objective_id}`;
      services[key].last_notified = {
        ...services[key].last_notified,
        [item.dedupKey]: nowIso,
      };
    }
  }

  return { state, events, suppressed };
}
