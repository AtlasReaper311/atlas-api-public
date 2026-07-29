import assert from "node:assert/strict";
import test from "node:test";

import { documentedEndpointKeys, handleDocs } from "../src/routes/docs.js";

test("OpenAPI remains the documentation endpoint authority", async () => {
  const keys = documentedEndpointKeys();
  assert.ok(keys.length > 0);
  assert.equal(new Set(keys).size, keys.length);

  const response = handleDocs();
  const html = await response.text();
  for (const key of keys) {
    const [method, path] = key.split(" ");
    assert.match(html, new RegExp(`>${method}<`));
    assert.ok(html.includes(`>${path}<`), path);
  }
});

test("Public API docs expose the governed product footer", async () => {
  const response = handleDocs();
  const html = await response.text();
  const match = html.match(
    /<footer class="atlas-footer atlas-footer--product api-footer"[\s\S]*?<\/footer>/,
  );
  assert.ok(match);
  const footer = match[0];
  assert.match(footer, /aria-label="Public API product footer"/);
  assert.match(footer, /atlas-footer__identity/);
  assert.match(footer, /atlas-footer__context/);
  assert.match(footer, /atlas-footer__evidence/);
  assert.match(footer, /atlas-footer__escape/);
  assert.match(footer, /OpenAPI contract/);
  assert.match(footer, /Atlas Systems home/);
  assert.doesNotMatch(footer, /atlas-footer__sequence/);
  assert.doesNotMatch(footer, /article-footer/);
});

test("Public API footer keeps the v0.4.0 responsive contract locally", async () => {
  const html = await handleDocs().text();
  assert.match(html, /grid-template-areas:"identity escape" "context context" "evidence evidence"/);
  assert.match(html, /min-height:var\(--atlas-touch-min\)/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /@media\(max-width:767px\)/);
});
