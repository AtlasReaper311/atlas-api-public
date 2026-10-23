import { test } from "node:test";
import assert from "node:assert/strict";

import { probeEstate } from "../src/lib/status.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binding(handler) {
  return {
    fetch: async (url, init) => handler(new URL(String(url)), init),
  };
}

function makeEnv(quotaHandler) {
  let registryTimeoutMs;
  const registry = binding((_url, init) => {
    registryTimeoutMs = init.signal.timeoutMs;
    return jsonResponse({ name: "atlas-api-index" });
  });

  let quotaTimeoutMs;
  const quota = binding(async (_url, init) => {
    quotaTimeoutMs = init.signal.timeoutMs;
    return quotaHandler();
  });

  return {
    env: {
      REGISTRY: registry,
      ATLAS_NOTIFY: binding(() => jsonResponse({ ok: true })),
      SPECULAR_EDGE: binding(() => jsonResponse({ online: true })),
      GITHUB_PULSE: binding((url) =>
        url.pathname.endsWith("/pulse/workflows")
          ? jsonResponse({ workflows: {} })
          : jsonResponse({ totals: {} }),
      ),
      SITE_PULSE: binding(() => jsonResponse({ ok: true })),
      DEPLOY_WATCH: binding(() => jsonResponse({ ok: true })),
      RAMONE_TRIGGER: binding(() => jsonResponse({ ok: true })),
      ATLAS_BLACKBOX: binding(() => jsonResponse({ ok: true })),
      ATLAS_QUOTA_WATCH: quota,
      RAMONE_EDGE: binding(() =>
        jsonResponse({ awake: true, checked_at: "2026-10-23T00:00:00Z" }),
      ),
      ATLAS_PUBLIC_KV: { get: async () => null },
      CORPUS_ORIGIN: "https://corpus.test",
      STALE_AFTER_SECONDS: "1200",
    },
    getTimeouts: () => ({ registry: registryTimeoutMs, quota: quotaTimeoutMs }),
  };
}

function stubTimeouts(t) {
  t.mock.method(AbortSignal, "timeout", (timeoutMs) => {
    const signal = new AbortController().signal;
    Object.defineProperty(signal, "timeoutMs", { value: timeoutMs });
    return signal;
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    const requestUrl = new URL(String(url));
    return requestUrl.hostname === "corpus.test"
      ? jsonResponse({ ok: true, chunks: 900 })
      : new Response(null, { status: 200 });
  });
}

test("quota binding gets a longer bounded deadline than ordinary probes", async (t) => {
  stubTimeouts(t);
  const setup = makeEnv(() => jsonResponse({
    ok: true,
    warn_threshold_pct: 80,
    meters: [{ id: "workers_requests", pct: 4, breach: false }],
  }));

  const components = await probeEstate(setup.env);

  assert.deepEqual(setup.getTimeouts(), { registry: 5_000, quota: 10_000 });
  assert.equal(components.atlas_quota_watch.ok, true);
});

test("quota probe still reports a bounded timeout as a failure", async (t) => {
  stubTimeouts(t);
  const setup = makeEnv(() => {
    throw new Error("The operation was aborted due to timeout");
  });

  const components = await probeEstate(setup.env);

  assert.equal(setup.getTimeouts().quota, 10_000);
  assert.equal(components.atlas_quota_watch.ok, false);
  assert.match(components.atlas_quota_watch.detail, /timeout/);
});
