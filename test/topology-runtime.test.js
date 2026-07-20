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

test("indexed runtime components remain visible without a public repository", () => {
  const topology = buildPublicTopology(
    {
      ...baseSource,
      components: [
        {
          name: "atlas-vault",
          kind: "worker",
          layer: "storage",
          lifecycle: "production",
          repo: null,
          public_surface: "controlled Worker endpoint",
          meta_url: "https://api.atlas-systems.uk/vault/_meta",
          health_url: "https://api.atlas-systems.uk/vault/health",
          indexed: true,
          depends_on: [],
          notes: "Private source, public runtime contract.",
        },
        {
          name: "atlas-api-public",
          kind: "worker",
          layer: "public-api",
          lifecycle: "production",
          repo: "https://github.com/AtlasReaper311/atlas-api-public",
          public_surface: "https://api.atlas-systems.uk/v1",
          meta_url: "https://api.atlas-systems.uk/v1/_meta",
          health_url: "https://api.atlas-systems.uk/v1",
          indexed: true,
          depends_on: [],
          notes: "Public source and runtime.",
        },
      ],
    },
    emptyInventory,
  );

  assert.deepEqual(
    topology.components.map((component) => component.id).sort(),
    ["atlas-api-public", "atlas-vault"],
  );

  const vault = topology.components.find((component) => component.id === "atlas-vault");
  assert.equal(vault.repo, null);
  assert.equal(vault.repo_name, null);
  assert.equal(vault.source_only, false);
  assert.equal(topology.repository_count, 1);
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
  );

  assert.equal(topology.components.length, 0);
});
