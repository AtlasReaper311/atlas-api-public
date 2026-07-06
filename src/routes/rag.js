/**
 * RAG Queries: the edge half of the corpus query pipeline.
 *
 * atlas-corpus logs queries to SQLite at the source (logging never
 * leaves the hot path's failure domain) and its hourly summariser POSTs
 * one document here. This module stores it as the last-known-good for
 * the site card and relays hours with activity to #rag-queries through
 * the atlas-notify envelope. Silence is signal: an hourly "0 queries"
 * ping is noise, so quiet hours update the card and skip Discord.
 *
 * Privacy boundary, enforced structurally: the summary may carry top
 * terms for the private Discord channel, but the public /v1/rag/stats
 * response never includes them. Aggregate counts are safe to publish;
 * fragments of visitor queries are not. IPs never existed in this
 * pipeline at all; the corpus logger is never handed one.
 */

import {
  json,
  errorResponse,
  readJson,
  bearerOk,
  nowIso,
} from "../lib/http.js";
import { notify } from "../lib/notify.js";

export const RAG_KEY = "rag:stats:v1";

function validateSummary(s) {
  if (!s || typeof s !== "object") return "not an object";
  if (!Number.isInteger(s.count) || s.count < 0) return "count";
  if (typeof s.window_start !== "string") return "window_start";
  if (typeof s.window_end !== "string") return "window_end";
  if (s.top_terms !== undefined && !Array.isArray(s.top_terms)) {
    return "top_terms";
  }
  return null;
}

export async function handleRagReport(request, env, ctx) {
  if (!bearerOk(request, env.RAG_REPORT_KEY)) {
    return errorResponse(401, "unauthorised");
  }
  let summary;
  try {
    summary = await readJson(request);
  } catch {
    return errorResponse(400, "invalid JSON body");
  }
  const problem = validateSummary(summary);
  if (problem) return errorResponse(422, `invalid summary: ${problem}`);

  const doc = {
    window_start: summary.window_start,
    window_end: summary.window_end,
    count: summary.count,
    top_terms: (summary.top_terms || [])
      .slice(0, 8)
      .map((t) => ({
        term: String(t.term ?? "").slice(0, 60),
        count: Number.isInteger(t.count) ? t.count : 0,
      }))
      .filter((t) => t.term),
    queries_today: Number.isInteger(summary.queries_today)
      ? summary.queries_today
      : null,
    queries_total: Number.isInteger(summary.queries_total)
      ? summary.queries_total
      : null,
    last_query_at: typeof summary.last_query_at === "string"
      ? summary.last_query_at
      : null,
    received_at: nowIso(),
  };

  await env.ATLAS_PUBLIC_KV.put(RAG_KEY, JSON.stringify(doc));

  const relayed = doc.count > 0;
  if (relayed) {
    ctx.waitUntil(
      notify(
        env,
        {
          level: "info",
          title: `RAG queries, last hour: ${doc.count}`,
          message: doc.top_terms.length
            ? "top terms: " +
              doc.top_terms.map((t) => `${t.term} (${t.count})`).join(", ")
            : "no recurring terms this hour",
          fields: {
            window: `${doc.window_start} to ${doc.window_end}`,
            today: String(doc.queries_today ?? "n/a"),
            all_time: String(doc.queries_total ?? "n/a"),
          },
        },
        "rag_queries",
      ),
    );
  }

  return json({ ok: true, stored: true, relayed, generated_at: nowIso() });
}

export async function readRagSummary(env) {
  try {
    const raw = await env.ATLAS_PUBLIC_KV.get(RAG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function handleRagStats(_request, env) {
  const summary = await readRagSummary(env);

  // Best-effort live merge: the corpus /stats endpoint is authoritative
  // while the machine is up; the KV summary is the last-known-good that
  // keeps the card honest while it is not. Four seconds is generous for
  // a tunnel round trip and short enough not to hang the card.
  let live = null;
  try {
    const res = await fetch(`${env.CORPUS_ORIGIN}/stats`, {
      signal: AbortSignal.timeout(4000),
      headers: { "user-agent": "atlas-api-public/1.0" },
    });
    if (res.ok) live = await res.json();
  } catch {
    live = null;
  }

  return json({
    ok: true,
    source: live ? "live" : summary ? "last-summary" : "none",
    queries_last_hour: live?.queries_last_hour ?? summary?.count ?? 0,
    queries_today: live?.queries_today ?? summary?.queries_today ?? 0,
    queries_total: live?.queries_total ?? summary?.queries_total ?? 0,
    last_query_at: live?.last_query_at ?? summary?.last_query_at ?? null,
    last_summary_at: summary?.received_at ?? null,
    privacy: "query text and counts only; client IPs are never logged",
    generated_at: nowIso(),
  });
}
