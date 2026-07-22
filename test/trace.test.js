import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicTraceIndex,
  buildPublicTraceService,
} from "../src/routes/trace.js";

const NODE_ID = /^node:sha256:[0-9a-f]{64}$/;
const EDGE_ID = /^edge:sha256:[0-9a-f]{64}$/;

test("Trace index exposes only public runtime services", async () => {
  const index = await buildPublicTraceIndex();
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
  assert.equal(index.live_topology.state, "unavailable");
});

test("one public service returns deterministic source and governance proof", async () => {
  const first = await buildPublicTraceService("atlas-api-public");
  const second = await buildPublicTraceService("atlas-api-public");

  assert.ok(first);
  assert.equal(first.schema, "atlas-public-trace-service/v1");
  assert.equal(first.subject.repository, "AtlasReaper311/atlas-api-public");
  assert.equal(first.live_topology.state, "unavailable");
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
});

test("non-public and unknown service identifiers fail closed", async () => {
  assert.equal(await buildPublicTraceService("atlas-notify"), null);
  assert.equal(await buildPublicTraceService("ramone-trigger"), null);
  assert.equal(await buildPublicTraceService("does-not-exist"), null);
});

test("Trace uses only the bounded Atlas Trace relation vocabulary", async () => {
  const detail = await buildPublicTraceService("atlas-api-index");
  const relations = new Set(detail.graph.edges.map((edge) => edge.relation));

  for (const relation of relations) {
    assert.ok(["SOURCE_OF", "GOVERNED_BY"].includes(relation));
  }
});
