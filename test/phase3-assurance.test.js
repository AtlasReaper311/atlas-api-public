import assert from "node:assert/strict";
import test from "node:test";

import { handlePublicDocs } from "../src/index.js";

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
