/**
 * /v1/docs: documentation for strangers, served from the Worker itself.
 *
 * The Worker owning its own docs means the API surface and its
 * documentation deploy atomically; a site-hosted page can drift a
 * deploy behind. Zero client JavaScript on purpose: a docs page that
 * needs a framework to show eleven endpoints would say the wrong thing
 * about the estate. Tokens come from atlas-brand.md verbatim.
 */

import { buildOpenApi } from "../openapi.js";

const CSS = `
:root{--bg:#0a0a0f;--bg-1:#111118;--bg-2:#1a1a24;--border:rgba(255,255,255,0.08);--border-hi:rgba(255,255,255,0.16);--text:#e8e8e0;--text-dim:#aaa9a0;--text-faint:#555560;--accent:#f5a623;--accent-dim:rgba(245,166,35,0.12);--green:#4ade80;--red:#e24b4a}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:400 14px/1.6 "IBM Plex Mono",monospace;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:80px 80px}
main{max-width:860px;margin:0 auto;padding:48px 24px 96px}
h1{font:400 34px/1.2 "DM Serif Display",Georgia,serif;margin:8px 0 4px}
h2{font:400 22px/1.3 "DM Serif Display",Georgia,serif;margin:48px 0 12px;color:var(--text)}
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

function endpointCard(e) {
  const methodClass = e.method === "GET" ? "get" : "post";
  const tag = e.internal ? '<span class="tag">internal, bearer</span>' : "";
  const params = e.params
    ? `<p class="params">${e.params}</p>`
    : "";
  return `<div class="endpoint">
  <div class="sig"><span class="method ${methodClass}">${e.method}</span><span class="path">${e.path}</span>${tag}</div>
  <p>${e.description}</p>${params}
</div>`;
}

const ENDPOINTS = [
  {
    method: "GET",
    path: "/v1/registry",
    description:
      "Every Worker in the estate with its self-declared <code>/_meta</code> document, rebuilt hourly and reshaped into a stable public form. This shape is the versioning promise: it holds whatever the registry does internally.",
  },
  {
    method: "GET",
    path: "/v1/search",
    description:
      "Semantic search over the estate's own documentation: architecture decisions, READMEs, case studies. Each request runs a real embedding on local hardware, which is why the limit is tight.",
    params: "<code>q</code> required, 500 chars max &nbsp;&middot;&nbsp; <code>top_k</code> 1 to 10, default 5",
  },
  {
    method: "GET",
    path: "/v1/stats",
    description:
      "Repository totals, component health, and uptime measured from live probes inside a rolling window. The response says when measurement began; there is no invented history.",
  },
  {
    method: "GET",
    path: "/v1/infra/status",
    description:
      "The current verdict from the sentinel pipeline: Ollama reachability, corpus health, the RAG path end to end, WSL2 IP drift. A silent sentinel reads as down, not as its last good report.",
  },
  {
    method: "GET",
    path: "/v1/rag/stats",
    description:
      "Query counts and timestamps only. Aggregate numbers are safe to publish; fragments of visitor queries are not, and client IPs never enter the pipeline at all.",
  },
  {
    method: "GET",
    path: "/v1/badge/status",
    description:
      "A shields-flat SVG reading N/M operational across five probed components. Sixty second cache; embeds cleanly in a README.",
  },
  {
    method: "GET",
    path: "/v1/openapi.json",
    description: "The OpenAPI 3.0 document for this surface. CI walks every path in it against the router, so it cannot silently drift.",
  },
  {
    method: "POST",
    path: "/v1/infra/report",
    internal: true,
    description:
      "Observation ingest from <code>specular-sentinel</code>. Documented for completeness; without the bearer key it answers 401.",
  },
  {
    method: "POST",
    path: "/v1/rag/report",
    internal: true,
    description:
      "Hourly query summaries from <code>atlas-corpus</code>. Hours with activity relay to a private channel; quiet hours just update the card.",
  },
];

export function handleDocs() {
  const spec = buildOpenApi();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas Systems public API</title>
<meta name="description" content="Versioned public API for the Atlas Systems estate: registry, RAG search, live infra health, stats, and a status badge.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<main>
<div class="crumb">atlas systems // api</div>
<h1>Public API, v1</h1>
<p class="sub">version ${spec.info.version} &middot; <a href="/v1/openapi.json">openapi.json</a> &middot; <a href="https://github.com/AtlasReaper311/atlas-api-public">source</a> &middot; <a href="https://atlas-systems.uk">atlas-systems.uk</a></p>

<p>This is the read surface of a live homelab estate: a Worker registry that rebuilds itself hourly, semantic search over the estate's own documentation, and health telemetry from the machine that runs the models. Everything here is real infrastructure reporting on itself, and it is honest about its nature: the RAG stack runs on hardware that sleeps, and when it does, the API says so instead of pretending to be a cloud service.</p>

<h2>Quick start</h2>
<pre><code>curl https://api.atlas-systems.uk/v1/search?q=tunnel
curl https://api.atlas-systems.uk/v1/infra/status
curl https://api.atlas-systems.uk/v1/stats</code></pre>

<h2>Endpoints</h2>
${ENDPOINTS.map(endpointCard).join("\n")}

<h2>Rate limits</h2>
<table>
<tr><th>Scope</th><th>Limit</th><th>Why</th></tr>
<tr><td>General, per IP</td><td>60 / minute</td><td>Edge reads are cheap; this just stops abuse</td></tr>
<tr><td><code>/v1/search</code>, per IP</td><td>10 / minute</td><td>Every hit costs a real embedding on local hardware</td></tr>
</table>
<p>Counters are per Cloudflare colo, which is the documented tradeoff of a zero-dependency limiter at this scale. A 429 clears within a minute.</p>

<h2>CORS and versioning</h2>
<p>Every <code>GET</code> endpoint sends <code>access-control-allow-origin: *</code>; call this surface from a browser freely. The <code>/v1</code> prefix is a contract: response shapes documented in <a href="/v1/openapi.json">the spec</a> will not change under this prefix. Anything breaking becomes <code>/v2</code>.</p>

<div class="foot">Part of <a href="https://atlas-systems.uk">atlas-systems.uk</a> &middot; runs on Cloudflare Workers &middot; reports on hardware in a spare room</div>
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
