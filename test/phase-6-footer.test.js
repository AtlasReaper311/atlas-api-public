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

test("Public API docs expose a complete and bounded governed product footer", async () => {
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
  assert.equal((footer.match(/<a\b/g) || []).length, 4);
  assert.doesNotMatch(footer, /Systems directory/);
  assert.doesNotMatch(footer, /atlas-footer__sequence/);
  assert.doesNotMatch(footer, /article-footer/);
});

test("Public API footer keeps a single underlined rail and the v0.4.0 responsive contract locally", async () => {
  const html = await handleDocs().text();
  assert.match(html, /\.api-footer\{[\s\S]*display:flex/);
  assert.match(html, /flex-wrap:wrap/);
  assert.match(html, /margin-top:var\(--atlas-space-7\)/);
  assert.match(html, /padding:var\(--atlas-space-4\) 0/);
  assert.match(html, /text-decoration:underline/);
  assert.match(html, /min-width:var\(--atlas-touch-min\)/);
  assert.match(html, /min-height:var\(--atlas-touch-min\)/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /@media\(max-width:767px\)/);
  assert.match(html, /\.api-footer \.atlas-footer__identity\{[^}]*flex:0 0 auto/);
  assert.match(
    html,
    /\.api-footer \.atlas-footer__context,[\s\S]*?\.api-footer \.atlas-footer__escape\{[^}]*flex:0 0 auto/,
  );
});
