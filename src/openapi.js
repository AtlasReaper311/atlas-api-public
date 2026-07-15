/**
 * The OpenAPI 3.0 document for /v1, written by hand rather than
 * generated: twelve endpoints do not justify a generator dependency,
 * and a hand-written spec forces every response shape to be decided
 * before it ships. The smoke suite walks every path in this document
 * against the live router, so spec drift fails CI instead of lying to
 * strangers.
 */

const statusCheck = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    latency_ms: { type: "integer", nullable: true },
    detail: { type: "string" },
  },
};

export function buildOpenApi() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Atlas Systems public API",
      version: "1.2.0",
      description:
        "Versioned read surface for the Atlas Systems estate: public topology and repository inventory, the Worker registry, RAG search over the estate corpus, live infra health, assurance evidence, query stats, and status reporting. Runs at the edge on Cloudflare Workers; the RAG stack itself runs on a homelab machine that sleeps, and the API says so honestly when it does.",
      contact: { name: "Atlas Reaper", url: "https://atlas-systems.uk" },
    },
    servers: [{ url: "https://api.atlas-systems.uk" }],
    paths: {
      "/v1": {
        get: {
          summary: "Endpoint index",
          responses: { 200: { description: "Service description and endpoint list" } },
        },
      },
      "/v1/docs": {
        get: {
          summary: "Human documentation",
          responses: { 200: { description: "HTML documentation page" } },
        },
      },
      "/v1/openapi.json": {
        get: {
          summary: "This document",
          responses: { 200: { description: "OpenAPI 3.0 specification" } },
        },
      },
      "/v1/topology": {
        get: {
          summary: "Public estate topology",
          description:
            "The canonical public estate map. Rich manifest components remain authoritative for runtime roles, layers, dependencies, routes, and health metadata. Public, non-archived Atlas repositories missing from the manifest are added as source-only repository components. Explicit exclusions such as simple-proxy are never exposed.",
          responses: {
            200: {
              description: "Public topology and repository inventory",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [
                      "schema",
                      "owner",
                      "repository_count",
                      "component_count",
                      "components",
                    ],
                    properties: {
                      schema: {
                        type: "string",
                        enum: ["atlas-public-topology/v2"],
                      },
                      owner: { type: "string" },
                      canonical_site: {
                        type: "string",
                        format: "uri",
                      },
                      generated_at: {
                        type: "string",
                        format: "date-time",
                        nullable: true,
                      },
                      repository_count: {
                        type: "integer",
                        minimum: 0,
                      },
                      component_count: {
                        type: "integer",
                        minimum: 0,
                      },
                      components: {
                        type: "array",
                        items: {
                          type: "object",
                          required: [
                            "id",
                            "kind",
                            "layer",
                            "repo",
                            "repo_name",
                            "source_only",
                          ],
                          properties: {
                            id: { type: "string" },
                            kind: {
                              type: "string",
                              enum: [
                                "worker",
                                "site",
                                "github-actions",
                                "tool",
                                "repository",
                              ],
                            },
                            layer: { type: "string" },
                            lifecycle: { type: "string" },
                            repo: {
                              type: "string",
                              format: "uri",
                            },
                            repo_name: { type: "string" },
                            public_surface: {
                              type: "string",
                              format: "uri",
                              nullable: true,
                            },
                            meta_url: {
                              type: "string",
                              format: "uri",
                              nullable: true,
                            },
                            health_url: {
                              type: "string",
                              format: "uri",
                              nullable: true,
                            },
                            indexed: { type: "boolean" },
                            depends_on: {
                              type: "array",
                              items: { type: "string" },
                            },
                            description: { type: "string" },
                            language: {
                              type: "string",
                              nullable: true,
                            },
                            topics: {
                              type: "array",
                              items: { type: "string" },
                            },
                            source_only: { type: "boolean" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/registry": {
        get: {
          summary: "Worker registry",
          description:
            "Every Worker in the estate with its self-declared /_meta document, rebuilt hourly by atlas-api-index and reshaped here into a stable public form.",
          responses: {
            200: {
              description: "Registry document",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      generated_at: { type: "string", format: "date-time" },
                      counts: {
                        type: "object",
                        properties: {
                          workers: { type: "integer" },
                          documented: { type: "integer" },
                          undocumented: { type: "integer" },
                        },
                      },
                      workers: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            documented: { type: "boolean" },
                            description: { type: "string", nullable: true },
                            version: { type: "string", nullable: true },
                            endpoints: { type: "array", items: { type: "object" } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            502: { description: "Registry upstream unavailable" },
          },
        },
      },
      "/v1/search": {
        get: {
          summary: "RAG search over the estate corpus",
          description:
            "Semantic search across the estate's own documentation (decisions, READMEs, case studies). Each request costs a real embedding on local hardware, so the anonymous limit is ten per minute per IP. Client IPs stop at the edge; the corpus never sees them.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string", maxLength: 500 },
              description: "The search query",
            },
            {
              name: "top_k",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 10, default: 5 },
              description: "How many hits to return",
            },
          ],
          responses: {
            200: {
              description: "Search results",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      query: { type: "string" },
                      count: { type: "integer" },
                      took_ms: { type: "integer" },
                      hits: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            text: { type: "string" },
                            score: { type: "number" },
                            source_repo: { type: "string" },
                            file_path: { type: "string" },
                            doc_type: { type: "string" },
                            last_updated: { type: "string" },
                            chunk_index: { type: "integer" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            400: { description: "Missing query" },
            422: { description: "Query over 500 characters" },
            429: { description: "Rate limit exceeded" },
            503: { description: "Corpus unreachable (the machine sleeps; see /v1/infra/status)" },
          },
        },
      },
      "/v1/stats": {
        get: {
          summary: "Estate statistics",
          description:
            "Repository totals, component health, and uptime measured from live probes. Uptime accrues from first deploy inside a rolling window; the response labels when measurement began rather than inventing history.",
          responses: { 200: { description: "Stats document" } },
        },
      },
      "/v1/slo": {
        get: {
          summary: "Per-day probe counters for error budget maths",
          description:
            "The raw per-day ok/total counters behind the uptime numbers, one probe pass every ten minutes, pruned past the rolling window. Successful probes also carry round-trip milliseconds (ms_sum, ms_count) so consumers can show a measured average latency. Targets are deliberately not here; they live with the status page, so tuning a target never touches this Worker.",
          responses: {
            200: {
              description: "SLO source document",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      measuring_since: {
                        type: "string",
                        format: "date-time",
                        nullable: true,
                      },
                      window_days: { type: "integer" },
                      components: {
                        type: "object",
                        additionalProperties: {
                          type: "object",
                          properties: {
                            days: {
                              type: "object",
                              additionalProperties: {
                                type: "object",
                                properties: {
                                  ok: { type: "integer" },
                                  total: { type: "integer" },
                                  ms_sum: { type: "integer" },
                                  ms_count: { type: "integer" },
                                },
                              },
                            },
                            days_observed: { type: "integer" },
                            first_day: { type: "string", nullable: true },
                            ok: { type: "integer" },
                            total: { type: "integer" },
                            avg_ms: { type: "integer", nullable: true },
                          },
                        },
                      },
                      note: { type: "string" },
                      generated_at: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/infra/status": {
        get: {
          summary: "Infra health state",
          description:
            "The current verdict from the specular-sentinel pipeline: Ollama reachability, corpus health, the RAG search path end to end, and WSL2 IP drift. Staleness is recomputed at read time; a silent sentinel reads as down, not as its last good report.",
          responses: {
            200: {
              description: "Current infra state",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      overall: { type: "string", enum: ["ok", "degraded", "down", "unknown"] },
                      stale: { type: "boolean" },
                      machine: { type: "string" },
                      wsl_ip: { type: "string", nullable: true },
                      components: {
                        type: "object",
                        properties: {
                          ollama: statusCheck,
                          corpus_health: statusCheck,
                          corpus_search: statusCheck,
                        },
                      },
                      last_report_at: { type: "string", format: "date-time" },
                      since: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/infra/report": {
        post: {
          summary: "Sentinel ingest (internal)",
          description:
            "Accepts observation reports from specular-sentinel. Bearer-authenticated; documented for completeness, not for public use.",
          security: [{ bearer: [] }],
          responses: {
            200: { description: "Stored" },
            401: { description: "Missing or wrong bearer key" },
            422: { description: "Report fails shape validation" },
          },
        },
      },
      "/v1/rag/stats": {
        get: {
          summary: "RAG query statistics",
          description:
            "Counts only, by design: aggregate numbers are safe to publish, fragments of visitor queries are not, and client IPs never entered the pipeline at all.",
          responses: { 200: { description: "Query counts and timestamps" } },
        },
      },
      "/v1/rag/report": {
        post: {
          summary: "Corpus summary ingest (internal)",
          description:
            "Accepts hourly query summaries from atlas-corpus. Bearer-authenticated; documented for completeness, not for public use.",
          security: [{ bearer: [] }],
          responses: {
            200: { description: "Stored, and relayed to Discord when the hour had activity" },
            401: { description: "Missing or wrong bearer key" },
            422: { description: "Summary fails shape validation" },
          },
        },
      },
      // ATLAS_EVIDENCE_PATHS
      "/v1/evidence": {
        get: {
          summary: "Public assurance evidence index",
          description:
            "Latest conformance and chaos evidence summaries, each tied to a producer timestamp, source commit, and content fingerprint.",
          responses: { 200: { description: "Evidence index" } },
        },
      },
      "/v1/evidence/conformance": {
        get: {
          summary: "Latest estate conformance report",
          parameters: [
            {
              name: "history",
              in: "query",
              required: false,
              schema: { type: "integer", enum: [1] },
              description: "Set to 1 for the bounded report history.",
            },
          ],
          responses: {
            200: { description: "Versioned conformance evidence" },
            503: { description: "No report has been published" },
          },
        },
      },
      "/v1/evidence/chaos": {
        get: {
          summary: "Latest chaos assurance report",
          parameters: [
            {
              name: "history",
              in: "query",
              required: false,
              schema: { type: "integer", enum: [1] },
              description: "Set to 1 for the bounded report history.",
            },
          ],
          responses: {
            200: { description: "Versioned chaos evidence" },
            503: { description: "No report has been published" },
          },
        },
      },
      "/v1/evidence/conformance/report": {
        post: {
          summary: "Conformance evidence ingest",
          security: [{ bearer: [] }],
          responses: {
            200: { description: "Stored or confirmed idempotent" },
            401: { description: "Missing or incorrect bearer key" },
            422: { description: "Schema or fingerprint validation failed" },
          },
        },
      },
      "/v1/evidence/chaos/report": {
        post: {
          summary: "Chaos evidence ingest",
          security: [{ bearer: [] }],
          responses: {
            200: { description: "Stored or confirmed idempotent" },
            401: { description: "Missing or incorrect bearer key" },
            422: { description: "Schema or fingerprint validation failed" },
          },
        },
      },
      "/v1/badge/status": {
        get: {
          summary: "SVG status badge",
          description:
            "A shields-flat badge reading N/M operational across the estate's ten probed components. Sixty second cache; embeds cleanly in GitHub READMEs.",
          responses: {
            200: {
              description: "SVG image",
              content: { "image/svg+xml": { schema: { type: "string" } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
      },
    },
  };
}
