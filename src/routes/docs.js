/**
 * /v1/docs: human documentation rendered from the OpenAPI contract.
 *
 * The OpenAPI document is the endpoint authority. This page contains no
 * parallel endpoint array, so adding or removing a documented route changes
 * the HTML catalogue automatically in the same deployment.
 */

import { buildOpenApi } from "../openapi.js";

const CSS = `
:root{--bg:#0a0a0f;--bg-1:#111118;--bg-2:#1a1a24;--border:rgba(255,255,255,0.08);--border-hi:rgba(255,255,255,0.16);--text:#e8e8e0;--text-dim:#aaa9a0;--text-faint:#555560;--accent:#f5a623;--accent-dim:rgba(245,166,35,0.12);--green:#4ade80;--red:#e24b4a}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:400 14px/1.6 "IBM Plex Mono",monospace;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:80px 80px}
main{max-width:860px;margin:0 auto;padding:48px 24px 96px}
h1{font:400 34px/1.2 "DM Serif Display",Georgia,serif;margin:8px 0 4px}
h2{font:400 22px/1.3 "DM Serif Display",Georgia,serif;margin:48px 0 12px;color:var(--text)}
h3{font-size:14px;font-weight:500;margin:0}
p{color:var(--text-dim);margin:0 0 12px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{background:var(--bg-2);padding:1px 5px;border-radius:3px;font-size:13px}
pre{background:var(--bg-1);border:1px solid var(--border);border-radius:6px;padding:14px 16px;overflow-x:auto;margin:12px 0;font-size:13px;line-height:1.5}
pre code{background:none;padding:0}
.crumb{color:var(--text-faint);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.sub{color:var(--text-faint);margin-bottom:32px}
.endpoint{background:var(--bg-1);border:1px solid var(--border);border-radius:6px;padding:16px 18px;margin:0 0 14px}
.endpoint:hover{border-color:var(--border-hi)}
.sig{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.method{font-size:11px;font-weight:500;letter-spacing:.06em;padding:2px 8px;border-radius:3px}
.get{color:var(--green);border:1px solid var(--green)}
.post{color:var(--text-faint);border:1px solid var(--text-faint)}
.path{font-weight:500}
.tag{font-size:11px;color:var(--text-faint);border:1px solid var(--border);padding:2px 8px;border-radius:3px}
.endpoint p{margin:0;font-size:13px}
.params{margin:10px 0 0;font-size:13px;color:var(--text-dim)}
.params code{color:var(--text)}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
td,th{border:1px solid var(--border);padding:6px 10px;text-align:left;color:var(--text-dim)}
th{color:var(--text);font-weight:500}
.foot{margin-top:64px;padding-top:16px;border-top:1px solid var(--border);color:var(--text-faint);font-size:12px}
`;

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function renderParameters(parameters = []) {
  if (!parameters.length) return "";

  const rendered = parameters
    .map((parameter) => {
      const requirement = parameter.required ? "required" : "optional";
      const schema = parameter.schema || {};
      const bounds = [
        schema.minimum !== undefined ? `min ${schema.minimum}` : "",
        schema.maximum !== undefined ? `max ${schema.maximum}` : "",
        schema.maxLength !== undefined
          ? `${schema.maxLength} chars max`
          : "",
        schema.default !== undefined
          ? `default ${schema.default}`
          : "",
      ]
        .filter(Boolean)
        .join(", ");

      return (
        `<code>${escapeHtml(parameter.name)}</code> ${requirement}` +
        (bounds ? `, ${escapeHtml(bounds)}` : "")
      );
    })
    .join(" &nbsp;&middot;&nbsp; ");

  return `<p class="params">${rendered}</p>`;
}

function endpointEntries(spec) {
  return Object.entries(spec.paths || {})
    .flatMap(([path, pathItem]) =>
      METHOD_ORDER.flatMap((method) => {
        const operation = pathItem?.[method];

        if (!operation) return [];

        return [
          {
            method: method.toUpperCase(),
            path,
            summary: operation.summary || "",
            description:
              operation.description ||
              operation.summary ||
              "Documented API operation.",
            parameters: operation.parameters || [],
            internal:
              Array.isArray(operation.security) &&
              operation.security.length > 0,
          },
        ];
      }),
    )
    .filter(
      (entry) =>
        entry.path !== "/v1" &&
        entry.path !== "/v1/docs",
    );
}

export function documentedEndpointKeys(spec = buildOpenApi()) {
  return endpointEntries(spec).map(
    (entry) => `${entry.method} ${entry.path}`,
  );
}

function endpointCard(endpoint) {
  const methodClass =
    endpoint.method === "GET" ? "get" : "post";

  const internal = endpoint.internal
    ? '<span class="tag">internal, bearer</span>'
    : "";

  return `<article class="endpoint">
  <div class="sig">
    <span class="method ${methodClass}">${escapeHtml(endpoint.method)}</span>
    <span class="path">${escapeHtml(endpoint.path)}</span>
    ${internal}
  </div>
  <h3>${escapeHtml(endpoint.summary)}</h3>
  <p>${escapeHtml(endpoint.description)}</p>
  ${renderParameters(endpoint.parameters)}
</article>`;
}

export function handleDocs() {
  const spec = buildOpenApi();
  const endpoints = endpointEntries(spec);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas Systems public API</title>
<meta name="description" content="Versioned public API for the Atlas Systems estate: topology, repository inventory, registry, assurance evidence, RAG search, and live infrastructure state.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<main>
<div class="crumb">atlas systems // api</div>
<h1>Public API, v1</h1>
<p class="sub">version ${escapeHtml(spec.info.version)} &middot; <a href="/v1/openapi.json">openapi.json</a> &middot; <a href="https://github.com/AtlasReaper311/atlas-api-public">source</a> &middot; <a href="https://atlas-systems.uk">atlas-systems.uk</a></p>

<p>This is the versioned read surface of the Atlas Systems estate. It publishes the public repository and component topology, the live Worker registry, assurance evidence, semantic search over the estate corpus, and health telemetry from the machine that runs the local models. Runtime state and declared source inventory are separate on purpose: a public repository can exist without pretending to be a deployed service.</p>

<h2>Quick start</h2>
<pre><code>curl https://api.atlas-systems.uk/v1/topology
curl https://api.atlas-systems.uk/v1/registry
curl https://api.atlas-systems.uk/v1/search?q=tunnel
curl https://api.atlas-systems.uk/v1/evidence</code></pre>

<h2>Endpoints</h2>
${endpoints.map(endpointCard).join("\n")}

<h2>Rate limits</h2>
<table>
<tr><th>Scope</th><th>Limit</th><th>Why</th></tr>
<tr><td>General, per IP</td><td>60 / minute</td><td>Edge reads are cheap; this stops basic abuse</td></tr>
<tr><td><code>/v1/search</code>, per IP</td><td>10 / minute</td><td>Every hit costs a real embedding on local hardware</td></tr>
</table>
<p>Counters are per Cloudflare colo, which is the documented tradeoff of a zero-dependency limiter at this scale. A 429 clears within a minute.</p>

<h2>CORS and versioning</h2>
<p>Every public <code>GET</code> endpoint sends <code>access-control-allow-origin: *</code>. The <code>/v1</code> prefix is the response-shape contract. Additive endpoints and fields can ship within v1; breaking shape changes require <code>/v2</code>.</p>

<div class="foot">Part of <a href="https://atlas-systems.uk">atlas-systems.uk</a> &middot; runs on Cloudflare Workers &middot; reports on a live homelab estate</div>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
