import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import projection from "../data/twin-impact-projection.json" with { type: "json" };
import worker from "../src/index.js";
import { META } from "../src/meta.js";
import { buildOpenApi } from "../src/openapi-trace.js";
import {
  handleTwinImpact,
  isValidTwinImpactProjection,
} from "../src/routes/twin-impact.js";

const BASE = "https://api.atlas-systems.uk";

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function canonicalProjectionInput(document) {
  const input = {};
  for (const field of [
    "schema_version",
    "generated_at",
    "subject",
    "impact.conclusion",
    "impact.scope",
    "impact.coverage",
    "impact.relationships",
    "impact.unknowns",
    "analysis",
    "provenance",
    "distribution",
    "privacy",
    "limitations",
  ]) {
    let value = document;
    for (const part of field.split(".")) value = value?.[part];
    if (["impact.relationships", "impact.unknowns", "limitations"].includes(field)) {
      value = [...value].sort((left, right) =>
        JSON.stringify(sortValue(left)) < JSON.stringify(sortValue(right))
          ? -1
          : JSON.stringify(sortValue(left)) > JSON.stringify(sortValue(right))
            ? 1
            : 0,
      );
    }
    input[field] = value;
  }
  return input;
}

function projectionFingerprint(document) {
  const canonical = JSON.stringify(sortValue(canonicalProjectionInput(document)));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function makeEnv() {
  return {
    ATLAS_PUBLIC_KV: { get: async () => null },
  };
}

function makeCtx() {
  return { waitUntil() {} };
}

test("committed Twin projection is valid, fingerprinted, and claim-bounded", () => {
  assert.equal(isValidTwinImpactProjection(projection), true);
  assert.equal(projection.projection_fingerprint, projectionFingerprint(projection));
  assert.equal(projection.subject.visibility, "public");
  assert.equal(projection.impact.conclusion, "could-be-affected");
  assert.equal(projection.impact.scope, "public-only");
  assert.equal(projection.impact.coverage, "known-public-scope");
  assert.deepEqual(projection.impact.unknowns, []);
  assert.equal(projection.provenance.producer_id, "atlas-twin");
  assert.equal(projection.provenance.projection_policy, "ADR-0017");
  assert.doesNotMatch(JSON.stringify(projection), /"AtlasReaper311\/atlas-twin"/);
  assert.doesNotMatch(
    JSON.stringify(projection),
    /"(?:merge|approval|release|publication|deployment|runtime|failure|live)[^"]*"\s*:/i,
  );
});

test("Twin impact handler serves the static contract with public headers", async () => {
  const response = handleTwinImpact();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  assert.deepEqual(await response.json(), projection);
});

test("Twin impact route is reachable and OPTIONS keeps the existing CORS contract", async () => {
  const response = await worker.fetch(
    new Request(`${BASE}/v1/evidence/twin-impact`),
    makeEnv(),
    makeCtx(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), projection);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const options = await worker.fetch(
    new Request(`${BASE}/v1/evidence/twin-impact`, { method: "OPTIONS" }),
    makeEnv(),
    makeCtx(),
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
});

test("existing evidence routes remain routed beside Twin impact", async () => {
  for (const path of [
    "/v1/evidence",
    "/v1/evidence/conformance",
    "/v1/evidence/chaos",
  ]) {
    const response = await worker.fetch(
      new Request(`${BASE}${path}`),
      makeEnv(),
      makeCtx(),
    );
    assert.notEqual(response.status, 404, path);
  }
});

test("invalid static projection fails closed with the existing JSON error shape", async () => {
  const invalid = structuredClone(projection);
  invalid.distribution.route = "/v1/not-twin-impact";
  const response = handleTwinImpact(invalid);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual((await response.json()).ok, false);
});

test("OpenAPI documents the Twin projection and its bounded failure", () => {
  const route = buildOpenApi().paths["/v1/evidence/twin-impact"].get;
  assert.equal(route.summary, "Public Twin impact projection");
  assert.ok(route.responses[200]);
  assert.ok(route.responses[503]);
  assert.match(route.description, /could be affected/i);
  assert.match(route.description, /does not claim merge/i);
});

test("metadata declares the same Twin projection route", () => {
  assert.deepEqual(
    META.endpoints.find((endpoint) => endpoint.path === "/v1/evidence/twin-impact"),
    {
      method: "GET",
      path: "/v1/evidence/twin-impact",
      description: "Static public Twin impact projection",
    },
  );
});
