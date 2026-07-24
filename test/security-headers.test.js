import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { secureResponse } from "../src/lib/http.js";

const REQUIRED_HEADERS = {
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

test("public API responses receive the common security boundary", async () => {
  const response = secureResponse(
    new Response('{"ok":true}', {
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8",
      },
    }),
  );

  assert.equal(await response.text(), '{"ok":true}');
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
    assert.equal(response.headers.get(name), value, name);
  }
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
});

test("human documentation receives a route-specific browser policy", () => {
  const response = secureResponse(
    new Response("<!doctype html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
  const policy = response.headers.get("content-security-policy");

  assert.match(policy, /connect-src 'self'/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, /font-src 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /fonts\.(?:googleapis|gstatic)\.com/);
});

test("the Worker wraps every routed response at its fetch boundary", () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

  assert.match(source, /return secureResponse\(await routeRequest\(request, env, ctx\)\)/);
});
