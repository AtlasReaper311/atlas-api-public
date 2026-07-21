import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicTopology } from "../src/routes/topology.js";

const baseSource = {
  owner: "AtlasReaper311",
  canonical_site: "https://atlas-systems.uk",
  components: [],
};

const emptyInventory = {
  generated_at: "2026-07-20T00:00:00.000Z",
  repositories: [],
};

function classifications(entries = []) {
  return {
    schema_version: "atlas-public-repository-classifications/projection/v1",
    authority: "AtlasReaper311/atlas-infra",
    source_fingerprint: `sha256:${"b".repeat(64)}`,
    repository_count: entries.length,
    repositories: entries,
  };
}

test("explicit repo-less indexed public runtimes remain visible", () => {
  const topology = buildPublicTopology(
    {
      ...baseSource,
      components: [
        {
          name: "public-edge-runtime",
          kind: "worker",
          layer: "edge",
          lifecycle: "production",
          repo: null,
          public_surface: "https://api.atlas-systems.uk/public-edge",
          meta_url: "https://api.atlas-systems.uk/public-edge/_meta",
          health_url: "https://api.atlas-systems.uk/public-edge/health",
          indexed: true,
          depends_on: [],
          notes: "Explicit public runtime without a source repository link.",
        },
      ],
    },
    emptyInventory,
    classifications(),
  );

  assert.deepEqual(
    topology.components.map((component) => component.id),
    ["public-edge-runtime"],
  );

  const runtime = topology.components[0];
  assert.equal(runtime.repo, null);
  assert.equal(runtime.repo_name, null);
  assert.equal(runtime.source_only, false);
  assert.equal(runtime.lifecycle, "production");
  assert.equal(runtime.scope, null);
  assert.equal(runtime.provenance, null);
  assert.equal(topology.repository_count, 0);
});

test("repository-backed components require public repository inventory evidence", () => {
  const topology = buildPublicTopology(
    {
      ...baseSource,
      components: [
        {
          name: "public-api",
          kind: "worker",
          layer: "public-api",
          lifecycle: "production",
          repo: "https://github.com/AtlasReaper311/public-api",
          indexed: true,
          depends_on: [],
        },
      ],
    },
    emptyInventory,
    classifications([
      {
        repository: "AtlasReaper311/public-api",
        lifecycle: "production",
        scope: "public",
        provenance: "original",
        runtime_service: true,
      },
    ]),
  );

  assert.equal(topology.components.length, 0);
});

test("repo-less non-indexed components remain private from public topology", () => {
  const topology = buildPublicTopology(
    {
      ...baseSource,
      components: [
        {
          name: "private-helper",
          kind: "tool",
          layer: "reusable-kit",
          lifecycle: "production",
          repo: null,
          indexed: false,
          depends_on: [],
        },
      ],
    },
    emptyInventory,
    classifications(),
  );

  assert.equal(topology.components.length, 0);
});
