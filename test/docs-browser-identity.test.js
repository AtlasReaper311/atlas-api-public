import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";
import { handleDocsNotFound } from "../src/routes/docs-error.js";

const env = {};
const ctx = { waitUntil() {} };

test("Public API docs expose one complete browser identity", async () => {
  const response = await worker.fetch(
    new Request("https://api.atlas-systems.uk/v1/docs", {
      headers: { accept: "text/html" },
    }),
    env,
    ctx,
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /<title>Public API \/\/ Atlas Systems<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/api\.atlas-systems\.uk\/v1\/docs"/);
  assert.match(html, /property="og:url" content="https:\/\/api\.atlas-systems\.uk\/v1\/docs"/);
  assert.match(html, /property="og:image" content="https:\/\/atlas-systems\.uk\/og\/api-docs\.png"/);
  assert.match(html, /name="twitter:image:alt" content="The Atlas Systems API\. \/\/ Atlas Systems"/);
  assert.match(html, /href="\/v1\/docs\/assets\/site\.webmanifest"/);
});

test("docs error renderer is noindex and outside the social graph", async () => {
  const response = handleDocsNotFound();
  const html = await response.text();

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(html, /<title>404 \/\/ Public API \/\/ Atlas Systems<\/title>/);
  assert.match(html, /name="robots" content="noindex, follow"/);
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /property="og:/);
  assert.doesNotMatch(html, /name="twitter:/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /href="\/v1\/docs">Open API docs<\/a>/);
  assert.match(html, /href="\/v1\/openapi\.json">Open OpenAPI<\/a>/);
});

test("unknown docs browser paths receive HTML without changing API fallbacks", async () => {
  const browser = await worker.fetch(
    new Request("https://api.atlas-systems.uk/v1/docs/not-a-page", {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "sec-fetch-mode": "navigate",
      },
    }),
    env,
    ctx,
  );
  assert.equal(browser.status, 404);
  assert.match(browser.headers.get("content-type"), /text\/html/);

  const machine = await worker.fetch(
    new Request("https://api.atlas-systems.uk/v1/docs/not-a-page", {
      headers: { accept: "application/json" },
    }),
    env,
    ctx,
  );
  assert.equal(machine.status, 404);
  assert.match(machine.headers.get("content-type"), /application\/json/);
  const payload = await machine.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "no such endpoint");
});

test("unknown machine API paths remain JSON even when under /v1", async () => {
  const response = await worker.fetch(
    new Request("https://api.atlas-systems.uk/v1/not-a-route", {
      headers: { accept: "text/html" },
    }),
    env,
    ctx,
  );
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /application\/json/);
});
