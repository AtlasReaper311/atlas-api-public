import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicTopology } from "../src/routes/topology.js";

test("committed topology resolves known lifecycle drift from Atlas Infra", () => {
  const topology = buildPublicTopology();
  const byId = new Map(
    topology.components.map((component) => [component.id, component]),
  );

  assert.equal(byId.get("atlas-doc-viewer")?.lifecycle, "active");
  assert.equal(byId.get("ramone-memory")?.lifecycle, "active");
  assert.equal(byId.get("atlas-journey-watch")?.lifecycle, "active");
  assert.equal(byId.get("atlas-dep-audit")?.lifecycle, "active");
  assert.equal(byId.get("atlas-badges")?.lifecycle, "active");
});

test("source-only repositories no longer default to production", () => {
  const topology = buildPublicTopology();
  const sourceOnly = topology.components.filter((component) => component.source_only);
  const resourceAudit = sourceOnly.find(
    (component) => component.id === "atlas-resource-audit",
  );

  assert.ok(resourceAudit);
  assert.equal(resourceAudit.lifecycle, "active");
  assert.equal(resourceAudit.scope, "public");
  assert.equal(resourceAudit.provenance, "original");
  assert.equal(resourceAudit.runtime_service, false);
});

test("topology publishes the classification authority fingerprint", () => {
  const topology = buildPublicTopology();

  assert.equal(
    topology.classification_authority,
    "AtlasReaper311/atlas-infra",
  );
  assert.match(topology.classification_fingerprint, /^sha256:[0-9a-f]{64}$/);
});
