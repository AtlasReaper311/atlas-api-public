import projection from "../../data/twin-impact-projection.json" with { type: "json" };
import { errorResponse, json } from "../lib/http.js";

const SCHEMA_VERSION = "atlas-control-plane/twin-impact-projection/v1";
const ROUTE = "/v1/evidence/twin-impact";
const LIMITATIONS = new Set([
  "could-be-affected-only",
  "no-merge-approval",
  "no-deployment-claim",
  "no-runtime-claim",
  "no-live-claim",
  "no-publication-claim",
  "no-failure-claim",
  "no-estate-completeness-claim",
  "private-or-unclassified-evidence-may-be-unknown",
]);
const RELATION_AUTHORITIES = {
  repository: "atlas-infra-public-classification",
  component: "atlas-api-public-topology-exporter",
  service: "atlas-api-public-topology-exporter",
};
const UNKNOWN_CODES = new Set([
  "private-or-unclassified-evidence",
  "public-classification-unavailable",
  "passport-source-unavailable",
  "public-topology-relationship-unavailable",
  "private-or-unknown-subject",
]);
const FORBIDDEN_KEYS = /merge|approval|release|publication|deployment|runtime|failure|live/i;

function safeKeys(value) {
  if (Array.isArray(value)) return value.every(safeKeys);
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(
    ([key, child]) => !FORBIDDEN_KEYS.test(key) && safeKeys(child),
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value))
  );
}

function validSubject(subject) {
  if (!subject || typeof subject !== "object") return false;
  if (subject.visibility === "public") {
    return (
      /^AtlasReaper311\/[A-Za-z0-9._-]+$/.test(subject.repository || "") &&
      /^[0-9a-f]{40}$/.test(subject.base_oid || "") &&
      /^[0-9a-f]{40}$/.test(subject.head_oid || "")
    );
  }
  return (
    subject.visibility === "private-or-unknown" &&
    subject.repository === null &&
    subject.base_oid === null &&
    subject.head_oid === null
  );
}

function validRelationships(relationships) {
  return (
    Array.isArray(relationships) &&
    relationships.length <= 100 &&
    relationships.every((item) => {
      const authority = RELATION_AUTHORITIES[item?.kind];
      const idPattern =
        item?.kind === "repository"
          ? /^AtlasReaper311\/[A-Za-z0-9._-]+$/
          : /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      return (
        authority &&
        item.evidence_class === "twin-impact" &&
        authority === item.identity_authority &&
        idPattern.test(item.id || "") &&
        ["changed", "direct-consumer", "indirect-consumer", "declared-service"].includes(
          item.relation,
        )
      );
    })
  );
}

export function isValidTwinImpactProjection(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return false;
  }
  const impact = document.impact;
  const privacy = document.privacy;
  const distribution = document.distribution;
  const unknowns = impact?.unknowns;
  const relationships = impact?.relationships;
  return (
    document.schema_version === SCHEMA_VERSION &&
    /^sha256:[0-9a-f]{64}$/.test(document.projection_fingerprint || "") &&
    validTimestamp(document.generated_at) &&
    validSubject(document.subject) &&
    impact?.conclusion === "could-be-affected" &&
    impact?.scope === "public-only" &&
    ["known-public-scope", "partial-public-scope", "unknown"].includes(
      impact?.coverage,
    ) &&
    validRelationships(relationships) &&
    Array.isArray(unknowns) &&
    unknowns.length <= 8 &&
    unknowns.every((code) => UNKNOWN_CODES.has(code)) &&
    (impact.coverage === "known-public-scope"
      ? unknowns.length === 0
      : unknowns.length > 0) &&
    (impact.coverage === "unknown" ? relationships.length === 0 : true) &&
    distribution?.mode === "static-public-projection" &&
    distribution?.serving_repository === "AtlasReaper311/atlas-api-public" &&
    distribution?.path === "data/twin-impact-projection.json" &&
    distribution?.route === ROUTE &&
    privacy?.mode === "public-safe" &&
    privacy?.redaction === "drop-private-or-unclassified" &&
    privacy?.public_identities_only === true &&
    privacy?.private_data_excluded === true &&
    privacy?.unknown_data_not_inferred === true &&
    Array.isArray(document.limitations) &&
    document.limitations.length === LIMITATIONS.size &&
    new Set(document.limitations).size === LIMITATIONS.size &&
    document.limitations.every((code) => LIMITATIONS.has(code)) &&
    safeKeys(document)
  );
}

export function handleTwinImpact(document = projection) {
  if (!isValidTwinImpactProjection(document)) {
    return errorResponse(503, "public Twin impact projection is unavailable");
  }
  return json(document, 200, { "cache-control": "public, max-age=300" });
}
