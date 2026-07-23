import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { documentedEndpointKeys, handleDocs } from "../src/routes/docs.js";
import { handleDocsAsset } from "../src/routes/docs-shell.js";
import { DOCS_ICONS } from "../src/routes/docs-icons.generated.js";
import { buildOpenApi } from "../src/openapi-trace.js";

const response = handleDocs();
const html = await response.text();

test("human API docs remain rendered from the OpenAPI authority", () => {
  const spec = buildOpenApi();
  const expected = Object.entries(spec.paths)
    .flatMap(([path, item]) => ["get", "post", "put", "patch", "delete"]
      .filter((method) => item[method] && path !== "/v1" && path !== "/v1/docs")
      .map((method) => `${method.toUpperCase()} ${path}`));
  assert.deepEqual(documentedEndpointKeys(spec), expected);
  for (const key of expected) {
    const [, path] = key.split(" ", 2);
    assert.match(html, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("docs have the global header, search, status, metadata, and local icons", () => {
  for (const route of ["/work/", "/writing/", "/lab/", "/about/"]) {
    assert.ok(html.includes(`https://atlas-systems.uk${route}`));
  }
  assert.match(html, /data-estate-search-open/);
  assert.match(html, /data-estate-status/);
  assert.match(html, /rel="canonical" href="https:\/\/api\.atlas-systems\.uk\/v1\/docs"/);
  assert.match(html, /property="og:image:alt"/);
  assert.match(html, /href="\/v1\/docs\/assets\/favicon\.ico"/);
  assert.match(html, /src="\/v1\/docs\/assets\/shell\.js"/);
});

test("docs expose purpose-specific route escape and readable tables", () => {
  assert.match(html, /Atlas Systems \/\/ Public API/);
  assert.match(html, /class="table-wrap"/);
  assert.match(html, /Estate home/);
  assert.match(html, /Status/);
});

test("docs shell script is local and consumes only bounded public APIs", async () => {
  const asset = handleDocsAsset("/v1/docs/assets/shell.js");
  assert.ok(asset instanceof Response);
  const script = await asset.text();
  assert.match(script, /const statusUrl = "\/v1\/stats"/);
  assert.match(script, /const searchUrl = "\/v1\/search"/);
  assert.match(script, /1200000/);
  assert.match(script, /noopener noreferrer/);
  assert.doesNotMatch(script, /corpus\.atlas-systems\.uk/);
});

test("machine endpoint authority is not expanded with presentation assets", () => {
  const index = fs.readFileSync("src/index.js", "utf8");
  assert.match(index, /const docsAsset = handleDocsAsset\(path\)/);
  assert.match(index, /case "\/v1\/openapi\.json"/);
  assert.match(index, /case "\/v1\/trace"/);
  assert.match(index, /case "\/v1\/reliability"/);
  assert.doesNotMatch(index, /case "\/v1\/docs\/assets\/favicon\.ico"/);
});

test("preview URLs are enabled without changing production routes", () => {
  const wrangler = fs.readFileSync("wrangler.toml", "utf8");
  assert.match(wrangler, /^preview_urls = true$/m);
  assert.match(wrangler, /api\.atlas-systems\.uk\/v1\*/);
  assert.doesNotMatch(wrangler, /interface-pr-/);
});

test("generated local icon assets are served when embedded", async () => {
  assert.equal(handleDocsAsset("/v1/docs/assets/not-found.png"), null);
  const routes = Object.keys(DOCS_ICONS);
  if (routes.length === 0) return;
  assert.equal(routes.length, 7);
  for (const route of routes) {
    const asset = handleDocsAsset(route);
    assert.ok(asset instanceof Response);
    assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
    assert.ok((await asset.arrayBuffer()).byteLength > 0);
  }
});
