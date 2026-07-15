import { bearerOk, errorResponse, json, nowIso, readJson } from "../lib/http.js";

const KINDS = new Set(["conformance", "chaos"]);
const HISTORY_LIMIT = 24;

function latestKey(kind) {
  return `evidence:${kind}:latest:v1`;
}

function historyKey(kind) {
  return `evidence:${kind}:history:v1`;
}

function expectedSchema(kind) {
  return kind === "conformance"
    ? "atlas-estate-conformance-report/v1"
    : "atlas-chaos-report-set/v1";
}

function canonicalWithoutFingerprint(document) {
  const clone = structuredClone(document);
  delete clone.fingerprint;
  return JSON.stringify(sortValue(clone));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateDocument(kind, document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, error: "report must be a JSON object" };
  }
  if (document.schema !== expectedSchema(kind)) {
    return { ok: false, error: `schema must be ${expectedSchema(kind)}` };
  }
  if (!document.generated_at || Number.isNaN(Date.parse(document.generated_at))) {
    return { ok: false, error: "generated_at must be an ISO timestamp" };
  }
  if (!/^[0-9a-f]{64}$/.test(String(document.fingerprint || ""))) {
    return { ok: false, error: "fingerprint must be a lowercase SHA-256 hex digest" };
  }
  const computed = await sha256Hex(canonicalWithoutFingerprint(document));
  if (computed !== document.fingerprint) {
    return { ok: false, error: "fingerprint does not match canonical report content" };
  }
  return { ok: true };
}

function summary(kind, document) {
  if (!document) return null;
  if (kind === "conformance") {
    return {
      fingerprint: document.fingerprint,
      generated_at: document.generated_at,
      estate_score: document.summary?.estate_score ?? null,
      errors: document.summary?.errors ?? null,
      warnings: document.summary?.warnings ?? null,
      repositories_scanned: document.summary?.repositories_scanned ?? null,
    };
  }
  return {
    fingerprint: document.fingerprint,
    generated_at: document.generated_at,
    passed: document.passed ?? null,
    experiments: document.summary?.experiments ?? null,
    failed: document.summary?.failed ?? null,
  };
}

async function readLatest(env, kind) {
  return env.ATLAS_PUBLIC_KV.get(latestKey(kind), "json");
}

async function readHistory(env, kind) {
  return (await env.ATLAS_PUBLIC_KV.get(historyKey(kind), "json")) || [];
}

export async function handleEvidenceIndex(_request, env) {
  const entries = {};
  for (const kind of KINDS) {
    entries[kind] = summary(kind, await readLatest(env, kind));
  }
  return json(
    {
      ok: true,
      schema: "atlas-public-evidence-index/v1",
      evidence: entries,
      generated_at: nowIso(),
    },
    200,
    { "cache-control": "public, max-age=30" },
  );
}

export async function handleEvidenceGet(request, env, kind) {
  if (!KINDS.has(kind)) return errorResponse(404, "unknown evidence kind");
  const url = new URL(request.url);
  if (url.searchParams.get("history") === "1") {
    const items = await readHistory(env, kind);
    return json(
      {
        ok: true,
        schema: "atlas-public-evidence-history/v1",
        kind,
        count: items.length,
        items,
        generated_at: nowIso(),
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  }
  const document = await readLatest(env, kind);
  if (!document) {
    return errorResponse(
      503,
      "no evidence has been published",
      "the producing workflow must complete and EVIDENCE_REPORT_KEY must be configured",
    );
  }
  return json(
    { ok: true, kind, report: document, generated_at: nowIso() },
    200,
    { "cache-control": "public, max-age=30" },
  );
}

export async function handleEvidenceReport(request, env, kind) {
  if (!KINDS.has(kind)) return errorResponse(404, "unknown evidence kind");
  if (!bearerOk(request, env.EVIDENCE_REPORT_KEY)) {
    return errorResponse(401, "missing or incorrect bearer key");
  }

  let document;
  try {
    document = await readJson(request, 512 * 1024);
  } catch (error) {
    return errorResponse(400, error.message === "body too large" ? error.message : "body is not valid JSON");
  }

  const validation = await validateDocument(kind, document);
  if (!validation.ok) return errorResponse(422, validation.error);

  const current = await readLatest(env, kind);
  if (current?.fingerprint === document.fingerprint) {
    return json({
      ok: true,
      kind,
      changed: false,
      fingerprint: document.fingerprint,
      generated_at: nowIso(),
    });
  }

  await env.ATLAS_PUBLIC_KV.put(latestKey(kind), JSON.stringify(document));
  const history = await readHistory(env, kind);
  history.unshift({
    fingerprint: document.fingerprint,
    generated_at: document.generated_at,
    stored_at: nowIso(),
    summary: summary(kind, document),
  });
  const deduplicated = history.filter(
    (item, index, array) =>
      array.findIndex((candidate) => candidate.fingerprint === item.fingerprint) === index,
  );
  if (deduplicated.length > HISTORY_LIMIT) deduplicated.length = HISTORY_LIMIT;
  await env.ATLAS_PUBLIC_KV.put(historyKey(kind), JSON.stringify(deduplicated));

  return json({
    ok: true,
    kind,
    changed: true,
    fingerprint: document.fingerprint,
    generated_at: nowIso(),
  });
}
