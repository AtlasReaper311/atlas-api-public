import manifest from "../../data/estate.manifest.json" with { type: "json" };
import { json } from "../lib/http.js";

const ALLOWED_KINDS = new Set(["worker", "site", "github-actions", "tool"]);
const BLOCKED_LIFECYCLES = new Set(["internal", "deprecated", "retired"]);
const BLOCKED_COMPONENTS = new Set(["simple-proxy"]);

function repoName(repo) {
  const match = typeof repo === "string" ? repo.match(/^https:\/\/github\.com\/AtlasReaper311\/([^/?#]+)$/i) : null;
  return match ? match[1] : null;
}

function visible(component) {
  if (!component || BLOCKED_COMPONENTS.has(component.name)) return false;
  if (BLOCKED_LIFECYCLES.has(String(component.lifecycle || "").toLowerCase())) return false;
  if (!repoName(component.repo)) return false;
  return ALLOWED_KINDS.has(component.kind) || component.indexed === true;
}

export function buildPublicTopology(source = manifest) {
  return {
    schema: "atlas-public-topology/v1",
    owner: source.owner,
    canonical_site: source.canonical_site,
    components: (source.components || []).filter(visible).map((component) => ({
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
      depends_on: Array.isArray(component.depends_on) ? component.depends_on.filter((item) => typeof item === "string") : [],
      description: component.notes || "",
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function handleTopology() {
  return json(buildPublicTopology(), 200, { "cache-control": "public, max-age=300" });
}
