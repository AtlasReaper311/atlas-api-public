import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { documentedEndpointKeys, handleDocs } from "../src/routes/docs.js";
import { handleDocsAsset } from "../src/routes/docs-shell.js";
import { DOCS_ICONS } from "../src/routes/docs-icons.generated.js";
import {
  DOCS_INTERFACE_FONT_ASSETS,
  DOCS_INTERFACE_FONT_STYLESHEET,
  DOCS_INTERFACE_STYLESHEET,
  DOCS_INTERFACE_VERSION,
} from "../src/routes/docs-interface.generated.js";
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
  for (const route of ["/work/", "/writing/", "/lab/", "/systems/", "/about/"]) {
    assert.ok(html.includes(`https://atlas-systems.uk${route}`));
  }
  assert.match(html, /class="atlas-global-header api-global-header"/);
  assert.match(html, /class="atlas-bottom-nav api-bottom-nav" aria-label="Mobile navigation"/);
  assert.match(html, /class="atlas-product-strip api-product-strip"/);
  assert.match(html, /data-estate-search-open/);
  assert.match(html, /data-estate-status/);
  assert.match(html, /data-state="checking"/);
  assert.match(html, /data-estate-status-label>Checking</);
  assert.match(html, /rel="canonical" href="https:\/\/api\.atlas-systems\.uk\/v1\/docs"/);
  assert.match(html, /property="og:image:alt"/);
  assert.match(html, /href="\/v1\/docs\/assets\/favicon\.ico"/);
  assert.match(html, /href="\/v1\/docs\/assets\/fonts\.css"/);
  assert.match(html, /href="\/v1\/docs\/assets\/interface-kit\.css"/);
  assert.match(html, /src="\/v1\/docs\/assets\/shell\.js"/);
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
});

test("docs expose purpose-specific route escape and readable tables", () => {
  assert.match(html, /Atlas Systems \/\/ Public API/);
  assert.match(html, /class="atlas-table-wrap table-wrap" tabindex="0"/);
  assert.match(html, /<pre tabindex="0" aria-label="Quick start commands/);
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
  assert.match(script, /operational: "Operational"/);
  assert.match(script, /return \["operational", detail\]/);
  assert.doesNotMatch(script, /return \["nominal", detail\]/);
  assert.match(script, /noopener noreferrer/);
  assert.doesNotMatch(script, /corpus\.atlas-systems\.uk/);
});

test("pinned Interface V2 stylesheet is repository-local and fingerprinted", async () => {
  assert.equal(DOCS_INTERFACE_VERSION, "0.2.0");
  assert.equal(
    DOCS_INTERFACE_STYLESHEET.sha256,
    "514a046dc5aa9a304778515a7d008afd58b3512f18bb58bbaa88de807e92bb44",
  );
  const asset = handleDocsAsset("/v1/docs/assets/interface-kit.css");
  assert.ok(asset instanceof Response);
  assert.equal(asset.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(
    asset.headers.get("x-atlas-interface-sha256"),
    DOCS_INTERFACE_STYLESHEET.sha256,
  );
  const stylesheet = await asset.text();
  assert.match(stylesheet, /Atlas Interface Kit v0\.2\.0/);
  assert.match(stylesheet, /\.atlas-global-header/);
  assert.match(stylesheet, /\.atlas-bottom-nav/);
  assert.doesNotMatch(stylesheet, /https?:\/\//);
});

test("docs serve the pinned local font stylesheet and immutable WOFF2 files", async () => {
  const stylesheetAsset = handleDocsAsset("/v1/docs/assets/fonts.css");
  assert.ok(stylesheetAsset instanceof Response);
  assert.equal(stylesheetAsset.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(
    stylesheetAsset.headers.get("x-atlas-interface-sha256"),
    DOCS_INTERFACE_FONT_STYLESHEET.sha256,
  );
  const stylesheet = await stylesheetAsset.text();
  assert.match(stylesheet, /@font-face/);
  assert.match(stylesheet, /\/v1\/docs\/assets\/fonts\//);
  assert.doesNotMatch(stylesheet, /https?:\/\//);

  const routes = Object.keys(DOCS_INTERFACE_FONT_ASSETS);
  assert.equal(routes.length, 4);
  for (const route of routes) {
    const asset = handleDocsAsset(route);
    assert.ok(asset instanceof Response);
    assert.equal(asset.headers.get("content-type"), "font/woff2");
    assert.match(asset.headers.get("cache-control"), /immutable/);
    assert.match(asset.headers.get("x-atlas-interface-sha256"), /^[a-f0-9]{64}$/);
    assert.ok((await asset.arrayBuffer()).byteLength > 0);
  }
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
