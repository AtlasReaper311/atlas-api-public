export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

const BASE_SECURITY_HEADERS = Object.freeze({
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const DOCS_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

export function secureResponse(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  const contentType = secured.headers.get("content-type") || "";
  secured.headers.set(
    "content-security-policy",
    contentType.includes("text/html")
      ? DOCS_CONTENT_SECURITY_POLICY
      : API_CONTENT_SECURITY_POLICY,
  );
  return secured;
}

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

export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function bearerOk(request, secret) {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice(7), secret);
}

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
