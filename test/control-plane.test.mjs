import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker from "../src/index.js";
import {
  CONTROL_PLANE_OPERATIONS,
  buildControlPlaneToolOpenApi,
} from "../src/control-plane-openapi.js";
import { validateControlPlaneReadModel } from "../src/routes/control-plane.js";

const BASE = "https://api.atlas-systems.uk";
const FIXTURE_TOKEN = "fixture-control-plane-token";
const READ_MODEL = JSON.parse(
  readFileSync(new URL("./fixtures/control-plane/read-model.json", import.meta.url), "utf8"),
);
const EXPECTED_OPERATIONS = new Set([
  "GetEstateSummary",
  "GetServiceStatus",
  "GetReleaseStatus",
  "ListActiveFindings",
  "GetQuotaProjection",
  "GetBackupStatus",
  "ListGardenerProposals",
  "FindRunbook",
  "SearchEvidence",
]);

function makeKV(initial = null) {
  const store = new Map();
  if (initial) store.set("control-plane:read-model:v1", JSON.stringify(initial));
  return {
    store,
    async get(key) {
      return store.get(key) || null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    CONTROL_PLANE_FIXTURES: READ_MODEL,
    RAMONE_CONTROL_PLANE_READ_TOKEN: FIXTURE_TOKEN,
    RL_GENERAL: { limit: async () => ({ success: true }) },
    ATLAS_PUBLIC_KV: makeKV(),
    ...overrides,
  };
}

async function call(path, { env = makeEnv(), token = FIXTURE_TOKEN, method = "GET" } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const request = new Request(`${BASE}${path}`, { method, headers });
  return worker.fetch(request, env, { waitUntil() {} });
}

async function tool(path, options) {
  const response = await call(path, options);
  const body = await response.json();
  return { response, body };
}

test("fixture read model passes bounded public/internal leak validation", () => {
  assert.deepEqual(validateControlPlaneReadModel(READ_MODEL), []);
  const leaked = structuredClone(READ_MODEL);
  leaked.services[0].authorization = "fixture";
  assert.match(validateControlPlaneReadModel(leaked).join(" "), /forbidden response key/);
  const privateHost = structuredClone(READ_MODEL);
  privateHost.services[0].origin = "http://127.0.0.1:8123";
  assert.match(validateControlPlaneReadModel(privateHost).join(" "), /machine-local/);
  const commandLeak = structuredClone(READ_MODEL);
  commandLeak.runbooks[0].command = "fixture command must never be returned";
  assert.match(validateControlPlaneReadModel(commandLeak).join(" "), /forbidden response key/);
  const undeclaredLeak = structuredClone(READ_MODEL);
  undeclaredLeak.services[0].credential = "fixture value";
  assert.match(validateControlPlaneReadModel(undeclaredLeak).join(" "), /undeclared response field/);
  const topLevelLeak = structuredClone(READ_MODEL);
  topLevelLeak.internal_context = "fixture value";
  assert.match(validateControlPlaneReadModel(topLevelLeak).join(" "), /undeclared response field/);
  const unapprovedOrigin = structuredClone(READ_MODEL);
  unapprovedOrigin.evidence[0].reference = "https://internal.example/evidence/1";
  assert.match(validateControlPlaneReadModel(unapprovedOrigin).join(" "), /approved public origin/);
  const unbounded = structuredClone(READ_MODEL);
  unbounded.findings = Array.from({ length: 101 }, () => READ_MODEL.findings[0]);
  assert.match(validateControlPlaneReadModel(unbounded).join(" "), /bounded item limit/);
});

test("public summary is schema-versioned and missing data is unavailable", async () => {
  const present = await call("/v1/control-plane/summary", { token: null });
  assert.equal(present.status, 200);
  assert.equal(
    (await present.json()).schema_version,
    "atlas-control-plane/control-plane-summary/v1",
  );

  const missing = await call("/v1/control-plane/summary", {
    token: null,
    env: makeEnv({ CONTROL_PLANE_FIXTURES: null }),
  });
  assert.equal(missing.status, 503);
  assert.doesNotMatch(JSON.stringify(await missing.json()), /healthy/);
});

test("dedicated OpenAPI requires bearer and exposes exactly nine GET operations", async () => {
  assert.equal((await call("/v1/control-plane/tools/openapi.json", { token: null })).status, 401);
  assert.equal((await call("/v1/control-plane/tools/openapi.json", { token: "wrong" })).status, 401);
  const response = await call("/v1/control-plane/tools/openapi.json");
  assert.equal(response.status, 200);
  const spec = await response.json();
  assert.equal(spec.openapi, "3.1.0");
  const operations = [];
  for (const methods of Object.values(spec.paths)) {
    assert.deepEqual(Object.keys(methods), ["get"]);
    operations.push(methods.get.operationId);
    assert.equal(methods.get.requestBody, undefined);
  }
  assert.equal(operations.length, 9);
  assert.deepEqual(new Set(operations), EXPECTED_OPERATIONS);
  assert.deepEqual(new Set(CONTROL_PLANE_OPERATIONS), EXPECTED_OPERATIONS);
  assert.deepEqual(spec.security, [{ ramoneReadBearer: [] }]);
  assert.equal(spec.components.securitySchemes.ramoneReadBearer.scheme, "bearer");
  assert.match(JSON.stringify(spec), /RAMONE_CONTROL_PLANE_READ_TOKEN/);
  assert.doesNotMatch(JSON.stringify(spec), new RegExp(FIXTURE_TOKEN));
});

test("OpenAPI has no generic URL, shell, provider, body, or write surface", () => {
  const spec = buildControlPlaneToolOpenApi();
  const forbiddenOperation = /deploy|execute|remediate|merge|rotate|restore|delete|shell|ssh|fetch|github|cloudflare|call.?service/i;
  for (const [path, methods] of Object.entries(spec.paths)) {
    assert.ok(path.startsWith("/v1/control-plane/tools/"));
    assert.deepEqual(Object.keys(methods), ["get"]);
    assert.doesNotMatch(methods.get.operationId, forbiddenOperation);
    assert.notEqual(methods.get.operationId, "Run");
    assert.notEqual(methods.get.operationId, "RunCommand");
    for (const parameter of methods.get.parameters || []) {
      assert.notEqual(parameter.name, "url");
      assert.notEqual(parameter.name, "method");
      assert.notEqual(parameter.name, "command");
      assert.notEqual(parameter.in, "header");
    }
  }
});

test("all nine fixture operations route and identify their contract", async () => {
  const routes = [
    ["/v1/control-plane/tools/summary", "GetEstateSummary"],
    ["/v1/control-plane/tools/services/atlas-api-public", "GetServiceStatus"],
    ["/v1/control-plane/tools/releases?repository=atlas-api-public", "GetReleaseStatus"],
    ["/v1/control-plane/tools/findings?severity=warning", "ListActiveFindings"],
    ["/v1/control-plane/tools/quota?meter_id=workers-requests", "GetQuotaProjection"],
    ["/v1/control-plane/tools/backups?target_id=atlas-vault-metadata", "GetBackupStatus"],
    ["/v1/control-plane/tools/gardener/proposals?state=draft_pr", "ListGardenerProposals"],
    ["/v1/control-plane/tools/runbooks/search?query=contract", "FindRunbook"],
    ["/v1/control-plane/tools/evidence/search?query=release", "SearchEvidence"],
  ];
  for (const [path, operationId] of routes) {
    const { response, body } = await tool(path);
    assert.equal(response.status, 200, path);
    assert.equal(body.operation_id, operationId, path);
    assert.equal(body.schema_version, "atlas-control-plane/tool-result/v1");
    assert.ok(body.request_id);
    assert.ok(body.data);
    assert.ok(JSON.stringify(body).length < 16 * 1024);
  }
});

test("active findings, quota, backup, Gardener, and runbook fixtures are usable", async () => {
  const findings = (await tool("/v1/control-plane/tools/findings")).body.data;
  assert.equal(findings.count, 1);
  assert.equal(findings.items[0].severity, "warning");

  const quota = (await tool("/v1/control-plane/tools/quota")).body.data;
  assert.equal(quota.items[0].projected_percent, 88.2);

  const backups = (await tool("/v1/control-plane/tools/backups")).body.data;
  assert.equal(backups.items[0].freshness, "unknown");

  const proposals = (await tool("/v1/control-plane/tools/gardener/proposals")).body.data;
  assert.equal(proposals.items[0].proposal_state, "draft_pr");
  assert.equal(proposals.items[0].files_count, 1);

  const runbooks = (await tool("/v1/control-plane/tools/runbooks/search?query=contract")).body.data;
  assert.equal(runbooks.count, 1);
  assert.equal(runbooks.items[0].runbook_id, "contract-registry-service-triage");
  assert.equal(runbooks.items[0].command, undefined);
});

test("evidence search returns metadata only and never a raw blob", async () => {
  const { body } = await tool(
    "/v1/control-plane/tools/evidence/search?query=release&producer=atlas-journey-watch&limit=1",
  );
  assert.equal(body.data.count, 1);
  const item = body.data.items[0];
  assert.equal(item.evidence_type, "release-verification");
  assert.ok(item.reference.startsWith("https://"));
  assert.equal(item.payload, undefined);
  assert.equal(item.raw_evidence, undefined);
});

test("tool responses contain no credential or machine-private material", async () => {
  const paths = [
    "/v1/control-plane/tools/summary",
    "/v1/control-plane/tools/services/atlas-api-public",
    "/v1/control-plane/tools/findings",
    "/v1/control-plane/tools/backups",
    "/v1/control-plane/tools/runbooks/search?query=contract",
    "/v1/control-plane/tools/evidence/search?query=release",
  ];
  for (const path of paths) {
    const rendered = JSON.stringify((await tool(path)).body);
    for (const forbidden of [
      FIXTURE_TOKEN,
      "authorization",
      "localhost",
      "127.0.0.1",
      "192.168.",
      "/config/",
      "private_key",
      "password",
      "raw_evidence",
      '"payload"',
    ]) {
      assert.ok(!rendered.includes(forbidden), `${path} leaked ${forbidden}`);
    }
  }
});

test("write methods and undeclared passthrough filters fail closed", async () => {
  assert.equal((await call("/v1/control-plane/tools/summary", { method: "POST" })).status, 405);
  assert.equal((await call("/v1/control-plane/summary", { method: "POST", token: null })).status, 405);
  assert.equal((await call("/v1/control-plane/tools/summary?url=https://example.com")).status, 400);
  assert.equal((await call("/v1/control-plane/tools/runbooks/search")).status, 400);
  assert.equal((await call("/v1/control-plane/tools/evidence/search?query=x&limit=21")).status, 400);
  assert.equal((await call("/v1/control-plane/tools/releases?repository=Atlas-Infra")).status, 400);
  assert.equal((await call("/v1/control-plane/tools/services/%E0%A4%A")).status, 400);
});

test("KV read model mode is read-only and deterministic", async () => {
  const kv = makeKV(READ_MODEL);
  const env = makeEnv({ CONTROL_PLANE_FIXTURES: null, ATLAS_PUBLIC_KV: kv });
  const first = await call("/v1/control-plane/tools/quota", { env });
  const firstBody = await first.text();
  const second = await call("/v1/control-plane/tools/quota", { env });
  assert.equal(firstBody, await second.text());
  assert.equal(kv.store.size, 1);
  assert.ok(kv.store.has("control-plane:read-model:v1"));
});

test("expired KV read models become stale instead of remaining healthy", async () => {
  const expired = structuredClone(READ_MODEL);
  expired.summary.generated_at = "2000-01-01T00:00:00Z";
  expired.summary.stale_after = "2000-01-01T00:10:00Z";
  expired.summary.state = "healthy";
  for (const value of Object.values(expired.summary)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "state" in value) {
      value.state = "healthy";
    }
  }
  for (const name of ["services", "releases", "findings", "quota", "backups", "gardener_proposals", "runbooks", "evidence"]) {
    for (const item of expired[name]) item.state = "healthy";
  }
  const env = makeEnv({ CONTROL_PLANE_FIXTURES: null, ATLAS_PUBLIC_KV: makeKV(expired) });
  const summary = await call("/v1/control-plane/summary", { env, token: null });
  assert.equal((await summary.json()).state, "stale");
  const quota = await tool("/v1/control-plane/tools/quota", { env });
  assert.equal(quota.body.state, "stale");
});
