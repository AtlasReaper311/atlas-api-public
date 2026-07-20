import assert from "node:assert/strict";
import test from "node:test";

import { publicRegistryWorkers } from "../src/routes/registry.js";
import { buildPublicTopology } from "../src/routes/topology.js";

test("registry drops undeclared Workers", () => {
  const workers = publicRegistryWorkers([
    { name: "atlas-api-public", documented: true, meta: { endpoints: [] } },
    { name: "owner-private-service", documented: true, meta: { endpoints: [{ method: "GET", path: "/secret" }] } },
  ]);

  assert.deepEqual(workers.map((worker) => worker.name), ["atlas-api-public"]);
});

test("topology drops components whose source repository is not public", () => {
  const source = {
    owner: "AtlasReaper311",
    canonical_site: "https://atlas-systems.uk",
    components: [
      {
        name: "public-service",
        kind: "worker",
        lifecycle: "production",
        repo: "https://github.com/AtlasReaper311/public-service",
        indexed: true,
      },
      {
        name: "private-service",
        kind: "worker",
        lifecycle: "production",
        repo: "https://github.com/AtlasReaper311/private-service",
        indexed: true,
      },
    ],
  };
  const inventory = {
    generated_at: "2026-07-20T00:00:00Z",
    repositories: [
      {
        name: "public-service",
        html_url: "https://github.com/AtlasReaper311/public-service",
        visibility: "public",
        topics: [],
      },
    ],
  };

  const topology = buildPublicTopology(source, inventory);
  assert.deepEqual(topology.components.map((component) => component.id), ["public-service"]);
});
