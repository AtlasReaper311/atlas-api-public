/**
 * Smoke suite for atlas-api-public, on node:test with stubbed bindings.
 *
 * These are behaviour tests against the real modules: KV is an
 * in-memory map, service bindings are recorded fakes, the rate limiter
 * is scriptable, and global fetch is stubbed per test for the corpus
 * paths. The one test that matters most is the OpenAPI walk: every path
 * documented in /v1/openapi.json is exercised against the live router,
 * so the spec cannot drift from the code without failing CI.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { runCron } from "../src/cron.js";
import { buildOpenApi } from "../src/openapi.js";
import { badgeStatus } from "../src/lib/status.js";
import { renderBadge } from "../src/routes/badge.js";

const BASE = "https://api.atlas-systems.uk";

const REGISTRY_DOC = {
  service: "atlas-api-index",
  generated_at: "2026-07-05T12:00:00Z",
  counts: { workers: 11, documented: 4, undocumented: 7 },
  workers: [
    {
      name: "atlas-notify",
      documented: true,
      meta: {
        description: "Deploy router",
        version: "1.1.0",
        endpoints: [{ method: "GET", path: "/health" }],
      },
    },
  ],
};

const CORPUS_SEARCH = {
  query: "tunnel",
  hits: [
    {
      text: "cloudflared reads from ProgramData",
      score: 0.88,
      source_repo: "atlas-infra",
      file_path: "decisions.md",
      doc_type: "md",
      last_updated: "2026-07-01",
      chunk_index: 2,
    },
  ],
  took_ms: 37,
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function makeCtx() {
  const tasks = [];
  return {
    waitUntil(promise) {
      tasks.push(promise);
    },
    async drain() {
      await Promise.all(tasks);
    },
  };
}

function makeEnv(overrides = {}) {
  const notifications = [];
  return {
    notifications,
    ATLAS_PUBLIC_KV: makeKV(),
    ATLAS_NOTIFY: {
      fetch: async (url, init) => {
        if (init && init.body) notifications.push(JSON.parse(init.body));
        return jsonResponse({ ok: true });
      },
    },
    REGISTRY: {
      fetch: async (url) =>
        new URL(url).pathname === "/_meta"
          ? jsonResponse({ name: "atlas-api-index" })
          : jsonResponse(REGISTRY_DOC),
    },
    GITHUB_PULSE: {
      fetch: async (url) =>
        new URL(url).pathname.endsWith("/pulse/workflows")
          ? jsonResponse({
              workflows: {
                "atlas-badges": {
                  status: "healthy",
                  detail: "current main CI succeeded",
                  evidence_source: "github-actions:AtlasReaper311/atlas-badges/workflows/ci.yml",
                  measured_at: new Date().toISOString(),
                },
                "atlas-dep-audit": {
                  status: "healthy",
                  detail: "latest scheduled run succeeded",
                  evidence_source: "github-actions:AtlasReaper311/atlas-dep-audit/workflows/audit.yml",
                  measured_at: new Date().toISOString(),
                },
                "atlas-journey-watch": {
                  status: "healthy",
                  detail: "latest scheduled run succeeded",
                  evidence_source: "github-actions:AtlasReaper311/atlas-journey-watch/workflows/journey-watch.yml",
                  measured_at: new Date().toISOString(),
                },
              },
            })
          : jsonResponse({ totals: { publicRepos: 19, stars: 12 } }),
    },
    SPECULAR_EDGE: {
      fetch: async () => jsonResponse({ online: true }),
    },
    SITE_PULSE: {
      fetch: async () => jsonResponse({ ok: true, service: "site-pulse" }),
    },
    DEPLOY_WATCH: {
      fetch: async () => jsonResponse({ ok: true, service: "deploy-watch" }),
    },
    RAMONE_TRIGGER: {
      fetch: async () => jsonResponse({ status: "live", name: "ramone-trigger" }),
    },
    ATLAS_BLACKBOX: {
      fetch: async () => jsonResponse({ ok: true, name: "atlas-blackbox" }),
    },
    ATLAS_QUOTA_WATCH: {
      fetch: async () => jsonResponse({
        ok: true,
        warn_threshold_pct: 80,
        meters: [{ id: "workers_requests", pct: 4.5, breach: false }],
      }),
    },
    RAMONE_EDGE: {
      fetch: async () => jsonResponse({ awake: false, checked_at: new Date().toISOString() }),
    },
    RL_GENERAL: { limit: async () => ({ success: true }) },
    RL_SEARCH: { limit: async () => ({ success: true }) },
    NOTIFY_TOKEN: "test-token",
    INFRA_REPORT_KEY: "infra-key",
    RAG_REPORT_KEY: "rag-key",
    CORPUS_ORIGIN: "https://corpus.test",
    STALE_AFTER_SECONDS: "1200",
    UPTIME_WINDOW_DAYS: "30",
    ...overrides,
  };
}

function okReport(extra = {}) {
  const check = { ok: true, latency_ms: 12, detail: "fine" };
  return {
    sentinel: "specular-sentinel/1.0.0",
    machine: "SPECULAR-CORE",
    ts: new Date().toISOString(),
    wsl_ip: "172.20.1.5",
    previous_wsl_ip: null,
    ip_changed: false,
    checks: { ollama: { ...check }, corpus_health: { ...check }, corpus_search: { ...check } },
    ...extra,
  };
}

async function call(env, path, init = {}) {
  const ctx = makeCtx();
  const res = await worker.fetch(new Request(`${BASE}${path}`, init), env, ctx);
  await ctx.drain();
  return res;
}

function postJson(body, key) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

const realFetch = globalThis.fetch;
let fetchHandler = null;

beforeEach(() => {
  fetchHandler = () => {
    throw new Error("corpus down (default stub)");
  };
  globalThis.fetch = async (url, init) => fetchHandler(new URL(String(url)), init);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ------------------------------------------------------------------ //
// Router basics                                                       //
// ------------------------------------------------------------------ //

test("OPTIONS answers 204 with open CORS", async () => {
  const res = await call(makeEnv(), "/v1/stats", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("GET /v1 lists the surface", async () => {
  const res = await call(makeEnv(), "/v1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.service, "atlas-api-public");
  assert.ok(body.endpoints.length >= 10);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("/_meta answers under both the bare and prefixed path", async () => {
  for (const path of ["/_meta", "/v1/_meta"]) {
    const res = await call(makeEnv(), path);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, "atlas-api-public");
    assert.equal(body.status, "live");
  }
});

test("unknown paths get a 404 with a hint, not an empty body", async () => {
  const res = await call(makeEnv(), "/v1/nope");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.hint, /docs/);
});

test("general rate limiting answers 429 but the badge stays exempt", async () => {
  const env = makeEnv({ RL_GENERAL: { limit: async () => ({ success: false }) } });
  const limited = await call(env, "/v1/stats");
  assert.equal(limited.status, 429);
  const badge = await call(env, "/v1/badge/status");
  assert.equal(badge.status, 200);
});

// ------------------------------------------------------------------ //
// The spec cannot drift: walk every documented path                   //
// ------------------------------------------------------------------ //

test("every path in openapi.json exists on the router", async () => {
  const spec = buildOpenApi();
  fetchHandler = (url) =>
    url.pathname === "/search" ? jsonResponse(CORPUS_SEARCH) : jsonResponse({});
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      // Path templates walk with a concrete estate id so the router's
      // pattern branch is genuinely exercised.
      const concrete = path.replace("{service_id}", "atlas-notify");
      const target = concrete === "/v1/search" ? `${concrete}?q=tunnel` : concrete;
      const init =
        method === "post"
          ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
          : {};
      const res = await call(makeEnv(), target, init);
      assert.notEqual(res.status, 404, `${method.toUpperCase()} ${path} is documented but unrouted`);
    }
  }
});

// ------------------------------------------------------------------ //
// Infra pipeline                                                      //
// ------------------------------------------------------------------ //

test("infra report requires the bearer key", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/v1/infra/report", postJson(okReport()))).status, 401);
  assert.equal(
    (await call(env, "/v1/infra/report", postJson(okReport(), "wrong"))).status,
    401,
  );
});

test("infra report validates shape before storing", async () => {
  const env = makeEnv();
  const res = await call(
    env,
    "/v1/infra/report",
    postJson({ machine: "X", ip_changed: false, checks: {} }, "infra-key"),
  );
  assert.equal(res.status, 422);
});

test("first ok report stores state and announces recovery from unknown", async () => {
  const env = makeEnv();
  const res = await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.overall, "ok");
  assert.equal(env.notifications.length, 1);
  assert.equal(env.notifications[0].signal_class, "infra_health");
  assert.equal(env.notifications[0].level, "success");
});

test("a repeated identical state fires no second alert", async () => {
  const env = makeEnv();
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));
  assert.equal(env.notifications.length, 1);
});

test("degradation and recovery are one warning and one success", async () => {
  const env = makeEnv();
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));

  const degraded = okReport();
  degraded.checks.ollama = { ok: false, latency_ms: null, detail: "connection refused" };
  await call(env, "/v1/infra/report", postJson(degraded, "infra-key"));
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));

  const levels = env.notifications.map((n) => n.level);
  assert.deepEqual(levels, ["success", "warning", "success"]);
  assert.match(env.notifications[1].fields.ollama, /refused/);
});

test("ip drift alerts as a warning even when overall state is steady", async () => {
  const env = makeEnv();
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));
  const drift = okReport({
    ip_changed: true,
    previous_wsl_ip: "172.20.1.5",
    wsl_ip: "172.20.9.2",
  });
  await call(env, "/v1/infra/report", postJson(drift, "infra-key"));
  const driftAlert = env.notifications.find((n) => /drift/i.test(n.title));
  assert.ok(driftAlert);
  assert.equal(driftAlert.level, "warning");
  assert.equal(driftAlert.fields.current, "172.20.9.2");
});

test("infra status recomputes staleness at read time", async () => {
  const env = makeEnv();
  const old = okReport({ ts: new Date(Date.now() - 3600_000).toISOString() });
  await call(env, "/v1/infra/report", postJson(old, "infra-key"));
  const res = await call(env, "/v1/infra/status");
  const body = await res.json();
  assert.equal(body.stale, true);
  assert.equal(body.overall, "down");
});

test("cron marks a silent sentinel down and alerts exactly once", async () => {
  const env = makeEnv();
  fetchHandler = (url) =>
    url.pathname === "/health"
      ? jsonResponse({ ok: true, chunks: 340 })
      : jsonResponse({});
  const old = okReport({ ts: new Date(Date.now() - 3600_000).toISOString() });
  await call(env, "/v1/infra/report", postJson(old, "infra-key"));
  env.notifications.length = 0;

  await runCron(env);
  await runCron(env); // second pass must not re-alert

  const silent = env.notifications.filter((n) => /silent/i.test(n.title));
  assert.equal(silent.length, 1);
  assert.equal(silent[0].level, "failure");

  const stored = JSON.parse(await env.ATLAS_PUBLIC_KV.get("infra:state:v1"));
  assert.equal(stored.stale, true);
  assert.equal(stored.overall, "down");
});

// ------------------------------------------------------------------ //
// RAG pipeline                                                        //
// ------------------------------------------------------------------ //

function summary(count) {
  return {
    window_start: "2026-07-05T11:00:00Z",
    window_end: "2026-07-05T12:00:00Z",
    count,
    top_terms: [{ term: "tunnel", count: 3 }],
    queries_today: 9,
    queries_total: 120,
    last_query_at: "2026-07-05T11:47:02Z",
  };
}

test("rag report requires its own bearer key", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/v1/rag/report", postJson(summary(3)))).status, 401);
  assert.equal(
    (await call(env, "/v1/rag/report", postJson(summary(3), "infra-key"))).status,
    401,
  );
});

test("an active hour stores and relays to rag_queries", async () => {
  const env = makeEnv();
  const res = await call(env, "/v1/rag/report", postJson(summary(3), "rag-key"));
  const body = await res.json();
  assert.equal(body.relayed, true);
  assert.equal(env.notifications.length, 1);
  assert.equal(env.notifications[0].signal_class, "rag_queries");
  assert.match(env.notifications[0].title, /3/);
  assert.match(env.notifications[0].message, /tunnel/);
});

test("a quiet hour updates the card and stays out of Discord", async () => {
  const env = makeEnv();
  const res = await call(env, "/v1/rag/report", postJson(summary(0), "rag-key"));
  const body = await res.json();
  assert.equal(body.relayed, false);
  assert.equal(env.notifications.length, 0);
  assert.ok(await env.ATLAS_PUBLIC_KV.get("rag:stats:v1"));
});

test("rag stats fall back to the last summary when the corpus sleeps", async () => {
  const env = makeEnv();
  await call(env, "/v1/rag/report", postJson(summary(3), "rag-key"));
  const res = await call(env, "/v1/rag/stats");
  const body = await res.json();
  assert.equal(body.source, "last-summary");
  assert.equal(body.queries_last_hour, 3);
  assert.equal(body.queries_today, 9);
  // The privacy boundary is structural: no terms in the public response.
  assert.equal(body.top_terms, undefined);
  assert.match(body.privacy, /never logged/);
});

test("rag stats prefer live corpus numbers when reachable", async () => {
  const env = makeEnv();
  fetchHandler = (url) =>
    url.pathname === "/stats"
      ? jsonResponse({
          queries_last_hour: 5,
          queries_today: 14,
          queries_total: 125,
          last_query_at: "2026-07-05T12:31:00Z",
        })
      : jsonResponse({});
  const res = await call(env, "/v1/rag/stats");
  const body = await res.json();
  assert.equal(body.source, "live");
  assert.equal(body.queries_last_hour, 5);
});

// ------------------------------------------------------------------ //
// Public reads                                                        //
// ------------------------------------------------------------------ //

test("search proxies and normalises the corpus response", async () => {
  const env = makeEnv();
  fetchHandler = (url) => {
    assert.equal(url.hostname, "corpus.test");
    assert.equal(url.searchParams.get("q"), "tunnel");
    return jsonResponse(CORPUS_SEARCH);
  };
  const res = await call(env, "/v1/search?q=tunnel");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.equal(body.hits[0].source_repo, "atlas-infra");
  assert.equal(body.source, "atlas-corpus");
});

test("search input gates: missing q, oversize q, sleeping corpus", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "/v1/search")).status, 400);
  assert.equal((await call(env, `/v1/search?q=${"a".repeat(501)}`)).status, 422);
  const down = await call(env, "/v1/search?q=tunnel"); // default stub throws
  assert.equal(down.status, 503);
  assert.match((await down.json()).hint, /infra\/status/);
});

test("search honours its dedicated limiter", async () => {
  const env = makeEnv({ RL_SEARCH: { limit: async () => ({ success: false }) } });
  assert.equal((await call(env, "/v1/search?q=tunnel")).status, 429);
});

test("registry filters the upstream document into the stable public v1 form", async () => {
  const env = makeEnv();
  const res = await call(env, "/v1/registry");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.counts.workers, 1);
  assert.equal(body.workers[0].name, "atlas-notify");
  assert.equal(body.workers[0].version, "1.1.0");
  assert.deepEqual(body.workers[0].endpoints, [{ method: "GET", path: "/health" }]);
});

test("stats compose the cron snapshots, pulse totals, and uptime", async () => {
  const env = makeEnv();
  fetchHandler = (url) =>
    url.pathname === "/health"
      ? jsonResponse({ ok: true, chunks: 340 })
      : jsonResponse({});
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));
  await runCron(env);

  const res = await call(env, "/v1/stats");
  const body = await res.json();
  assert.equal(body.estate.operational, 19);
  assert.equal(body.estate.total_components, 19);
  assert.equal(body.estate.workers.workers, 11);
  assert.equal(body.repos.public, 19);
  assert.equal(body.uptime.components.corpus, 100);
  assert.equal(body.estate.component_details.atlas_badges.status, "healthy");
  assert.match(
    body.estate.component_details.atlas_badges.evidence_source,
    /github-actions/,
  );
  assert.ok(body.uptime.measuring_since);
  assert.equal(body.infra.overall, "ok");
});

test("workflow evidence preserves degraded, down, and unknown states", async () => {
  const env = makeEnv({
    GITHUB_PULSE: {
      fetch: async (url) =>
        new URL(url).pathname.endsWith("/pulse/workflows")
          ? jsonResponse({
              workflows: {
                "atlas-badges": { status: "degraded", detail: "CI running" },
                "atlas-dep-audit": { status: "down", detail: "audit failed" },
                "atlas-journey-watch": { status: "unknown", detail: "no evidence" },
              },
            })
          : jsonResponse({ totals: { publicRepos: 19, stars: 12 } }),
    },
  });
  fetchHandler = () => jsonResponse({ ok: true, chunks: 340 });
  await runCron(env);

  const body = await (await call(env, "/v1/stats")).json();
  assert.equal(body.estate.component_details.atlas_badges.status, "degraded");
  assert.equal(body.estate.components.atlas_badges, true);
  assert.equal(body.estate.component_details.atlas_dep_audit.status, "down");
  assert.equal(body.estate.components.atlas_dep_audit, false);
  assert.equal(body.estate.component_details.atlas_journey_watch.status, "unknown");
});

test("uptime buckets accumulate across cron passes", async () => {
  const env = makeEnv();
  fetchHandler = (url) =>
    url.pathname === "/health"
      ? jsonResponse({ ok: true, chunks: 340 })
      : jsonResponse({});
  await runCron(env);
  await runCron(env);
  const doc = JSON.parse(await env.ATLAS_PUBLIC_KV.get("uptime:days:v1"));
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(doc.components.corpus[today].total, 2);
});

test("slo serves per-day counters with an honest window label", async () => {
  const env = makeEnv();
  fetchHandler = (url) =>
    url.pathname === "/health"
      ? jsonResponse({ ok: true, chunks: 340 })
      : jsonResponse({});
  await runCron(env);
  await runCron(env);
  const res = await call(env, "/v1/slo");
  const body = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(body.ok, true);
  assert.equal(body.window_days, 30);
  assert.ok(body.measuring_since);
  assert.equal(body.components.corpus.days[today].total, 2);
  assert.equal(body.components.corpus.ok, 2);
  assert.equal(body.components.corpus.days_observed, 1);
  assert.ok(Number.isFinite(body.components.registry.avg_ms));
  assert.equal(body.components.machine.avg_ms, null);
});

test("slo answers honestly before any counters exist", async () => {
  const res = await call(makeEnv(), "/v1/slo");
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.measuring_since, null);
  assert.deepEqual(body.components, {});
});

// ------------------------------------------------------------------ //
// Badge                                                               //
// ------------------------------------------------------------------ //

test("badge renders green when the whole estate is up", async () => {
  const env = makeEnv();
  fetchHandler = (url) =>
    url.pathname === "/health"
      ? jsonResponse({ ok: true, chunks: 340 })
      : jsonResponse({});
  await call(env, "/v1/infra/report", postJson(okReport(), "infra-key"));
  await runCron(env);

  const res = await call(env, "/v1/badge/status");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  const svg = await res.text();
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.endsWith("</svg>"));
  assert.match(svg, /19\/19 operational/);
  assert.match(svg, /#4c1/);
});

test("badge degrades honestly with no data", async () => {
  const res = await call(makeEnv(), "/v1/badge/status");
  const svg = await res.text();
  assert.match(svg, /no data/);
});

test("badge counts the expanded contract before the first new cron pass", () => {
  const legacyComponents = Object.fromEntries(
    [
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
    ].map((name) => [name, { ok: true }]),
  );
  const status = badgeStatus({
    operational: 10,
    total: 10,
    components: legacyComponents,
  });
  assert.equal(status.message, "10/19 operational");
  assert.equal(status.total, 19);
});

test("badge geometry stays well formed for varied messages", () => {
  for (const msg of ["0/19 operational", "19/19 operational", "no data"]) {
    const svg = renderBadge("atlas systems", msg, "#4c1");
    const width = Number(svg.match(/width="(\d+)"/)[1]);
    assert.ok(width > 100 && width < 400, `implausible width ${width}`);
    assert.equal((svg.match(/<text/g) || []).length, 4);
    assert.ok(!svg.includes("NaN"));
  }
});
