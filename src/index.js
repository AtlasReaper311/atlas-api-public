/**
 * atlas-api-public: the versioned public surface of the estate.
 */

import {
  CORS_HEADERS,
  errorResponse,
  json,
  rateLimit,
  tooMany,
  clientIp,
  nowIso,
} from "./lib/http.js";
import { handleMeta } from "./_meta.js";
import { META } from "./meta.js";
import { handleInfraReport, handleInfraStatus } from "./routes/infra.js";
import { handleRagReport, handleRagStats } from "./routes/rag.js";
import { handleRegistry } from "./routes/registry.js";
import { handleSearch } from "./routes/search.js";
import { handleStats } from "./routes/stats.js";
import { handleSlo } from "./routes/slo.js";
import {
  handleEvidenceGet,
  handleEvidenceIndex,
  handleEvidenceReport,
} from "./routes/evidence.js";
import { handleBadge } from "./routes/badge.js";
import { handleDocs } from "./routes/docs.js";
import { handleTopology } from "./routes/topology.js";
import { buildOpenApi } from "./openapi.js";
import { runCron } from "./cron.js";

const EVIDENCE_PATH = /^\/v1\/evidence\/(conformance|chaos)$/;
const EVIDENCE_REPORT_PATH = /^\/v1\/evidence\/(conformance|chaos)\/report$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const meta = handleMeta(url, META);
    if (meta) return meta;

    if (path === "/v1/badge/status" && request.method === "GET") {
      return handleBadge(request, env, ctx);
    }

    const rl = await rateLimit(env.RL_GENERAL, `g:${clientIp(request)}`);
    if (!rl.allowed) return tooMany();

    if (request.method === "GET") {
      if (path === "/v1/evidence") {
        return handleEvidenceIndex(request, env);
      }
      const evidenceMatch = path.match(EVIDENCE_PATH);
      if (evidenceMatch) {
        return handleEvidenceGet(request, env, evidenceMatch[1]);
      }

      switch (path) {
        case "/v1":
          return json({
            ok: true,
            service: META.name,
            version: META.version,
            description: META.description,
            endpoints: META.endpoints,
            docs: "https://api.atlas-systems.uk/v1/docs",
            generated_at: nowIso(),
          });
        case "/v1/docs":
          return handleDocs();
        case "/v1/openapi.json":
          return json(buildOpenApi(), 200, {
            "cache-control": "public, max-age=300",
          });
        case "/v1/registry":
          return handleRegistry(request, env, ctx);
        case "/v1/topology":
          return handleTopology();
        case "/v1/search":
          return handleSearch(request, env);
        case "/v1/stats":
          return handleStats(request, env, ctx);
        case "/v1/slo":
          return handleSlo(request, env);
        case "/v1/infra/status":
          return handleInfraStatus(request, env);
        case "/v1/rag/stats":
          return handleRagStats(request, env);
      }
    }

    if (request.method === "POST") {
      const evidenceReportMatch = path.match(EVIDENCE_REPORT_PATH);
      if (evidenceReportMatch) {
        return handleEvidenceReport(request, env, evidenceReportMatch[1]);
      }
      switch (path) {
        case "/v1/infra/report":
          return handleInfraReport(request, env, ctx);
        case "/v1/rag/report":
          return handleRagReport(request, env, ctx);
      }
    }

    return errorResponse(
      404,
      "no such endpoint",
      "GET /v1 lists the surface; /v1/docs is the human version",
    );
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};
