/** Fixture/KV-backed, read-only Phase 9 control-plane routes. */

import { bearerOk, errorResponse, json } from "../lib/http.js";
import { buildControlPlaneToolOpenApi } from "../control-plane-openapi.js";

const STATES = new Set(["healthy", "warning", "failed", "stale", "unavailable", "unknown"]);
const STATE_PRIORITY = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  stale: 3,
  unavailable: 4,
  failed: 5,
};
const SERVICE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PRIVATE_VALUE = /(?:localhost|127\.0\.0\.1|192\.168\.|10\.\d{1,3}\.|172\.(?:1[6-9]|2\d|3[01])\.|[A-Za-z]:\\|\/config\/)/i;
const FORBIDDEN_KEYS = new Set([
  "authorization",
  "backup_contents",
  "command",
  "cookie",
  "diagnostic_commands",
  "graphql",
  "headers",
  "home_assistant_service",
  "http_method",
  "password",
  "payload",
  "private_key",
  "raw_evidence",
  "request_body",
  "secret_value",
  "shell_command",
  "token",
  "token_value",
  "url",
]);
const ARRAY_FIELDS = [
  "services",
  "releases",
  "findings",
  "quota",
  "backups",
  "gardener_proposals",
  "runbooks",
  "evidence",
];
const MODEL_FIELDS = new Set(["summary", "source_refs", ...ARRAY_FIELDS]);
const SUMMARY_FIELDS = new Set([
  "schema_version",
  "generated_at",
  "stale_after",
  "request_id",
  "state",
  "health",
  "journeys",
  "release",
  "contract_registry",
  "quota",
  "findings",
  "gardener_proposals",
  "secret_hygiene",
  "backups",
  "runbooks",
  "evidence",
]);
const SUMMARY_REQUIRED_FIELDS = [
  "schema_version",
  "generated_at",
  "stale_after",
  "request_id",
  "state",
  "health",
  "release",
  "quota",
  "findings",
  "gardener_proposals",
  "secret_hygiene",
  "backups",
  "runbooks",
  "evidence",
];
const SUMMARY_PROJECTION_FIELDS = {
  health: new Set(["state", "components_total", "components_healthy", "active_incidents"]),
  journeys: new Set(["state", "total", "failed"]),
  release: new Set(["state", "repository", "environment", "commit", "completed_at", "evidence_ref"]),
  contract_registry: new Set(["state", "contracts_total", "contracts_valid", "drift_count"]),
  quota: new Set(["state", "used_percent", "projected_percent", "highest_meter", "period_ends_at"]),
  findings: new Set(["state", "total", "by_severity", "oldest_detected_at"]),
  gardener_proposals: new Set(["state", "total", "validation_failed", "open_pull_requests"]),
  secret_hygiene: new Set(["state", "required", "present", "stale", "unknown"]),
  backups: new Set(["state", "total", "healthy", "stale", "failed", "unknown"]),
  runbooks: new Set(["state", "valid", "invalid", "stale"]),
  evidence: new Set(["state", "searchable_records", "newest_record_at", "expiring_soon"]),
};
const ITEM_FIELDS = {
  services: new Set(["service_id", "display_name", "state", "release_state", "dependencies", "runbook_refs", "evidence_refs"]),
  releases: new Set(["repository", "environment", "commit", "release_state", "state", "journey_result", "completed_at", "evidence_ref"]),
  findings: new Set(["finding_id", "service_id", "category", "severity", "state", "summary", "detected_at", "runbook_ref"]),
  quota: new Set(["meter_id", "state", "used_percent", "projected_percent", "period_ends_at", "source_timestamp"]),
  backups: new Set(["target_id", "service_id", "state", "freshness", "method", "last_successful_backup_at", "last_restore_test_at", "retention_days", "evidence_ref"]),
  gardener_proposals: new Set(["proposal_id", "repository", "fixer_id", "files_count", "risk_class", "proposal_state", "state", "validation_state", "review_url"]),
  runbooks: new Set(["runbook_id", "service_id", "state", "title", "summary", "reference"]),
  evidence: new Set(["evidence_id", "producer", "subject", "evidence_type", "state", "summary", "timestamp", "reference"]),
};
const NESTED_ARRAY_FIELDS = new Set(["dependencies", "runbook_refs", "evidence_refs"]);
const REFERENCE_FIELDS = new Set(["evidence_ref", "evidence_refs", "reference", "review_url", "runbook_ref", "runbook_refs"]);
const PUBLIC_REFERENCE = /^https:\/\/(?:github\.com\/AtlasReaper311\/|api\.atlas-systems\.uk\/|schemas\.atlas-systems\.uk\/)/;

function unexpectedKeys(value, allowed, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [`${path}: must be an object`];
  }
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${path}.${key}: undeclared response field`);
}

function validateAllowlistedShape(model) {
  const errors = unexpectedKeys(model, MODEL_FIELDS, "$");
  errors.push(...unexpectedKeys(model.summary, SUMMARY_FIELDS, "$.summary"));
  for (const field of SUMMARY_REQUIRED_FIELDS) {
    if (!Object.hasOwn(model.summary || {}, field)) {
      errors.push(`$.summary.${field}: missing required field`);
    }
  }
  for (const [name, fields] of Object.entries(SUMMARY_PROJECTION_FIELDS)) {
    if (model.summary?.[name] !== undefined) {
      errors.push(...unexpectedKeys(model.summary[name], fields, `$.summary.${name}`));
      if (!STATES.has(model.summary[name]?.state)) {
        errors.push(`$.summary.${name}.state: invalid state`);
      }
    }
  }
  const severity = model.summary?.findings?.by_severity;
  if (severity !== undefined) {
    errors.push(...unexpectedKeys(severity, new Set(["info", "warning", "failure", "critical"]), "$.summary.findings.by_severity"));
  }
  for (const [name, fields] of Object.entries(ITEM_FIELDS)) {
    if (!Array.isArray(model[name])) continue;
    model[name].forEach((item, index) => {
      const path = `$.${name}[${index}]`;
      errors.push(...unexpectedKeys(item, fields, path));
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      if (!STATES.has(item.state)) errors.push(`${path}.state: invalid state`);
      for (const [key, value] of Object.entries(item)) {
        if (Array.isArray(value)) {
          if (!NESTED_ARRAY_FIELDS.has(key) || value.length > 20 || value.some((entry) => typeof entry !== "string")) {
            errors.push(`${path}.${key}: invalid bounded string array`);
          }
        } else if (value && typeof value === "object") {
          errors.push(`${path}.${key}: nested objects are not allowed`);
        }
      }
    });
  }
  return errors;
}

function validateReferenceValues(value, key, path) {
  if (!REFERENCE_FIELDS.has(key)) return [];
  if (value === null) return [];
  const references = Array.isArray(value) ? value : [value];
  if (references.some((reference) => typeof reference !== "string" || !PUBLIC_REFERENCE.test(reference))) {
    return [`${path}: reference is not on an approved public origin`];
  }
  return [];
}

function walkForLeaks(value, path = "$") {
  const errors = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => errors.push(...walkForLeaks(item, `${path}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) errors.push(`${path}.${key}: forbidden response key`);
      errors.push(...validateReferenceValues(item, key, `${path}.${key}`));
      errors.push(...walkForLeaks(item, `${path}.${key}`));
    }
  } else if (typeof value === "string") {
    if (PRIVATE_VALUE.test(value)) errors.push(`${path}: private or machine-local value`);
    if (value.length > 500) errors.push(`${path}: string exceeds the bounded length`);
  }
  return errors;
}

export function validateControlPlaneReadModel(model) {
  const errors = [];
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    return ["$: read model must be an object"];
  }
  const summary = model.summary;
  if (!summary || typeof summary !== "object") {
    errors.push("$.summary: missing object");
  } else {
    if (summary.schema_version !== "atlas-control-plane/control-plane-summary/v1") {
      errors.push("$.summary.schema_version: unsupported contract");
    }
    if (!STATES.has(summary.state)) errors.push("$.summary.state: invalid state");
    for (const field of ["generated_at", "stale_after", "request_id"]) {
      if (typeof summary[field] !== "string" || summary[field].length === 0) {
        errors.push(`$.summary.${field}: missing string`);
      }
    }
    const generatedAt = Date.parse(summary.generated_at);
    const staleAfter = Date.parse(summary.stale_after);
    if (
      !summary.generated_at?.endsWith("Z") ||
      !summary.stale_after?.endsWith("Z") ||
      Number.isNaN(generatedAt) ||
      Number.isNaN(staleAfter) ||
      staleAfter < generatedAt
    ) {
      errors.push("$.summary: invalid freshness window");
    }
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(model[field])) {
      errors.push(`$.${field}: must be an array`);
    } else if (model[field].length > 100) {
      errors.push(`$.${field}: exceeds the bounded item limit`);
    }
  }
  errors.push(...validateAllowlistedShape(model));
  if (!Array.isArray(model.source_refs) || model.source_refs.length > 8) {
    errors.push("$.source_refs: must be a bounded array");
  } else if (model.source_refs.some((ref) => typeof ref !== "string" || !PUBLIC_REFERENCE.test(ref))) {
    errors.push("$.source_refs: references must use an approved public origin");
  }
  if (summary && JSON.stringify(summary).length > 16 * 1024) {
    errors.push("$.summary: exceeds the bounded result limit");
  }
  errors.push(...walkForLeaks(model));
  return errors;
}

function applyReadModelFreshness(model, now = Date.now()) {
  if (now <= Date.parse(model.summary.stale_after)) return model;
  const stale = JSON.parse(JSON.stringify(model));
  const staleState = (state) =>
    STATES.has(state) && STATE_PRIORITY[state] > STATE_PRIORITY.stale ? state : "stale";
  stale.summary.state = staleState(stale.summary.state);
  for (const name of Object.keys(SUMMARY_PROJECTION_FIELDS)) {
    if (stale.summary[name]) {
      stale.summary[name].state = staleState(stale.summary[name].state);
    }
  }
  for (const name of ARRAY_FIELDS) {
    for (const item of stale[name]) item.state = staleState(item.state);
  }
  return stale;
}

async function loadReadModel(env) {
  let model = env.CONTROL_PLANE_FIXTURES;
  if (!model && env.ATLAS_PUBLIC_KV && typeof env.ATLAS_PUBLIC_KV.get === "function") {
    try {
      const stored = await env.ATLAS_PUBLIC_KV.get("control-plane:read-model:v1");
      model = stored ? JSON.parse(stored) : null;
    } catch {
      model = null;
    }
  }
  if (validateControlPlaneReadModel(model).length !== 0) return null;
  return env.CONTROL_PLANE_FIXTURES ? model : applyReadModelFreshness(model);
}

function ensureAllowedQuery(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return `unsupported query parameter: ${key}`;
  }
  return null;
}

function optionalSlug(url, name, maxLength = 64) {
  const value = url.searchParams.get(name);
  if (value === null) return { value: null };
  if (value.length < 1 || value.length > maxLength || !SERVICE_ID.test(value)) {
    return { error: `${name} must be a lower-case kebab-case identifier` };
  }
  return { value };
}

function optionalRepository(url) {
  const value = url.searchParams.get("repository");
  if (value === null) return { value: null };
  if (value.length < 1 || value.length > 100 || !REPOSITORY.test(value)) {
    return { error: "repository must be a repository slug" };
  }
  return { value };
}

function optionalEnum(url, name, allowed) {
  const value = url.searchParams.get(name);
  if (value === null) return { value: null };
  return allowed.has(value) ? { value } : { error: `${name} is not allowlisted` };
}

function limitFrom(url, fallback = 20, maximum = 20) {
  const raw = url.searchParams.get("limit");
  if (raw === null) return { value: fallback };
  if (!/^\d+$/.test(raw)) return { error: "limit must be an integer" };
  const value = Number(raw);
  if (value < 1 || value > maximum) return { error: `limit must be between 1 and ${maximum}` };
  return { value };
}

function requiredQuery(url) {
  const value = (url.searchParams.get("query") || "").trim();
  if (value.length < 1 || value.length > 200) {
    return { error: "query must be between 1 and 200 characters" };
  }
  return { value };
}

function optionalTimestamp(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return { value: null };
  const parsed = Date.parse(value);
  if (!value.endsWith("Z") || Number.isNaN(parsed)) {
    return { error: `${name} must be a UTC timestamp ending in Z` };
  }
  return { value, parsed };
}

function worstState(items, fallback = "unknown") {
  const states = items.map((item) => item.state).filter((state) => STATES.has(state));
  if (states.length === 0) return fallback;
  return states.reduce((worst, state) =>
    STATE_PRIORITY[state] > STATE_PRIORITY[worst] ? state : worst,
  );
}

function boundedToolResponse(operationId, model, state, data) {
  const body = {
    schema_version: "atlas-control-plane/tool-result/v1",
    operation_id: operationId,
    generated_at: model.summary.generated_at,
    stale_after: model.summary.stale_after,
    state: STATES.has(state) ? state : "unknown",
    source_refs: model.source_refs,
    request_id: `${model.summary.request_id}-${operationId.toLowerCase()}`.slice(0, 96),
    data,
  };
  if (JSON.stringify(body).length > 16 * 1024) {
    return errorResponse(503, "bounded result limit exceeded", "narrow the allowlisted filters");
  }
  return json(body, 200, { "cache-control": "private, no-store" });
}

function invalid(message) {
  return errorResponse(400, message, "use the parameters declared by the dedicated OpenAPI document");
}

function filterText(item, query) {
  const haystack = [
    item.evidence_id,
    item.runbook_id,
    item.title,
    item.summary,
    item.subject,
    item.producer,
    item.service_id,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

async function handleTool(url, path, model) {
  if (path === "/v1/control-plane/tools/summary") {
    const unexpected = ensureAllowedQuery(url, new Set());
    if (unexpected) return invalid(unexpected);
    return boundedToolResponse("GetEstateSummary", model, model.summary.state, model.summary);
  }

  const serviceMatch = path.match(/^\/v1\/control-plane\/tools\/services\/([^/]+)$/);
  if (serviceMatch) {
    const unexpected = ensureAllowedQuery(url, new Set());
    if (unexpected) return invalid(unexpected);
    let serviceId;
    try {
      serviceId = decodeURIComponent(serviceMatch[1]);
    } catch {
      return invalid("invalid service_id encoding");
    }
    if (serviceId.length > 64 || !SERVICE_ID.test(serviceId)) return invalid("invalid service_id");
    const item = model.services.find((service) => service.service_id === serviceId) || null;
    return boundedToolResponse("GetServiceStatus", model, item?.state || "unknown", { item });
  }

  if (path === "/v1/control-plane/tools/releases") {
    const unexpected = ensureAllowedQuery(url, new Set(["repository", "environment", "commit"]));
    if (unexpected) return invalid(unexpected);
    const repository = optionalRepository(url);
    const environment = optionalEnum(url, "environment", new Set(["development", "preview", "production"]));
    const commit = url.searchParams.get("commit");
    if (repository.error || environment.error) return invalid(repository.error || environment.error);
    if (commit !== null && !COMMIT.test(commit)) return invalid("commit must be a full lower-case Git SHA");
    const item = model.releases.find((release) =>
      (!repository.value || release.repository === repository.value) &&
      (!environment.value || release.environment === environment.value) &&
      (!commit || release.commit === commit),
    ) || null;
    return boundedToolResponse("GetReleaseStatus", model, item?.state || "unknown", { item });
  }

  if (path === "/v1/control-plane/tools/findings") {
    const unexpected = ensureAllowedQuery(url, new Set(["service_id", "severity", "limit"]));
    if (unexpected) return invalid(unexpected);
    const service = optionalSlug(url, "service_id");
    const severity = optionalEnum(url, "severity", new Set(["info", "warning", "failure", "critical"]));
    const limit = limitFrom(url);
    if (service.error || severity.error || limit.error) return invalid(service.error || severity.error || limit.error);
    const items = model.findings
      .filter((item) => !service.value || item.service_id === service.value)
      .filter((item) => !severity.value || item.severity === severity.value)
      .slice(0, limit.value);
    return boundedToolResponse("ListActiveFindings", model, worstState(items), { count: items.length, items });
  }

  if (path === "/v1/control-plane/tools/quota") {
    const unexpected = ensureAllowedQuery(url, new Set(["meter_id"]));
    if (unexpected) return invalid(unexpected);
    const meter = optionalSlug(url, "meter_id");
    if (meter.error) return invalid(meter.error);
    const items = model.quota.filter((item) => !meter.value || item.meter_id === meter.value);
    return boundedToolResponse("GetQuotaProjection", model, worstState(items), { count: items.length, items });
  }

  if (path === "/v1/control-plane/tools/backups") {
    const unexpected = ensureAllowedQuery(url, new Set(["target_id"]));
    if (unexpected) return invalid(unexpected);
    const target = optionalSlug(url, "target_id");
    if (target.error) return invalid(target.error);
    const items = model.backups.filter((item) => !target.value || item.target_id === target.value);
    return boundedToolResponse("GetBackupStatus", model, worstState(items), { count: items.length, items });
  }

  if (path === "/v1/control-plane/tools/gardener/proposals") {
    const unexpected = ensureAllowedQuery(url, new Set(["repository", "risk_class", "state", "limit"]));
    if (unexpected) return invalid(unexpected);
    const repository = optionalRepository(url);
    const risk = optionalEnum(url, "risk_class", new Set(["low", "medium", "high"]));
    const state = optionalEnum(url, "state", new Set(["dry_run", "proposed", "draft_pr", "validation_failed"]));
    const limit = limitFrom(url);
    if (repository.error || risk.error || state.error || limit.error) {
      return invalid(repository.error || risk.error || state.error || limit.error);
    }
    const items = model.gardener_proposals
      .filter((item) => !repository.value || item.repository === repository.value)
      .filter((item) => !risk.value || item.risk_class === risk.value)
      .filter((item) => !state.value || item.proposal_state === state.value)
      .slice(0, limit.value);
    return boundedToolResponse("ListGardenerProposals", model, worstState(items), { count: items.length, items });
  }

  if (path === "/v1/control-plane/tools/runbooks/search") {
    const unexpected = ensureAllowedQuery(url, new Set(["query", "service_id"]));
    if (unexpected) return invalid(unexpected);
    const query = requiredQuery(url);
    const service = optionalSlug(url, "service_id");
    if (query.error || service.error) return invalid(query.error || service.error);
    const items = model.runbooks
      .filter((item) => !service.value || item.service_id === service.value)
      .filter((item) => filterText(item, query.value))
      .slice(0, 5);
    return boundedToolResponse("FindRunbook", model, worstState(items), { count: items.length, items });
  }

  if (path === "/v1/control-plane/tools/evidence/search") {
    const unexpected = ensureAllowedQuery(url, new Set(["query", "producer", "subject", "since", "until", "limit"]));
    if (unexpected) return invalid(unexpected);
    const query = requiredQuery(url);
    const producer = optionalSlug(url, "producer");
    const subject = url.searchParams.get("subject");
    const since = optionalTimestamp(url, "since");
    const until = optionalTimestamp(url, "until");
    const limit = limitFrom(url);
    if (query.error || producer.error || since.error || until.error || limit.error) {
      return invalid(query.error || producer.error || since.error || until.error || limit.error);
    }
    if (subject !== null && (subject.length < 1 || subject.length > 128)) return invalid("subject is out of bounds");
    if (since.parsed && until.parsed && since.parsed > until.parsed) return invalid("since must not be after until");
    const items = model.evidence
      .filter((item) => filterText(item, query.value))
      .filter((item) => !producer.value || item.producer === producer.value)
      .filter((item) => !subject || item.subject === subject)
      .filter((item) => !since.parsed || Date.parse(item.timestamp) >= since.parsed)
      .filter((item) => !until.parsed || Date.parse(item.timestamp) <= until.parsed)
      .slice(0, limit.value);
    return boundedToolResponse("SearchEvidence", model, worstState(items), { count: items.length, items });
  }

  return null;
}

export async function handleControlPlane(request, env, path) {
  if (!path.startsWith("/v1/control-plane")) return null;
  if (request.method !== "GET") {
    return errorResponse(405, "control-plane surface is read-only", "only the documented GET routes exist");
  }

  if (path === "/v1/control-plane/summary") {
    const model = await loadReadModel(env);
    if (!model) return errorResponse(503, "control-plane summary unavailable", "no schema-valid bounded read model is present");
    return json(model.summary, 200, { "cache-control": "public, max-age=60" });
  }

  if (!path.startsWith("/v1/control-plane/tools/")) return null;
  if (!bearerOk(request, env.RAMONE_CONTROL_PLANE_READ_TOKEN)) {
    return errorResponse(401, "read-only bearer required");
  }
  if (path === "/v1/control-plane/tools/openapi.json") {
    return json(buildControlPlaneToolOpenApi(), 200, { "cache-control": "private, no-store" });
  }
  const model = await loadReadModel(env);
  if (!model) return errorResponse(503, "control-plane tools unavailable", "no schema-valid bounded read model is present");
  return handleTool(new URL(request.url), path, model);
}
