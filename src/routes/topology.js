import manifest from "../../data/estate.manifest.json" with { type: "json" };
import repositoryClassifications from "../../data/public-repository-classifications.json" with { type: "json" };
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
  "deprecated",
  "archived",
  "retired",
]);

const CLASSIFICATION_SCHEMA =
  "atlas-public-repository-classifications/projection/v1";
const CLASSIFICATION_AUTHORITY = "AtlasReaper311/atlas-infra";

function repoName(repo) {
  const match =
    typeof repo === "string"
      ? repo.match(/^https:\/\/github\.com\/AtlasReaper311\/([^/?#]+)$/i)
      : null;

  return match ? match[1] : null;
}

function publicRepositoryNames(inventory) {
  return new Set(
    (inventory.repositories || [])
      .filter((repository) => repository?.visibility === "public")
      .map((repository) => repository.name)
      .filter((name) => typeof name === "string"),
  );
}

function classificationByRepository(source) {
  if (
    source?.schema_version !== CLASSIFICATION_SCHEMA ||
    source?.authority !== CLASSIFICATION_AUTHORITY ||
    !Array.isArray(source.repositories) ||
    source.repository_count !== source.repositories.length
  ) {
    return new Map();
  }

  const entries = new Map();

  for (const classification of source.repositories) {
    const prefix = "AtlasReaper311/";
    const repository = classification?.repository;

    if (
      typeof repository !== "string" ||
      !repository.startsWith(prefix) ||
      entries.has(repository.slice(prefix.length))
    ) {
      return new Map();
    }

    entries.set(repository.slice(prefix.length), classification);
  }

  return entries;
}

function lifecycleBlocked(lifecycle) {
  return BLOCKED_LIFECYCLES.has(String(lifecycle || "").toLowerCase());
}

function visible(component, publicRepos, classifications) {
  if (!component || !ALLOWED_KINDS.has(component.kind)) return false;

  const repositoryName = repoName(component.repo);
  if (repositoryName) {
    if (!publicRepos.has(repositoryName)) return false;

    const classification = classifications.get(repositoryName);
    if (!classification || lifecycleBlocked(classification.lifecycle)) {
      return false;
    }

    return true;
  }

  if (lifecycleBlocked(component.lifecycle)) return false;
  if (component.indexed !== true) return false;

  return true;
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

function normaliseManifestComponent(component, classifications) {
  const repositoryName = repoName(component.repo);
  const classification = repositoryName
    ? classifications.get(repositoryName)
    : null;

  return {
    id: component.name,
    kind: component.kind,
    layer: component.layer || "reusable-kit",
    lifecycle: classification?.lifecycle || component.lifecycle || "production",
    scope: classification?.scope || null,
    provenance: classification?.provenance || null,
    runtime_service: classification?.runtime_service ?? null,
    repo: component.repo,
    repo_name: repositoryName,
    public_surface: component.public_surface || null,
    meta_url: component.meta_url || null,
    health_url: component.health_url || null,
    indexed: component.indexed === true,
    depends_on: Array.isArray(component.depends_on)
      ? component.depends_on.filter((item) => typeof item === "string")
      : [],
    description: component.notes || "",
    language: null,
    topics: [],
    source_only: false,
  };
}

function normaliseRepository(repository, classification) {
  return {
    id: repository.name,
    kind: "repository",
    layer: inferLayer(repository),
    lifecycle: classification.lifecycle,
    scope: classification.scope,
    provenance: classification.provenance,
    runtime_service: classification.runtime_service,
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
  classificationSource = repositoryClassifications,
) {
  const publicRepos = publicRepositoryNames(inventory);
  const classifications = classificationByRepository(classificationSource);
  const manifestComponents = (source.components || [])
    .filter((component) => visible(component, publicRepos, classifications))
    .map((component) => normaliseManifestComponent(component, classifications));

  const representedRepositories = new Set(
    manifestComponents
      .map((component) => component.repo_name)
      .filter(Boolean),
  );

  const repositoryComponents = (inventory.repositories || [])
    .filter((repository) => {
      if (
        !repository ||
        repository.visibility !== "public" ||
        typeof repository.name !== "string" ||
        representedRepositories.has(repository.name)
      ) {
        return false;
      }

      const classification = classifications.get(repository.name);
      return classification && !lifecycleBlocked(classification.lifecycle);
    })
    .map((repository) =>
      normaliseRepository(repository, classifications.get(repository.name)),
    );

  const components = [
    ...manifestComponents,
    ...repositoryComponents,
  ].sort((a, b) => {
    const repoOrder = componentSortKey(a).localeCompare(componentSortKey(b));

    if (repoOrder !== 0) return repoOrder;
    if (a.source_only !== b.source_only) return a.source_only ? 1 : -1;
    return a.id.localeCompare(b.id);
  });

  return {
    schema: "atlas-public-topology/v3",
    owner: source.owner,
    canonical_site: source.canonical_site,
    generated_at: inventory.generated_at || null,
    classification_authority:
      classificationSource?.authority === CLASSIFICATION_AUTHORITY
        ? CLASSIFICATION_AUTHORITY
        : null,
    classification_fingerprint:
      typeof classificationSource?.source_fingerprint === "string"
        ? classificationSource.source_fingerprint
        : null,
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
