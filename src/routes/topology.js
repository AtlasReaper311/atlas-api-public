import manifest from "../../data/estate.manifest.json" with { type: "json" };
import repositoryInventory from "../../data/public-repositories.json" with { type: "json" };
import { json } from "../lib/http.js";

const ALLOWED_KINDS = new Set([
  "worker",
  "site",
  "github-actions",
  "tool",
  "repository",
]);

const BLOCKED_LIFECYCLES = new Set([
  "internal",
  "deprecated",
  "retired",
]);

const BLOCKED_COMPONENTS = new Set([
  "simple-proxy",
]);

function repoName(repo) {
  const match =
    typeof repo === "string"
      ? repo.match(
          /^https:\/\/github\.com\/AtlasReaper311\/([^/?#]+)$/i,
        )
      : null;

  return match ? match[1] : null;
}

function visible(component) {
  if (!component || BLOCKED_COMPONENTS.has(component.name)) {
    return false;
  }

  if (
    BLOCKED_LIFECYCLES.has(
      String(component.lifecycle || "").toLowerCase(),
    )
  ) {
    return false;
  }

  const kindAllowed = ALLOWED_KINDS.has(component.kind);
  const hasPublicRepository = Boolean(repoName(component.repo));
  const isIndexedRuntime = component.indexed === true && kindAllowed;

  // Public source links are preferred, but a deployed/indexed runtime must not
  // disappear from the declared topology merely because its source repository
  // is private. atlas-vault is the canonical example: its runtime contract is
  // public while its repository is intentionally not.
  if (!hasPublicRepository && !isIndexedRuntime) {
    return false;
  }

  return kindAllowed || component.indexed === true;
}

function inferLayer(repository) {
  const haystack = [
    repository.name,
    repository.description,
    ...(repository.topics || []),
  ]
    .join(" ")
    .toLowerCase();

  if (/ramone|ollama|rag|corpus|memory|local.?ai/.test(haystack)) {
    return "local-ai";
  }

  if (/api|worker|cloudflare/.test(haystack)) {
    return "public-api";
  }

  if (/telemetry|specular|sentinel|sonif|edge/.test(haystack)) {
    return "edge";
  }

  if (
    /notify|blackbox|pulse|watch|audit|dora|digest|gardener|observ/.test(
      haystack,
    )
  ) {
    return "observability";
  }

  if (/systems|status|viewer|portfolio|site/.test(haystack)) {
    return "surface";
  }

  if (/infra|bootstrap|deploy|actions|workflow/.test(haystack)) {
    return "infra";
  }

  return "reusable-kit";
}

function normaliseManifestComponent(component) {
  return {
    id: component.name,
    kind: component.kind,
    layer: component.layer || "reusable-kit",
    lifecycle: component.lifecycle || "production",
    repo: component.repo,
    repo_name: repoName(component.repo),
    public_surface: component.public_surface || null,
    meta_url: component.meta_url || null,
    health_url: component.health_url || null,
    indexed: component.indexed === true,
    depends_on: Array.isArray(component.depends_on)
      ? component.depends_on.filter(
          (item) => typeof item === "string",
        )
      : [],
    description: component.notes || "",
    language: null,
    topics: [],
    source_only: false,
  };
}

function normaliseRepository(repository) {
  return {
    id: repository.name,
    kind: "repository",
    layer: inferLayer(repository),
    lifecycle: "production",
    repo: repository.html_url,
    repo_name: repository.name,
    public_surface: repository.homepage || null,
    meta_url: null,
    health_url: null,
    indexed: false,
    depends_on: [],
    description:
      repository.description ||
      "Public Atlas Systems source repository.",
    language: repository.language || null,
    topics: Array.isArray(repository.topics)
      ? repository.topics
      : [],
    source_only: true,
  };
}

function componentSortKey(component) {
  return component.repo_name || component.id;
}

export function buildPublicTopology(
  source = manifest,
  inventory = repositoryInventory,
) {
  const manifestComponents = (source.components || [])
    .filter(visible)
    .map(normaliseManifestComponent);

  const representedRepositories = new Set(
    manifestComponents
      .map((component) => component.repo_name)
      .filter(Boolean),
  );

  const repositoryComponents = (
    inventory.repositories || []
  )
    .filter(
      (repository) =>
        repository &&
        typeof repository.name === "string" &&
        !BLOCKED_COMPONENTS.has(repository.name) &&
        !representedRepositories.has(repository.name),
    )
    .map(normaliseRepository);

  const components = [
    ...manifestComponents,
    ...repositoryComponents,
  ].sort((a, b) => {
    const repoOrder = componentSortKey(a).localeCompare(componentSortKey(b));

    if (repoOrder !== 0) {
      return repoOrder;
    }

    if (a.source_only !== b.source_only) {
      return a.source_only ? 1 : -1;
    }

    return a.id.localeCompare(b.id);
  });

  return {
    schema: "atlas-public-topology/v2",
    owner: source.owner,
    canonical_site: source.canonical_site,
    generated_at: inventory.generated_at || null,
    repository_count: new Set(
      components
        .map((component) => component.repo_name)
        .filter(Boolean),
    ).size,
    component_count: components.length,
    components,
  };
}

export function handleTopology() {
  return json(buildPublicTopology(), 200, {
    "cache-control": "public, max-age=300",
  });
}
