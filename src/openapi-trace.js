import { buildOpenApi as buildBaseOpenApi } from "./openapi.js";

const serviceIdParameter = {
  name: "service_id",
  in: "path",
  required: true,
  schema: {
    type: "string",
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    maxLength: 64,
  },
};

const liveTopologyState = {
  type: "object",
  required: ["state", "producer", "reason"],
  properties: {
    state: {
      type: "string",
      enum: ["unavailable"],
    },
    producer: {
      type: "string",
      enum: ["atlas-resource-audit"],
    },
    reason: { type: "string" },
  },
};

export function buildOpenApi() {
  const spec = buildBaseOpenApi();
  spec.info.version = "1.4.0";
  spec.info.description =
    "Versioned read surface for the Atlas Systems estate: public topology and repository inventory, bounded Atlas Trace proof chains, the Worker registry, RAG search over the estate corpus, live infra health, assurance evidence, query stats, and status reporting. Runs at the edge on Cloudflare Workers; unavailable evidence is represented explicitly rather than inferred.";

  const topologySchema =
    spec.paths?.["/v1/topology"]?.get?.responses?.[200]?.content?.[
      "application/json"
    ]?.schema?.properties?.schema;
  if (topologySchema) {
    topologySchema.enum = ["atlas-public-topology/v3"];
  }

  spec.paths["/v1/trace"] = {
    get: {
      summary: "Bounded public Atlas Trace index",
      description:
        "Lists public runtime services eligible for proof-chain lookup. The projection is constrained to verified public repository classification and accepted public ADR scope. It is not an arbitrary graph query endpoint. Live Cloudflare topology remains explicitly unavailable until sanitized atlas-resource-audit evidence is separately published.",
      responses: {
        200: {
          description: "Public Trace service index",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "schema",
                  "authority",
                  "classification_fingerprint",
                  "relation_vocabulary",
                  "service_count",
                  "services",
                  "live_topology",
                  "generated_at",
                ],
                properties: {
                  schema: {
                    type: "string",
                    enum: ["atlas-public-trace-index/v1"],
                  },
                  authority: { type: "string" },
                  classification_fingerprint: {
                    type: "string",
                    pattern: "^sha256:[0-9a-f]{64}$",
                  },
                  relation_vocabulary: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["SOURCE_OF", "GOVERNED_BY"],
                    },
                  },
                  service_count: { type: "integer", minimum: 0 },
                  services: {
                    type: "array",
                    items: {
                      type: "object",
                      required: [
                        "service_id",
                        "repository",
                        "kind",
                        "lifecycle",
                        "governance_count",
                        "proof_chain",
                      ],
                      properties: {
                        service_id: { type: "string" },
                        repository: { type: "string" },
                        kind: { type: "string" },
                        lifecycle: { type: "string" },
                        governance_count: {
                          type: "integer",
                          minimum: 0,
                        },
                        proof_chain: { type: "string" },
                      },
                    },
                  },
                  live_topology: liveTopologyState,
                  generated_at: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        503: { description: "Trace authority failed closed" },
      },
    },
  };

  spec.paths["/v1/trace/services/{service_id}"] = {
    get: {
      summary: "One public service proof chain",
      description:
        "Returns a bounded Atlas Trace projection for one explicitly public runtime service: its source repository node, service node, accepted governing ADR nodes, and deterministic SOURCE_OF/GOVERNED_BY edges. Private or non-public service identifiers return 404 without revealing whether they exist elsewhere in the estate.",
      parameters: [serviceIdParameter],
      responses: {
        200: {
          description: "Bounded public proof chain",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "schema",
                  "subject",
                  "graph",
                  "live_topology",
                  "sources",
                  "generated_at",
                ],
                properties: {
                  schema: {
                    type: "string",
                    enum: ["atlas-public-trace-service/v1"],
                  },
                  subject: { type: "object" },
                  graph: {
                    type: "object",
                    required: [
                      "node_contract",
                      "edge_contract",
                      "nodes",
                      "edges",
                    ],
                    properties: {
                      node_contract: {
                        type: "string",
                        enum: ["atlas-control-plane/evidence-node/v1"],
                      },
                      edge_contract: {
                        type: "string",
                        enum: ["atlas-control-plane/evidence-edge/v1"],
                      },
                      nodes: { type: "array", items: { type: "object" } },
                      edges: { type: "array", items: { type: "object" } },
                    },
                  },
                  live_topology: liveTopologyState,
                  sources: { type: "object" },
                  generated_at: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        404: { description: "Unknown or non-public Trace service" },
        503: { description: "Trace authority failed closed" },
      },
    },
  };

  return spec;
}
