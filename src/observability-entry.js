import worker from "./index.js";

const DORA_COMPONENT = "atlas_dora";
const DORA_SOURCE = "service-binding:atlas-dora/dora/health";
const DORA_URL = "https://atlas-dora/dora/health";
const PROBE_TIMEOUT_MS = 5000;
const PROBE_CACHE_MS = 60 * 1000;
const doraCache = new WeakMap();

function measuredAt(body, fallback) {
  const candidate = body?.at ?? body?.checked_at ?? body?.generated_at;
  const parsed = Date.parse(candidate ?? "");
  return Number.isFinite(parsed) ? candidate : fallback;
}

async function probeDoraBinding(binding, now) {
  const started = Date.now();
  try {
    const response = await binding.fetch(DORA_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const body = await response.json().catch(() => null);
    const observedAt = measuredAt(body, now());

    if (!response.ok) {
      return {
        ok: false,
        status: "down",
        detail: `http ${response.status}`,
        evidence_source: DORA_SOURCE,
        measured_at: observedAt,
        latency_ms: latencyMs,
      };
    }

    if (body?.ok !== true) {
      return {
        ok: false,
        status: "unknown",
        detail: "reachable but health contract is invalid",
        evidence_source: DORA_SOURCE,
        measured_at: observedAt,
        latency_ms: latencyMs,
      };
    }

    return {
      ok: true,
      status: "healthy",
      detail: "health contract reports ok",
      evidence_source: DORA_SOURCE,
      measured_at: observedAt,
      latency_ms: latencyMs,
    };
  } catch (error) {
    return {
      ok: false,
      status: "down",
      detail: String(error?.message ?? error).slice(0, 120),
      evidence_source: DORA_SOURCE,
      measured_at: now(),
      latency_ms: Date.now() - started,
    };
  }
}

export async function probeDora(
  env,
  {
    now = () => new Date().toISOString(),
    nowMs = () => Date.now(),
  } = {},
) {
  const binding = env.ATLAS_DORA;
  if (!binding || typeof binding.fetch !== "function") {
    return {
      ok: false,
      status: "unknown",
      detail: "binding missing",
      evidence_source: DORA_SOURCE,
      measured_at: null,
      latency_ms: null,
    };
  }

  const currentMs = nowMs();
  const cached = doraCache.get(binding);
  if (cached && cached.expiresAt > currentMs) return cached.value;

  const value = await probeDoraBinding(binding, now);
  doraCache.set(binding, {
    expiresAt: currentMs + PROBE_CACHE_MS,
    value,
  });
  return value;
}

export function augmentStatsPayload(payload, dora) {
  if (!payload || typeof payload !== "object") return payload;

  const estate = payload.estate;
  if (!estate || typeof estate !== "object") return payload;

  estate.components = estate.components && typeof estate.components === "object"
    ? estate.components
    : {};
  estate.component_details = estate.component_details && typeof estate.component_details === "object"
    ? estate.component_details
    : {};

  estate.components[DORA_COMPONENT] = dora?.ok === true;
  estate.component_details[DORA_COMPONENT] = {
    status: dora?.status ?? "unknown",
    detail: dora?.detail ?? "DORA health evidence unavailable",
    latency_ms: Number.isFinite(dora?.latency_ms) ? dora.latency_ms : null,
    evidence_source: dora?.evidence_source ?? DORA_SOURCE,
    measured_at: dora?.measured_at ?? null,
  };
  estate.operational = Object.values(estate.components).filter((value) => value === true).length;
  estate.total_components = Object.keys(estate.components).length;

  if (payload.uptime?.components && typeof payload.uptime.components === "object") {
    payload.uptime.components[DORA_COMPONENT] ??= null;
  }

  return payload;
}

async function handleStats(request, env, ctx) {
  const response = await worker.fetch(request, env, ctx);
  if (!response.ok) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  const dora = await probeDora(env);
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(JSON.stringify(augmentStatsPayload(payload, dora)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "GET" && path === "/v1/stats") {
      return handleStats(request, env, ctx);
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    return worker.scheduled(event, env, ctx);
  },
};
