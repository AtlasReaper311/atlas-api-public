import assert from "node:assert/strict";
import test from "node:test";

import topologyEvidence from "../data/public-topology-evidence.json" with { type: "json" };
import { evaluateTopologyEvidence } from "../src/lib/topology-evidence.js";

const PUBLIC_SERVICES = topologyEvidence.components.map((component) => ({
  id: component.service_id,
  kind: component.provider_kind === "pages-project" ? "site" : "worker",
}));

const EVIDENCE_NOW = Date.parse("2026-07-22T11:00:00Z");

function clone(value) {
  return structuredClone(value);
}

test("public topology evidence is healthy and fingerprinted", () => {
  const result = evaluateTopologyEvidence(
    topologyEvidence,
    PUBLIC_SERVICES,
    { nowMs: EVIDENCE_NOW },
  );

  assert.equal(result.state, "healthy");
  assert.equal(result.component_count, 12);
  assert.equal(
    result.report_fingerprint,
    "sha256:032da61fe3a202ac29eb981210bcafed59d08de59b96f0b2bfcb7e5b4b511541",
  );
  assert.equal(result.privacy.undeclared_identities_redacted, true);
  assert.equal(result.privacy.redacted_undeclared_observations, 6);
});

test("service evidence retains only bounded public fields", () => {
  const result = evaluateTopologyEvidence(
    topologyEvidence,
    PUBLIC_SERVICES,
    {
      serviceId: "atlas-api-public",
      nowMs: EVIDENCE_NOW,
    },
  );

  assert.equal(result.state, "healthy");
  assert.equal(result.provider_kind, "worker");
  assert.deepEqual(result.metadata, {
    name: "atlas-api-public",
    state: "observed",
    status: "live",
    version: "1.3.0",
  });
});

test("the committed projection excludes internal service identities", () => {
  const serialized = JSON.stringify(topologyEvidence);

  for (const privateIdentity of [
    "atlas-daily-digest",
    "atlas-notify",
    "deploy-watch",
    "ramone-edge",
    "ramone-trigger",
  ]) {
    assert.ok(!serialized.includes(privateIdentity));
  }
});

test("invalid schemas fail to unavailable", () => {
  const invalid = clone(topologyEvidence);
  invalid.schema_version = "atlas-public-topology-evidence/projection/v999";

  const result = evaluateTopologyEvidence(invalid, PUBLIC_SERVICES, {
    nowMs: EVIDENCE_NOW,
  });

  assert.equal(result.state, "unavailable");
  assert.match(result.reason, /failed validation/);
});

test("privacy assertion failure is never published as healthy", () => {
  const invalid = clone(topologyEvidence);
  invalid.privacy.undeclared_identities_redacted = false;

  const result = evaluateTopologyEvidence(invalid, PUBLIC_SERVICES, {
    nowMs: EVIDENCE_NOW,
  });

  assert.equal(result.state, "unavailable");
});

test("unknown projected services invalidate the entire projection", () => {
  const invalid = clone(topologyEvidence);
  invalid.components.push({
    metadata: null,
    provider_kind: "pages-project",
    service_id: "private-surface",
    state: "healthy",
  });
  invalid.component_count += 1;
  invalid.public_summary.healthy += 1;

  const result = evaluateTopologyEvidence(invalid, PUBLIC_SERVICES, {
    nowMs: EVIDENCE_NOW,
  });

  assert.equal(result.state, "unavailable");
});

test("failed evidence is represented exactly", () => {
  const failed = clone(topologyEvidence);
  const component = failed.components.find(
    (item) => item.service_id === "atlas-api-public",
  );
  component.state = "failed";
  failed.public_summary.healthy -= 1;
  failed.public_summary.failed += 1;
  failed.status = "failed";

  const result = evaluateTopologyEvidence(failed, PUBLIC_SERVICES, {
    serviceId: "atlas-api-public",
    nowMs: EVIDENCE_NOW,
  });

  assert.equal(result.state, "failed");
});

test("evidence older than 30 days fails closed", () => {
  const result = evaluateTopologyEvidence(
    topologyEvidence,
    PUBLIC_SERVICES,
    {
      nowMs: Date.parse("2026-08-22T10:29:14Z"),
    },
  );

  assert.equal(result.state, "unavailable");
  assert.match(result.reason, /older than the 30-day/);
});
