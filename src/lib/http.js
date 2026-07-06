/**
 * Shared HTTP helpers for the /v1 surface.
 *
 * Response bodies are flat JSON documents carrying `ok` and
 * `generated_at`; errors add `error` and an optional `hint`. CORS is
 * wide open by design: the surface is public and read-only, and the two
 * authed ingest routes are protected by bearer keys, not by origin.
 */

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

export function errorResponse(status, message, hint) {
  const body = { ok: false, error: message, generated_at: nowIso() };
  if (hint) body.hint = hint;
  return json(body, status);
}

export async function readJson(request, maxBytes = 32 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("body too large");
  return JSON.parse(text);
}

/**
 * Constant-time comparison for bearer keys; plain string equality leaks
 * match length through timing. Same pattern as atlas-notify.
 */
export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function bearerOk(request, secret) {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice(7), secret);
}

/**
 * The Workers rate limit binding counts per colo; that is the
 * documented tradeoff for a zero-dependency limiter at this scale. A
 * missing binding (local dev, tests) fails open rather than blocking
 * development; enforcement status is reported so callers can tell.
 */
export async function rateLimit(binding, key) {
  if (!binding || typeof binding.limit !== "function") {
    return { allowed: true, enforced: false };
  }
  try {
    const { success } = await binding.limit({ key });
    return { allowed: success, enforced: true };
  } catch {
    return { allowed: true, enforced: false };
  }
}

export function tooMany() {
  return errorResponse(
    429,
    "rate limit exceeded",
    "limits are per client IP per minute; see /v1/docs",
  );
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "0.0.0.0";
}
