import topologyEvidence from "../../data/public-topology-evidence.json" with { type: "json" };

const PROJECTION_SCHEMA = "atlas-public-topology-evidence/projection/v1";
const SOURCE_SCHEMA = "atlas-resource-audit/topology-report/v1";
const AUTHORITY = "AtlasReaper311/atlas-resource-audit";
const EVIDENCE_BASE_URI =
  "https://github.com/AtlasReaper311/atlas-api-public/blob/main/";
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const VALID_STATES = new Set([
  "healthy",
  "failed",
  "unavailable",
  "warning",
]);

function unavailable(reason, source = topologyEvidence) {
  const observedAt =
    typeof source?.source?.observed_at === "string"
      ? source.source.observed_at
      : null;
  const fingerprint =
    typeof source?.source?.fingerprint === "string"
      ? source.source.fingerprint
      : null;

  return {
    state: "unavailable",
    producer: "atlas-resource-audit",
    reason,
    observed_at: observedAt,
    report_fingerprint: fingerprint,
  };
}

function isIsoUtc(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function providerKindFor(component) {
  return component?.kind === "site" ? "pages-project" : "worker";
}

function publicServiceMap(services) {
  const entries = new Map();

  for (const service of services || []) {
    const id = service?.id;
    if (
      typeof id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      entries.has(id)
    ) {
      return null;
    }
    entries.set(id, service);
  }

  return entries;
}

function validMetadata(metadata, serviceId, providerKind) {
  if (providerKind === "pages-project") return metadata === null;
  if (!metadata || typeof metadata !== "object") return false;

  const keys = Object.keys(metadata);
  if (
    keys.some(
      (key) => !["name", "state", "status", "version"].includes(key),
    )
  ) {
    return false;
  }

  if (
    typeof metadata.state !== "string" ||
    !["observed", "unavailable", "not-observed"].includes(metadata.state)
  ) {
    return false;
  }

  if (metadata.state === "observed") {
    return (
      metadata.name === serviceId &&
      typeof metadata.status === "string" &&
      metadata.status.length <= 160 &&
      typeof metadata.version === "string" &&
      metadata.version.length <= 160
    );
  }

  return true;
}

function validateProjection(source, services) {
  if (
    !source ||
    typeof source !== "object" ||
    source.schema_version !== PROJECTION_SCHEMA ||
    source.authority !== AUTHORITY ||
    !VALID_STATES.has(source.status) ||
    !Number.isInteger(source.component_count) ||
    source.component_count < 1 ||
    !Array.isArray(source.components) ||
    source.component_count !== source.components.length
  ) {
    return false;
  }

  const reportSource = source.source;
  if (
    !reportSource ||
    typeof reportSource !== "object" ||
    reportSource.schema_version !== SOURCE_SCHEMA ||
    reportSource.producer_repository !==
      "AtlasReaper311/atlas-resource-audit" ||
    reportSource.producer_workflow !==
      ".github/workflows/topology-audit.yml" ||
    !/^evidence\/topology\/[A-Za-z0-9._-]+\.json$/.test(
      String(reportSource.evidence_path || ""),
    ) ||
    !/^sha256:[0-9a-f]{64}$/.test(
      String(reportSource.fingerprint || ""),
    ) ||
    !isIsoUtc(reportSource.observed_at)
  ) {
    return false;
  }

  const privacy = source.privacy;
  if (
    !privacy ||
    typeof privacy !== "object" ||
    privacy.model !==
      "declared-public-identities-plus-aggregate-undeclared-counts" ||
    privacy.undeclared_identities_redacted !== true ||
    privacy.unexpected_binding_identities_redacted !== true ||
    privacy.unexpected_route_identities_redacted !== true ||
    !Number.isInteger(privacy.redacted_undeclared_observations) ||
    privacy.redacted_undeclared_observations < 0
  ) {
    return false;
  }

  const expected = publicServiceMap(services);
  if (!expected || expected.size !== source.components.length) return false;

  const seen = new Set();
  for (const component of source.components) {
    if (
      !component ||
      typeof component !== "object" ||
      !VALID_STATES.has(component.state) ||
      !["worker", "pages-project"].includes(component.provider_kind) ||
      typeof component.service_id !== "string" ||
      seen.has(component.service_id)
    ) {
      return false;
    }

    const service = expected.get(component.service_id);
    if (
      !service ||
      providerKindFor(service) !== component.provider_kind ||
      !validMetadata(
        component.metadata,
        component.service_id,
        component.provider_kind,
      )
    ) {
      return false;
    }

    seen.add(component.service_id);
  }

  if (seen.size !== expected.size) return false;

  const summary = source.public_summary;
  if (!summary || typeof summary !== "object") return false;

  const counts = {
    failed: 0,
    healthy: 0,
    unavailable: 0,
    warning: 0,
  };
  for (const component of source.components) counts[component.state] += 1;

  for (const state of Object.keys(counts)) {
    if (
      !Number.isInteger(summary[state]) ||
      summary[state] !== counts[state]
    ) {
      return false;
    }
  }

  const expectedStatus = counts.failed
    ? "failed"
    : counts.unavailable
      ? "unavailable"
      : "healthy";

  return source.status === expectedStatus;
}

export function evaluateTopologyEvidence(
  source,
  services,
  {
    serviceId = null,
    nowMs = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS,
  } = {},
) {
  if (!validateProjection(source, services)) {
    return unavailable(
      "sanitized live Cloudflare topology evidence failed validation",
      source,
    );
  }

  const observedMs = Date.parse(source.source.observed_at);
  if (observedMs > nowMs + MAX_FUTURE_SKEW_MS) {
    return unavailable(
      "sanitized live Cloudflare topology evidence has a future observation timestamp",
      source,
    );
  }

  if (nowMs - observedMs > maxAgeMs) {
    return unavailable(
      "sanitized live Cloudflare topology evidence is older than the 30-day publication window",
      source,
    );
  }

  const evidenceUri = `${EVIDENCE_BASE_URI}${source.source.evidence_path}`;
  const base = {
    producer: "atlas-resource-audit",
    authority: source.authority,
    observed_at: source.source.observed_at,
    report_fingerprint: source.source.fingerprint,
    evidence_uri: evidenceUri,
    privacy: {
      undeclared_identities_redacted:
        source.privacy.undeclared_identities_redacted,
      redacted_undeclared_observations:
        source.privacy.redacted_undeclared_observations,
    },
  };

  if (!serviceId) {
    return {
      ...base,
      state: source.status,
      component_count: source.component_count,
      public_summary: source.public_summary,
    };
  }

  const component = source.components.find(
    (entry) => entry.service_id === serviceId,
  );
  if (!component) {
    return unavailable(
      "no sanitized live topology evidence exists for this public service",
      source,
    );
  }

  return {
    ...base,
    state: component.state,
    provider_kind: component.provider_kind,
    metadata: component.metadata,
  };
}

export function topologyEvidenceState(
  services,
  serviceId = null,
  nowMs = Date.now(),
) {
  return evaluateTopologyEvidence(topologyEvidence, services, {
    serviceId,
    nowMs,
  });
}
