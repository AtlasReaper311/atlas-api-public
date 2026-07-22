import adrRuntimeIndex from "../../data/adr-runtime-index.json" with { type: "json" };
import repositoryClassifications from "../../data/public-repository-classifications.json" with { type: "json" };
import { errorResponse, json, nowIso } from "../lib/http.js";
import { buildPublicTopology } from "./topology.js";

const CLASSIFICATION_AUTHORITY = "AtlasReaper311/atlas-infra";
const CLASSIFICATION_SCHEMA =
  "atlas-public-repository-classifications/projection/v1";
const ADR_INDEX_SCHEMA = "atlas-control-plane/adr-runtime-index/v1";
const NODE_SCHEMA = "atlas-control-plane/evidence-node/v1";
const EDGE_SCHEMA = "atlas-control-plane/evidence-edge/v1";
const CLASSIFICATION_URI =
  "https://github.com/AtlasReaper311/atlas-infra/blob/main/policy/public-repository-classifications.json";
const ADR_BASE_URI =
  "https://github.com/AtlasReaper311/atlas-infra/blob/main/";

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

async function sha256Hex(value) {
  const text = JSON.stringify(sortValue(value));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function nodeId(kind, key) {
  return `node:sha256:${await sha256Hex({ "identity.key": key, kind })}`;
}

async function edgeId(fromNode, relation, toNode) {
  return `edge:sha256:${await sha256Hex({
    from_node: fromNode,
    relation,
    to_node: toNode,
  })}`;
}

function repositoryName(repoUrl) {
  const match =
    typeof repoUrl === "string"
      ? repoUrl.match(/^https:\/\/github\.com\/AtlasReaper311\/([^/?#]+)$/i)
      : null;
  return match ? match[1] : null;
}

function validClassificationAuthority() {
  return (
    repositoryClassifications?.schema_version === CLASSIFICATION_SCHEMA &&
    repositoryClassifications?.authority === CLASSIFICATION_AUTHORITY &&
    Array.isArray(repositoryClassifications.repositories) &&
    repositoryClassifications.repository_count ===
      repositoryClassifications.repositories.length &&
    /^sha256:[0-9a-f]{64}$/.test(
      String(repositoryClassifications.source_fingerprint || ""),
    )
  );
}

function validAdrAuthority() {
  return (
    adrRuntimeIndex?.schema_version === ADR_INDEX_SCHEMA &&
    Array.isArray(adrRuntimeIndex.relationships) &&
    adrRuntimeIndex.relationships.every(
      (relationship) =>
        relationship?.schema_version ===
          "atlas-control-plane/adr-runtime-relationship/v1" &&
        relationship?.visibility === "public" &&
        /^adrrel:sha256:[0-9a-f]{64}$/.test(
          String(relationship.relationship_id || ""),
        ) &&
        relationship?.adr?.status === "accepted" &&
        /^ADR-[0-9]{4}$/.test(String(relationship?.adr?.id || "")),
    )
  );
}

function publicServices() {
  if (!validClassificationAuthority() || !validAdrAuthority()) return [];

  return buildPublicTopology()
    .components.filter(
      (component) =>
        component?.source_only === false &&
        component?.runtime_service === true &&
        component?.scope === "public" &&
        typeof component?.id === "string" &&
        typeof component?.repo === "string" &&
        repositoryName(component.repo),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function adrRelationshipsFor(serviceId, repository) {
  return adrRuntimeIndex.relationships
    .filter((relationship) => {
      const services = relationship?.affects?.services || [];
      const repositories = relationship?.affects?.repositories || [];
      return services.includes(serviceId) || repositories.includes(repository);
    })
    .sort((left, right) => left.adr.id.localeCompare(right.adr.id));
}

function classificationEvidence() {
  return {
    producer: "atlas-infra",
    evidence_type: "repository-classification",
    digest: repositoryClassifications.source_fingerprint,
    uri: CLASSIFICATION_URI,
    visibility: "public",
  };
}

function adrEvidence(relationship) {
  return {
    producer: "atlas-infra",
    evidence_type: "adr-runtime-relationship",
    digest: `sha256:${relationship.relationship_id.slice(
      "adrrel:sha256:".length,
    )}`,
    uri: `${ADR_BASE_URI}${relationship.adr.path}`,
    visibility: "public",
  };
}

function topologyEvidenceState() {
  return {
    state: "unavailable",
    producer: "atlas-resource-audit",
    reason:
      "sanitized live Cloudflare topology evidence has not been published to atlas-api-public",
  };
}

async function serviceNode(component, repository) {
  const key = `service:${component.id}`;
  return {
    schema_version: NODE_SCHEMA,
    node_id: await nodeId("service", key),
    kind: "service",
    identity: {
      key,
      repository,
      service_id: component.id,
    },
    visibility: "public",
    evidence_state: "verified",
    evidence: [classificationEvidence()],
  };
}

async function repositoryNode(repository) {
  return {
    schema_version: NODE_SCHEMA,
    node_id: await nodeId("repository", repository),
    kind: "repository",
    identity: {
      key: repository,
      repository,
    },
    visibility: "public",
    evidence_state: "verified",
    evidence: [classificationEvidence()],
  };
}

async function adrNode(relationship) {
  const key = `adr:${relationship.adr.id}`;
  return {
    schema_version: NODE_SCHEMA,
    node_id: await nodeId("adr", key),
    kind: "adr",
    identity: {
      key,
      external_id: relationship.adr.id,
    },
    visibility: "public",
    evidence_state: "verified",
    evidence: [adrEvidence(relationship)],
  };
}

async function sourceEdge(repository, service) {
  return {
    schema_version: EDGE_SCHEMA,
    edge_id: await edgeId(repository.node_id, "SOURCE_OF", service.node_id),
    from_node: repository.node_id,
    relation: "SOURCE_OF",
    to_node: service.node_id,
    visibility: "public",
    basis: {
      method: "exact-identity",
      rationale:
        "The public repository classification and topology projection carry the same explicit repository identity for this service.",
      match_keys: ["repository", "service_id"],
    },
    evidence: [classificationEvidence()],
  };
}

async function governanceEdge(service, adr, relationship) {
  return {
    schema_version: EDGE_SCHEMA,
    edge_id: await edgeId(service.node_id, "GOVERNED_BY", adr.node_id),
    from_node: service.node_id,
    relation: "GOVERNED_BY",
    to_node: adr.node_id,
    visibility: "public",
    basis: {
      method: "declared-governance",
      rationale:
        "The accepted ADR declares this service or its source repository in machine-readable scope.",
      match_keys: ["service_id", "repository"],
    },
    evidence: [adrEvidence(relationship)],
  };
}

export async function buildPublicTraceIndex() {
  const services = publicServices();
  return {
    schema: "atlas-public-trace-index/v1",
    authority: CLASSIFICATION_AUTHORITY,
    classification_fingerprint: repositoryClassifications.source_fingerprint,
    relation_vocabulary: ["SOURCE_OF", "GOVERNED_BY"],
    service_count: services.length,
    services: services.map((component) => {
      const repository = `AtlasReaper311/${repositoryName(component.repo)}`;
      const governance = adrRelationshipsFor(component.id, repository);
      return {
        service_id: component.id,
        repository,
        kind: component.kind,
        lifecycle: component.lifecycle,
        governance_count: governance.length,
        proof_chain: `/v1/trace/services/${component.id}`,
      };
    }),
    live_topology: topologyEvidenceState(),
    generated_at: nowIso(),
  };
}

export async function buildPublicTraceService(serviceId) {
  const component = publicServices().find((item) => item.id === serviceId);
  if (!component) return null;

  const repository = `AtlasReaper311/${repositoryName(component.repo)}`;
  const relationships = adrRelationshipsFor(serviceId, repository);
  const service = await serviceNode(component, repository);
  const sourceRepository = await repositoryNode(repository);
  const governanceNodes = await Promise.all(relationships.map(adrNode));
  const nodes = [sourceRepository, service, ...governanceNodes];
  const edges = [await sourceEdge(sourceRepository, service)];

  for (let index = 0; index < relationships.length; index += 1) {
    edges.push(
      await governanceEdge(service, governanceNodes[index], relationships[index]),
    );
  }

  return {
    schema: "atlas-public-trace-service/v1",
    subject: {
      service_id: component.id,
      repository,
      kind: component.kind,
      layer: component.layer,
      lifecycle: component.lifecycle,
      public_surface: component.public_surface,
      metadata_url: component.meta_url,
    },
    graph: {
      node_contract: NODE_SCHEMA,
      edge_contract: EDGE_SCHEMA,
      nodes,
      edges,
    },
    live_topology: topologyEvidenceState(),
    sources: {
      classification: CLASSIFICATION_URI,
      adr_authority: "https://github.com/AtlasReaper311/atlas-infra/tree/main/docs/adrs",
      manifest:
        "https://github.com/AtlasReaper311/atlas-api-public/blob/main/data/estate.manifest.json",
    },
    generated_at: nowIso(),
  };
}

export async function handleTraceIndex() {
  if (!validClassificationAuthority() || !validAdrAuthority()) {
    return errorResponse(503, "public Trace authority is unavailable");
  }
  return json(await buildPublicTraceIndex(), 200, {
    "cache-control": "public, max-age=300",
  });
}

export async function handleTraceService(serviceId) {
  if (!validClassificationAuthority() || !validAdrAuthority()) {
    return errorResponse(503, "public Trace authority is unavailable");
  }
  const document = await buildPublicTraceService(serviceId);
  if (!document) return errorResponse(404, "no such public Trace service");
  return json(document, 200, {
    "cache-control": "public, max-age=300",
  });
}
