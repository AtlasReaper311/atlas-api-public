import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenApi } from "../src/openapi.js";
import {
  documentedEndpointKeys,
  handleDocs,
} from "../src/routes/docs.js";

test("OpenAPI publishes the topology contract", () => {
  const spec = buildOpenApi();
  const topology = spec.paths["/v1/topology"]?.get;

  assert.ok(topology);
  assert.equal(spec.info.version, "1.3.0");

  const schema =
    topology.responses[200].content["application/json"].schema;

  assert.equal(
    schema.properties.schema.enum[0],
    "atlas-public-topology/v2",
  );

  assert.ok(schema.properties.repository_count);
  assert.ok(schema.properties.component_count);
  assert.ok(schema.properties.components);
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
  assert.ok(html.includes("/v1/evidence"));
  assert.ok(html.includes("version 1.3.0"));
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
