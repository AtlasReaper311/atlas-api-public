import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicTopology } from "../src/routes/topology.js";

function classifications(entries) {
  return {
    schema_version: "atlas-public-repository-classifications/projection/v1",
    authority: "AtlasReaper311/atlas-infra",
    source_fingerprint: `sha256:${"a".repeat(64)}`,
    repository_count: entries.length,
    repositories: entries.map((entry) => ({
      scope: "public",
      provenance: "original",
      runtime_service: false,
      ...entry,
    })),
  };
}

const baseManifest = {
  owner: "AtlasReaper311",
  canonical_site: "https://atlas-systems.uk",
  components: [
    {
      name: "atlas-api-public",
      kind: "worker",
      layer: "public-api",
      lifecycle: "experimental",
      repo: "https://github.com/AtlasReaper311/atlas-api-public",
      indexed: true,
      notes: "Public API",
    },
  ],
};

const baseClassifications = classifications([
  {
    repository: "AtlasReaper311/atlas-api-public",
    lifecycle: "production",
    runtime_service: true,
  },
]);

test("topology uses Atlas Infra classification for manifest-backed repositories", () => {
  const topology = buildPublicTopology(
    baseManifest,
    {
      generated_at: "2026-07-15T00:00:00Z",
      repositories: [
        {
          name: "atlas-api-public",
          html_url: "https://github.com/AtlasReaper311/atlas-api-public",
          visibility: "public",
        },
      ],
    },
    baseClassifications,
  );

  assert.equal(topology.repository_count, 1);
  assert.equal(topology.components.length, 1);
  assert.equal(topology.components[0].kind, "worker");
  assert.equal(topology.components[0].source_only, false);
  assert.equal(topology.components[0].lifecycle, "production");
  assert.equal(topology.components[0].scope, "public");
  assert.equal(topology.components[0].runtime_service, true);
  assert.equal(
    topology.classification_authority,
    "AtlasReaper311/atlas-infra",
  );
  assert.equal(
    topology.classification_fingerprint,
    baseClassifications.source_fingerprint,
  );
});

test("topology adds public repositories absent from the manifest with authoritative lifecycle", () => {
  const classificationSource = classifications([
    ...baseClassifications.repositories,
    {
      repository: "AtlasReaper311/atlas-resource-audit",
      lifecycle: "active",
      scope: "public",
      provenance: "original",
      runtime_service: false,
    },
  ]);
  const topology = buildPublicTopology(
    baseManifest,
    {
      generated_at: "2026-07-15T00:00:00Z",
      repositories: [
        {
          name: "atlas-api-public",
          html_url: "https://github.com/AtlasReaper311/atlas-api-public",
          visibility: "public",
        },
        {
          name: "atlas-resource-audit",
          html_url: "https://github.com/AtlasReaper311/atlas-resource-audit",
          description: "Estate resource audit",
          language: "Python",
          topics: ["audit", "github-actions"],
          visibility: "public",
        },
      ],
    },
    classificationSource,
  );

  const added = topology.components.find(
    (component) => component.id === "atlas-resource-audit",
  );

  assert.ok(added);
  assert.equal(added.kind, "repository");
  assert.equal(added.source_only, true);
  assert.equal(added.layer, "observability");
  assert.equal(added.lifecycle, "active");
  assert.equal(topology.repository_count, 2);
});

test("topology fails closed when a public inventory repository lacks authoritative classification", () => {
  const topology = buildPublicTopology(
    baseManifest,
    {
      generated_at: "2026-07-15T00:00:00Z",
      repositories: [
        {
          name: "unclassified-public-service",
          html_url:
            "https://github.com/AtlasReaper311/unclassified-public-service",
          visibility: "public",
        },
      ],
    },
    baseClassifications,
  );

  assert.equal(topology.components.length, 0);
  assert.equal(topology.repository_count, 0);
});

test("topology excludes deprecated and archived repository classifications", () => {
  const manifest = {
    ...baseManifest,
    components: [
      {
        ...baseManifest.components[0],
        name: "deprecated-service",
        repo: "https://github.com/AtlasReaper311/deprecated-service",
      },
    ],
  };
  const inventory = {
    generated_at: "2026-07-15T00:00:00Z",
    repositories: [
      {
        name: "deprecated-service",
        html_url: "https://github.com/AtlasReaper311/deprecated-service",
        visibility: "public",
      },
    ],
  };
  const topology = buildPublicTopology(
    manifest,
    inventory,
    classifications([
      {
        repository: "AtlasReaper311/deprecated-service",
        lifecycle: "deprecated",
      },
    ]),
  );

  assert.equal(topology.components.length, 0);
});
