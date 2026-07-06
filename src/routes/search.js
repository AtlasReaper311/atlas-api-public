/**
 * /v1/search: the corpus RAG search, proxied for strangers.
 *
 * The direct tunnel path (corpus.atlas-systems.uk/search) keeps its own
 * in-app per-IP limit; this proxied path is limited at the edge instead
 * (RL_SEARCH, ten per minute per IP) because every hit costs a real
 * embedding on the 5070. Visitor identity stops here by design: no
 * forwarded IP headers, so the corpus only ever sees this Worker.
 *
 * Failure honesty: the RAG stack lives on a machine that sleeps. A 503
 * from here says so and points at /v1/infra/status instead of
 * pretending the corpus is a cloud service.
 */

import {
  json,
  errorResponse,
  rateLimit,
  tooMany,
  clientIp,
  nowIso,
} from "../lib/http.js";

export async function handleSearch(request, env) {
  const rl = await rateLimit(env.RL_SEARCH, `s:${clientIp(request)}`);
  if (!rl.allowed) return tooMany();

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) {
    return errorResponse(400, "missing query parameter q", "GET /v1/search?q=tunnel");
  }
  if (q.length > 500) {
    return errorResponse(422, "query too long; 500 character cap, matching the corpus");
  }
  const topKRaw = parseInt(url.searchParams.get("top_k") || "5", 10);
  const topK = Math.min(Math.max(Number.isFinite(topKRaw) ? topKRaw : 5, 1), 10);

  let upstream;
  try {
    upstream = await fetch(
      `${env.CORPUS_ORIGIN}/search?q=${encodeURIComponent(q)}&top_k=${topK}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "atlas-api-public/1.0" },
      },
    );
  } catch {
    return errorResponse(
      503,
      "corpus unreachable",
      "the RAG stack runs on SPECULAR-CORE; if the machine is asleep this endpoint sleeps with it; see /v1/infra/status",
    );
  }

  if (upstream.status === 429) return tooMany();
  if (!upstream.ok) {
    return errorResponse(502, `corpus answered ${upstream.status}`);
  }

  const doc = await upstream.json();
  return json({
    ok: true,
    query: doc.query,
    count: Array.isArray(doc.hits) ? doc.hits.length : 0,
    took_ms: doc.took_ms,
    hits: doc.hits,
    source: "atlas-corpus",
    generated_at: nowIso(),
  });
}
