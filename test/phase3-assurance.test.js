import assert from "node:assert/strict";
import test from "node:test";

import worker, { handlePublicDocs } from "../src/index.js";
import { META } from "../src/meta.js";

test("Public API docs expose a named product landmark", async () => {
  const response = await handlePublicDocs();
  const html = await response.text();
  assert.match(
    html,
    /<section class="atlas-product-strip api-product-strip" aria-label="Public API product identity">/,
  );
  assert.match(html, /<\/section>\s*<main>/);
  assert.doesNotMatch(html, /<div class="atlas-product-strip api-product-strip">/);
});

test("Public API discovery declares the security metadata route", async () => {
  assert.ok(
    META.endpoints.some(
      (endpoint) => endpoint.method === "GET" && endpoint.path === "/.well-known/security.txt",
    ),
  );

  const response = await worker.fetch(
    new Request("https://api.atlas-systems.uk/v1"),
    {},
    { waitUntil() {} },
  );
  const body = await response.json();
  assert.equal(body.security, "https://api.atlas-systems.uk/.well-known/security.txt");
});
