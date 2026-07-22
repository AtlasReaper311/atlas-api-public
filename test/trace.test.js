import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicTraceIndex,
  buildPublicTraceService,
} from "../src/routes/trace.js";

const NODE_ID = /^node:sha256:[0-9a-f]{64}$/;
const EDGE_ID = /^edge:sha256:[0-9a-f]{64}$/;
const REPORT_DIGEST =
  "sha256:032da61fe3a202ac29eb981210bcafed59d08de59b96f0b2bfcb7e5b4b511541";
const EVIDENCE_NOW = Date.parse("2026-07-22T11:00:00Z");

test("Trace index exposes only public runtime services", async () => {
  const index = await buildPublicTraceIndex({ nowMs: EVIDENCE_NOW });
  const ids = index.services.map((service) => service.service_id);

  assert.equal(index.schema, "atlas-public-trace-index/v1");
  assert.equal(index.authority, "AtlasReaper311/atlas-infra");
  assert.match(index.classification_fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.ok(ids.includes("atlas-api-public"));
  assert.ok(ids.includes("atlas-api-index"));
  assert.ok(ids.includes("specular-edge"));
  assert.ok(!ids.includes("atlas-notify"));
  assert.ok(!ids.includes("ramone-trigger"));
  assert.ok(!ids.includes("deploy-watch"));
  assert.equal(index.service_count, ids.length);
  assert.equal(index.live_topology.state, "healthy");
  assert.equal(index.live_topology.report_fingerprint, REPORT_DIGEST);
  assert.equal(index.live_topology.component_count, ids.length);
  assert.equal(index.live_topology.public_summary.failed, 0);
  assert.equal(index.live_topology.public_summary.unavailable, 0);
});

test("one public service returns deterministic source and governance proof", async () => {
  const first = await buildPublicTraceService("atlas-api-public", {
    nowMs: EVIDENCE_NOW,
  });
  const second = await buildPublicTraceService("atlas-api-public", {
    nowMs: EVIDENCE_NOW,
  });

  assert.ok(first);
  assert.equal(first.schema, "atlas-public-trace-service/v1");
  assert.equal(first.subject.repository, "AtlasReaper311/atlas-api-public");
  assert.equal(first.live_topology.state, "healthy");
  assert.equal(first.live_topology.provider_kind, "worker");
  assert.equal(first.live_topology.metadata.name, "atlas-api-public");
  assert.equal(first.live_topology.metadata.version, "1.3.0");
  assert.equal(first.live_topology.report_fingerprint, REPORT_DIGEST);
  assert.deepEqual(
    first.graph.nodes.map((node) => node.node_id),
    second.graph.nodes.map((node) => node.node_id),
  );
  assert.deepEqual(
    first.graph.edges.map((edge) => edge.edge_id),
    second.graph.edges.map((edge) => edge.edge_id),
  );
  assert.ok(first.graph.nodes.every((node) => NODE_ID.test(node.node_id)));
  assert.ok(first.graph.edges.every((edge) => EDGE_ID.test(edge.edge_id)));
  assert.ok(
    first.graph.edges.some((edge) => edge.relation === "SOURCE_OF"),
  );
  assert.ok(
    first.graph.edges.some((edge) => edge.relation === "GOVERNED_BY"),
  );
  assert.ok(
    first.graph.nodes.some(
      (node) =>
        node.kind === "adr" && node.identity.external_id === "ADR-0002",
    ),
  );
  assert.ok(
    first.graph.nodes.some(
      (node) =>
        node.kind === "adr" && node.identity.external_id === "ADR-0003",
    ),
  );
  assert.ok(
    first.graph.nodes.some(
      (node) =>
        node.kind === "adr" && node.identity.external_id === "ADR-0004",
    ),
  );

  const serviceNode = first.graph.nodes.find(
    (node) => node.kind === "service",
  );
  assert.ok(
    serviceNode.evidence.some(
      (item) =>
        item.evidence_type === "live-provider-topology" &&
        item.digest === REPORT_DIGEST,
    ),
  );
});

test("public Pages services receive bounded live evidence", async () => {
  const detail = await buildPublicTraceService("atlas-systems", {
    nowMs: EVIDENCE_NOW,
  });

  assert.ok(detail);
  assert.equal(detail.live_topology.state, "healthy");
  assert.equal(detail.live_topology.provider_kind, "pages-project");
  assert.equal(detail.live_topology.metadata, null);
});

test("non-public and unknown service identifiers fail closed", async () => {
  assert.equal(
    await buildPublicTraceService("atlas-notify", { nowMs: EVIDENCE_NOW }),
    null,
  );
  assert.equal(
    await buildPublicTraceService("ramone-trigger", { nowMs: EVIDENCE_NOW }),
    null,
  );
  assert.equal(
    await buildPublicTraceService("does-not-exist", {
      nowMs: EVIDENCE_NOW,
    }),
    null,
  );
});

test("Trace uses only the bounded Atlas Trace relation vocabulary", async () => {
  const detail = await buildPublicTraceService("atlas-api-index", {
    nowMs: EVIDENCE_NOW,
  });
  const relations = new Set(detail.graph.edges.map((edge) => edge.relation));

  for (const relation of relations) {
    assert.ok(["SOURCE_OF", "GOVERNED_BY"].includes(relation));
  }
});
