export const META = {
  name: "atlas-api-public",
  description:
    "Versioned public API for the estate: registry, RAG search, stats, infra health, and the status badge",
  version: "1.1.0",
  endpoints: [
    { method: "GET", path: "/v1", description: "Endpoint index" },
    { method: "GET", path: "/v1/docs", description: "Human documentation" },
    { method: "GET", path: "/v1/openapi.json", description: "OpenAPI 3.0 spec" },
    { method: "GET", path: "/v1/registry", description: "Worker registry, stable public shape" },
    { method: "GET", path: "/v1/search", description: "RAG search over the estate corpus (?q=)" },
    { method: "GET", path: "/v1/stats", description: "Estate stats: repos, components, measured uptime" },
    { method: "GET", path: "/v1/slo", description: "Per-day probe counters for error budget maths; window labelled" },
    { method: "GET", path: "/v1/infra/status", description: "Infra health state from specular-sentinel" },
    { method: "GET", path: "/v1/rag/stats", description: "RAG query counts, no query text" },
    { method: "GET", path: "/v1/badge/status", description: "SVG status badge" },
    { method: "POST", path: "/v1/infra/report", description: "Sentinel ingest (bearer)" },
    { method: "POST", path: "/v1/rag/report", description: "Corpus summary ingest (bearer)" },
  ],
  source: "https://github.com/AtlasReaper311/atlas-api-public",
};
