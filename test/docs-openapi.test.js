import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApi } from "../src/openapi-trace.js";
import {
  documentedEndpointKeys,
  handleDocs,
} from "../src/routes/docs.js";

test("OpenAPI publishes the current topology and Trace contracts", () => {
  const spec = buildOpenApi();
  const topology = spec.paths["/v1/topology"]?.get;
  const traceIndex = spec.paths["/v1/trace"]?.get;
  const traceService = spec.paths["/v1/trace/services/{service_id}"]?.get;

  assert.ok(topology);
  assert.ok(traceIndex);
  assert.ok(traceService);
  assert.equal(spec.info.version, "1.4.0");

  const schema =
    topology.responses[200].content["application/json"].schema;

  assert.equal(
    schema.properties.schema.enum[0],
    "atlas-public-topology/v3",
  );

  assert.ok(schema.properties.repository_count);
  assert.ok(schema.properties.component_count);
  assert.ok(schema.properties.components);

  const serviceParameter = traceService.parameters.find(
    (parameter) => parameter.name === "service_id",
  );
  assert.ok(serviceParameter);
  assert.equal(serviceParameter.required, true);
  assert.equal(
    serviceParameter.schema.pattern,
    "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  );
});

test("OpenAPI describes live and fail-closed topology evidence", () => {
  const spec = buildOpenApi();
  const traceIndex = spec.paths["/v1/trace"].get;
  const traceService = spec.paths["/v1/trace/services/{service_id}"].get;
  const indexTopology =
    traceIndex.responses[200].content["application/json"].schema.properties
      .live_topology;
  const serviceTopology =
    traceService.responses[200].content["application/json"].schema.properties
      .live_topology;

  assert.deepEqual(indexTopology.required, ["state", "producer"]);
  assert.deepEqual(indexTopology.properties.state.enum, [
    "healthy",
    "failed",
    "unavailable",
    "warning",
  ]);
  assert.ok(indexTopology.properties.observed_at);
  assert.ok(indexTopology.properties.report_fingerprint);
  assert.ok(indexTopology.properties.evidence_uri);
  assert.ok(indexTopology.properties.privacy);
  assert.ok(indexTopology.properties.component_count);
  assert.ok(indexTopology.properties.public_summary);
  assert.ok(indexTopology.properties.reason);
  assert.ok(!indexTopology.required.includes("reason"));

  assert.deepEqual(serviceTopology, indexTopology);
  assert.ok(serviceTopology.properties.provider_kind);
  assert.ok(serviceTopology.properties.metadata);

  assert.doesNotMatch(
    traceIndex.description,
    /remains explicitly unavailable/i,
  );
  assert.match(
    traceIndex.description,
    /sanitized atlas-resource-audit evidence/i,
  );
});

test("human docs derive their endpoint catalogue from OpenAPI", async () => {
  const spec = buildOpenApi();
  const expected = Object.entries(spec.paths)
    .flatMap(([path, pathItem]) =>
      ["get", "post", "put", "patch", "delete"]
        .filter((method) => pathItem?.[method])
        .map((method) => `${method.toUpperCase()} ${path}`),
    )
    .filter(
      (key) =>
        key !== "GET /v1" &&
        key !== "GET /v1/docs",
    );

  assert.deepEqual(
    documentedEndpointKeys(spec),
    expected,
  );

  const response = handleDocs();
  const html = await response.text();

  for (const key of expected) {
    const [method, path] = key.split(" ");
    assert.match(html, new RegExp(`>${method}<`));
    assert.ok(html.includes(`>${path}<`));
  }

  assert.ok(html.includes("/v1/topology"));
  assert.ok(html.includes("/v1/trace"));
  assert.ok(html.includes("/v1/trace/services/{service_id}"));
  assert.ok(html.includes("/v1/evidence"));
  assert.ok(html.includes("version 1.4.0"));
});

test("human docs contain no parallel hard-coded endpoint array", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/routes/docs.js", import.meta.url),
      "utf8",
    ),
  );

  assert.doesNotMatch(source, /const ENDPOINTS\s*=/);
  assert.match(source, /buildOpenApi\(\)/);
});
