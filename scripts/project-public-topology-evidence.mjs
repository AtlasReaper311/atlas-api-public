import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPORT_SCHEMA = "atlas-resource-audit/topology-report/v1";
const PROJECTION_SCHEMA = "atlas-public-topology-evidence/projection/v1";
const AUTHORITY = "AtlasReaper311/atlas-resource-audit";
const PRODUCER_WORKFLOW = ".github/workflows/topology-audit.yml";
const VALID_COMPONENT_STATES = new Set([
  "healthy",
  "failed",
  "unavailable",
  "warning",
]);
const BLOCKED_LIFECYCLES = new Set([
  "deprecated",
  "archived",
  "retired",
]);

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function load(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIsoUtc(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function repositoryName(repoUrl) {
  const match =
    typeof repoUrl === "string"
      ? repoUrl.match(/^https:\/\/github\.com\/AtlasReaper311\/([^/?#]+)$/i)
      : null;
  return match ? match[1] : null;
}

function validateReport(report) {
  assert(report?.schema_version === REPORT_SCHEMA, "unsupported topology report schema");
  assert(
    ["healthy", "failed", "unavailable"].includes(report.status),
    "topology report status is invalid",
  );
  assert(isIsoUtc(report.observed_at), "topology report observed_at is invalid");

  const privacy = report.privacy;
  assert(privacy && typeof privacy === "object", "topology report privacy block is missing");
  assert(
    privacy.model ===
      "declared-public-identities-plus-aggregate-undeclared-counts",
    "topology report privacy model is invalid",
  );
  for (const field of [
    "undeclared_identities_redacted",
    "unexpected_binding_identities_redacted",
    "unexpected_route_identities_redacted",
  ]) {
    assert(privacy[field] === true, `topology report privacy assertion ${field} failed`);
  }

  assert(Array.isArray(report.workers), "topology report workers must be an array");
  assert(
    Array.isArray(report.pages_projects),
    "topology report pages_projects must be an array",
  );
  assert(Array.isArray(report.findings), "topology report findings must be an array");

  const summary = report.summary;
  assert(summary && typeof summary === "object", "topology report summary is missing");
  for (const field of [
    "declared_pages_projects",
    "declared_workers",
    "error_findings",
    "informational_findings",
    "redacted_undeclared_observations",
    "warning_findings",
  ]) {
    assert(
      isNonNegativeInteger(summary[field]),
      `topology report summary field ${field} is invalid`,
    );
  }
  assert(
    summary.declared_workers === report.workers.length,
    "topology report worker count is inconsistent",
  );
  assert(
    summary.declared_pages_projects === report.pages_projects.length,
    "topology report Pages count is inconsistent",
  );

  const severityCounts = { error: 0, info: 0, warning: 0 };
  for (const finding of report.findings) {
    assert(finding && typeof finding === "object", "topology finding is invalid");
    assert(
      Object.hasOwn(severityCounts, finding.severity),
      "topology finding severity is invalid",
    );
    severityCounts[finding.severity] += 1;
  }
  assert(
    severityCounts.error === summary.error_findings &&
      severityCounts.info === summary.informational_findings &&
      severityCounts.warning === summary.warning_findings,
    "topology finding counts are inconsistent",
  );

  const workerIds = new Set();
  for (const worker of report.workers) {
    assert(worker && typeof worker === "object", "topology worker entry is invalid");
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(worker.service_id || "")),
      "topology worker service_id is invalid",
    );
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(worker.script_name || "")),
      "topology worker script_name is invalid",
    );
    assert(
      VALID_COMPONENT_STATES.has(worker.state),
      `topology worker ${worker.service_id} state is invalid`,
    );
    assert(
      !workerIds.has(worker.service_id),
      `duplicate topology worker ${worker.service_id}`,
    );
    workerIds.add(worker.service_id);

    const metadata = worker.metadata;
    assert(metadata && typeof metadata === "object", "topology worker metadata is missing");
    assert(
      ["observed", "unavailable", "not-observed"].includes(metadata.state),
      `topology worker ${worker.service_id} metadata state is invalid`,
    );
    if (metadata.state === "observed") {
      assert(
        metadata.name === worker.service_id,
        `topology worker ${worker.service_id} metadata identity differs`,
      );
      for (const field of ["name", "status", "version"]) {
        assert(
          typeof metadata[field] === "string" && metadata[field].length <= 160,
          `topology worker ${worker.service_id} metadata ${field} is invalid`,
        );
      }
    }
  }

  const pageIds = new Set();
  for (const project of report.pages_projects) {
    assert(project && typeof project === "object", "topology Pages entry is invalid");
    assert(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(project.project_name || "")),
      "topology Pages project_name is invalid",
    );
    assert(
      VALID_COMPONENT_STATES.has(project.state),
      `topology Pages project ${project.project_name} state is invalid`,
    );
    assert(
      !pageIds.has(project.project_name),
      `duplicate topology Pages project ${project.project_name}`,
    );
    pageIds.add(project.project_name);
  }
}

function classificationMap(document) {
  assert(
    document?.schema_version ===
      "atlas-public-repository-classifications/projection/v1",
    "unsupported repository classification schema",
  );
  assert(
    document?.authority === "AtlasReaper311/atlas-infra",
    "repository classification authority is invalid",
  );
  assert(
    Array.isArray(document.repositories) &&
      document.repository_count === document.repositories.length,
    "repository classifications are incomplete",
  );

  const entries = new Map();
  for (const item of document.repositories) {
    const repository = item?.repository;
    assert(
      typeof repository === "string" &&
        /^AtlasReaper311\/[A-Za-z0-9._-]+$/.test(repository),
      "repository classification identity is invalid",
    );
    assert(!entries.has(repository), `duplicate repository classification ${repository}`);
    entries.set(repository, item);
  }
  return entries;
}

function safeWorkerMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const result = {};
  for (const field of ["name", "state", "status", "version"]) {
    const value = metadata[field];
    if (typeof value === "string" && value.length <= 160) result[field] = value;
  }
  return result;
}

function publicComponents(report, manifest, classifications) {
  assert(manifest?.schema === "atlas-estate-manifest/v2", "unsupported estate manifest");
  assert(Array.isArray(manifest.components), "estate manifest components are missing");

  const workers = new Map(
    report.workers.map((worker) => [worker.service_id, worker]),
  );
  const pages = new Map(
    report.pages_projects.map((project) => [project.project_name, project]),
  );
  const entries = [];

  for (const component of manifest.components) {
    if (!component || !["worker", "site"].includes(component.kind)) continue;

    const repo = repositoryName(component.repo);
    if (!repo) continue;

    const classification = classifications.get(`AtlasReaper311/${repo}`);
    if (
      !classification ||
      classification.scope !== "public" ||
      classification.runtime_service !== true ||
      BLOCKED_LIFECYCLES.has(String(classification.lifecycle || "").toLowerCase())
    ) {
      continue;
    }

    if (component.kind === "worker") {
      const worker = workers.get(component.name);
      assert(
        worker,
        `public Worker ${component.name} is missing from sanitized topology evidence`,
      );
      entries.push({
        metadata: safeWorkerMetadata(worker.metadata),
        provider_kind: "worker",
        service_id: component.name,
        state: worker.state,
      });
      continue;
    }

    const project = pages.get(component.name);
    assert(
      project,
      `public Pages project ${component.name} is missing from sanitized topology evidence`,
    );
    entries.push({
      metadata: null,
      provider_kind: "pages-project",
      service_id: component.name,
      state: project.state,
    });
  }

  entries.sort((left, right) => left.service_id.localeCompare(right.service_id));
  const ids = new Set(entries.map((entry) => entry.service_id));
  assert(ids.size === entries.length, "public topology projection has duplicate services");
  return entries;
}

function publicStatus(components) {
  if (components.some((component) => component.state === "failed")) return "failed";
  if (components.some((component) => component.state === "unavailable")) {
    return "unavailable";
  }
  return "healthy";
}

function buildProjection(reportPath, manifestPath, classificationsPath) {
  const report = load(reportPath);
  validateReport(report);
  const manifest = load(manifestPath);
  const classifications = classificationMap(load(classificationsPath));
  const components = publicComponents(report, manifest, classifications);

  const counts = {
    failed: 0,
    healthy: 0,
    unavailable: 0,
    warning: 0,
  };
  for (const component of components) counts[component.state] += 1;

  const evidencePath = path
    .relative(process.cwd(), path.resolve(reportPath))
    .split(path.sep)
    .join("/");
  assert(
    evidencePath.startsWith("evidence/topology/") &&
      !evidencePath.includes(".."),
    "topology evidence source must live under evidence/topology",
  );

  return {
    authority: AUTHORITY,
    component_count: components.length,
    components,
    privacy: {
      model: report.privacy.model,
      redacted_undeclared_observations:
        report.summary.redacted_undeclared_observations,
      undeclared_identities_redacted:
        report.privacy.undeclared_identities_redacted,
      unexpected_binding_identities_redacted:
        report.privacy.unexpected_binding_identities_redacted,
      unexpected_route_identities_redacted:
        report.privacy.unexpected_route_identities_redacted,
    },
    public_summary: counts,
    schema_version: PROJECTION_SCHEMA,
    source: {
      evidence_path: evidencePath,
      fingerprint: `sha256:${sha256(report)}`,
      observed_at: report.observed_at,
      producer_repository: "AtlasReaper311/atlas-resource-audit",
      producer_workflow: PRODUCER_WORKFLOW,
      schema_version: report.schema_version,
    },
    status: publicStatus(components),
  };
}

const [mode, reportPath, manifestPath, classificationsPath, projectionPath] =
  process.argv.slice(2);

if (
  !["--check", "--write"].includes(mode) ||
  !reportPath ||
  !manifestPath ||
  !classificationsPath ||
  !projectionPath
) {
  throw new Error(
    "usage: node scripts/project-public-topology-evidence.mjs <--check|--write> <report> <manifest> <classifications> <projection>",
  );
}

const expected = buildProjection(
  reportPath,
  manifestPath,
  classificationsPath,
);

if (mode === "--write") {
  fs.writeFileSync(
    projectionPath,
    `${JSON.stringify(sortValue(expected), null, 2)}\n`,
    "utf8",
  );
  console.log(`wrote ${projectionPath}`);
} else {
  const actual = load(projectionPath);
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      `${projectionPath} does not match the sanitized topology evidence source`,
    );
  }
  console.log("public topology evidence projection matches sanitized source");
}
