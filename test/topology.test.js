import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicTopology } from "../src/routes/topology.js";

const baseManifest = {
  owner: "AtlasReaper311",
  canonical_site: "https://atlas-systems.uk",
  components: [
    {
      name: "atlas-api-public",
      kind: "worker",
      layer: "public-api",
      lifecycle: "production",
      repo: "https://github.com/AtlasReaper311/atlas-api-public",
      indexed: true,
      notes: "Public API",
    },
  ],
};

test("topology preserves rich manifest components", () => {
  const topology = buildPublicTopology(baseManifest, {
    generated_at: "2026-07-15T00:00:00Z",
    repositories: [
      {
        name: "atlas-api-public",
        html_url:
          "https://github.com/AtlasReaper311/atlas-api-public",
      },
    ],
  });

  assert.equal(topology.repository_count, 1);
  assert.equal(topology.components.length, 1);
  assert.equal(topology.components[0].kind, "worker");
  assert.equal(topology.components[0].source_only, false);
});

test("topology adds public repositories absent from the manifest", () => {
  const topology = buildPublicTopology(baseManifest, {
    generated_at: "2026-07-15T00:00:00Z",
    repositories: [
      {
        name: "atlas-api-public",
        html_url:
          "https://github.com/AtlasReaper311/atlas-api-public",
      },
      {
        name: "atlas-resource-audit",
        html_url:
          "https://github.com/AtlasReaper311/atlas-resource-audit",
        description: "Estate resource audit",
        language: "Python",
        topics: ["audit", "github-actions"],
      },
    ],
  });

  const added = topology.components.find(
    (component) => component.id === "atlas-resource-audit",
  );

  assert.ok(added);
  assert.equal(added.kind, "repository");
  assert.equal(added.source_only, true);
  assert.equal(added.layer, "observability");
  assert.equal(topology.repository_count, 2);
});

test("topology never exposes blocked repositories", () => {
  const topology = buildPublicTopology(baseManifest, {
    generated_at: "2026-07-15T00:00:00Z",
    repositories: [
      {
        name: "simple-proxy",
        html_url:
          "https://github.com/AtlasReaper311/simple-proxy",
      },
    ],
  });

  assert.equal(
    topology.components.some(
      (component) => component.id === "simple-proxy",
    ),
    false,
  );
});
