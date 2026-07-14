/**
 * atlas-api-public: the versioned public surface of the estate.
 *
 * One Worker on api.atlas-systems.uk/v1* (more specific than
 * atlas-notify's /* wildcard, so it takes /v1 without unwiring
 * anything) hosting four concerns that share state and plumbing:
 *
 *   infra   the edge half of the specular-sentinel pipeline
 *   rag     the edge half of the corpus query stats pipeline
 *   public  registry, search proxy, stats, docs, openapi
 *   badge   the SVG status badge
 *
 * Versioning lives in the path: /v2 would be a new router branch here,
 * not a new Worker. The /_meta contract and the notify envelope are
 * adopted at birth, per the estate standard.
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
import { handleBadge } from "./routes/badge.js";
import { handleDocs } from "./routes/docs.js";
import { handleControlPlane } from "./routes/control-plane.js";
import { buildOpenApi } from "./openapi.js";
import { runCron } from "./cron.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const meta = handleMeta(url, META);
    if (meta) return meta;

    // The badge is exempt from the general limiter: GitHub's camo proxy
    // fetches it on every README render, and a 429 there would show a
    // broken image to exactly the audience the badge exists for.
    if (path === "/v1/badge/status" && request.method === "GET") {
      return handleBadge(request, env, ctx);
    }

    const rl = await rateLimit(env.RL_GENERAL, `g:${clientIp(request)}`);
    if (!rl.allowed) return tooMany();

    const controlPlane = await handleControlPlane(request, env, path);
    if (controlPlane) return controlPlane;

    if (request.method === "GET") {
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
