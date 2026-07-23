/**
 * /v1/docs: human documentation rendered from the OpenAPI contract.
 *
 * The OpenAPI document is the endpoint authority. This page contains no
 * parallel endpoint array, so adding or removing a documented route changes
 * the HTML catalogue automatically in the same deployment.
 */

import { buildOpenApi } from "../openapi-trace.js";

const CSS = `
:root{--bg:#0a0a0f;--bg-1:#111118;--bg-2:#1a1a24;--border:rgba(255,255,255,.08);--border-hi:rgba(255,255,255,.16);--text:#e8e8e0;--text-dim:#aaa9a0;--text-faint:#77776f;--accent:#f5a623;--accent-dim:rgba(245,166,35,.12);--green:#4ade80;--red:#e24b4a;--mono:"IBM Plex Mono",monospace;--serif:"DM Serif Display",Georgia,serif}
*{box-sizing:border-box;margin:0;padding:0}
html{color-scheme:dark;scroll-padding-top:112px}
body{background:var(--bg);color:var(--text);font:400 14px/1.65 var(--mono);background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:80px 80px;min-height:100vh}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.global-nav{position:sticky;top:0;z-index:30;min-height:56px;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0 clamp(1rem,5vw,3rem);border-bottom:1px solid var(--border);background:rgba(10,10,15,.93);backdrop-filter:blur(12px)}
.brand-cluster{display:inline-flex;align-items:center;gap:.75rem;min-width:0}.wordmark{color:var(--text);font-size:13px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.wordmark:hover{text-decoration:none}.wordmark span{color:var(--accent)}
.global-links{display:flex;align-items:center;list-style:none}.global-links a{display:flex;align-items:center;min-height:44px;padding:.35rem .8rem;color:var(--text-dim);font-size:11px;letter-spacing:.08em;text-transform:uppercase}.global-links a:hover,.global-links a:focus-visible{color:var(--text);text-decoration:none}
.estate-status{display:inline-flex;align-items:center;gap:.4rem;min-height:28px;padding:.2rem .55rem;border:1px solid var(--border);color:var(--text-dim);font-size:9px;line-height:1;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}.estate-status:hover,.estate-status:focus-visible{border-color:var(--border-hi);color:var(--text);text-decoration:none}.estate-status-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--text-faint)}.estate-status[data-state="nominal"] .estate-status-dot{background:var(--green);box-shadow:0 0 0 3px rgba(74,222,128,.12)}.estate-status[data-state="degraded"] .estate-status-dot,.estate-status[data-state="checking"] .estate-status-dot{background:var(--accent);box-shadow:0 0 0 3px rgba(245,166,35,.12)}.estate-status[data-state="unavailable"] .estate-status-dot{background:var(--red);box-shadow:0 0 0 3px rgba(226,75,74,.12)}
.search-trigger{display:inline-flex;align-items:center;gap:.45rem;min-height:36px;padding:.35rem .65rem;border:1px solid var(--border);background:transparent;color:var(--text-dim);font:inherit;font-size:10px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}.search-trigger:hover,.search-trigger:focus-visible{color:var(--text);border-color:var(--border-hi)}.search-trigger svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}.search-trigger kbd{color:var(--text-faint);font:inherit;font-size:8px}
.product-strip{position:relative;z-index:1;min-height:42px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:1rem;padding:.65rem clamp(1rem,5vw,3rem);border-bottom:1px solid var(--border);background:rgba(17,17,24,.88);color:var(--text-dim);font-size:10px;letter-spacing:.08em;text-transform:uppercase}.product-strip strong{color:var(--accent);font-weight:500}.product-strip span:last-child{color:var(--text-faint)}
main{max-width:920px;margin:0 auto;padding:52px 24px 96px}h1{font:400 clamp(2.5rem,7vw,4.6rem)/1.02 var(--serif);margin:10px 0 14px}h2{font:400 24px/1.25 var(--serif);margin:52px 0 14px;color:var(--text)}h3{font-size:14px;font-weight:500;margin:0}p{color:var(--text-dim);margin:0 0 14px;line-height:1.8}.lede{max-width:760px;font-size:15px}.crumb{color:var(--accent);font-size:11px;letter-spacing:.16em;text-transform:uppercase}.sub{color:var(--text-dim);margin-bottom:36px}code{background:var(--bg-2);padding:1px 5px;border-radius:3px;font-size:13px;overflow-wrap:anywhere}pre{background:var(--bg-1);border:1px solid var(--border);border-radius:4px;padding:16px 18px;overflow-x:auto;margin:14px 0;font-size:13px;line-height:1.55}pre code{background:none;padding:0}
.endpoint{background:var(--bg-1);border:1px solid var(--border);border-radius:4px;padding:18px 20px;margin:0 0 14px}.endpoint:hover{border-color:var(--border-hi)}.sig{display:flex;align-items:center;gap:10px;margin-bottom:9px;flex-wrap:wrap}.method{font-size:11px;font-weight:500;letter-spacing:.06em;padding:2px 8px;border-radius:3px}.get{color:var(--green);border:1px solid var(--green)}.post{color:var(--text-dim);border:1px solid var(--text-dim)}.path{font-weight:500;overflow-wrap:anywhere}.tag{font-size:11px;color:var(--text-dim);border:1px solid var(--border-hi);padding:2px 8px;border-radius:3px}.endpoint p{margin:4px 0 0;font-size:13px}.params{margin:10px 0 0;font-size:13px;color:var(--text-dim)}.params code{color:var(--text)}
.table-wrap{max-width:100%;overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:560px;margin:12px 0;font-size:13px}td,th{border:1px solid var(--border);padding:8px 10px;text-align:left;color:var(--text-dim)}th{color:var(--text);font-weight:500}.foot{margin-top:64px;padding-top:18px;border-top:1px solid var(--border);display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;color:var(--text-faint);font-size:11px}.foot div{display:flex;flex-wrap:wrap;gap:1rem}
.docs-search-root{position:fixed;inset:0;z-index:1000;display:grid;place-items:start center;padding:min(12vh,7rem) 1rem 1rem}.docs-search-root[hidden]{display:none}.docs-search-scrim{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(4,4,8,.82);backdrop-filter:blur(8px);cursor:default}.docs-search-panel{position:relative;width:min(720px,100%);max-height:min(720px,78vh);overflow:auto;padding:1.25rem;border:1px solid var(--border-hi);background:var(--bg-1);box-shadow:0 24px 80px rgba(0,0,0,.45)}.docs-search-heading{margin:0 0 .75rem;color:var(--accent);font-size:10px;letter-spacing:.14em}.docs-search-input{width:100%;min-height:48px;padding:.75rem 1rem;border:1px solid var(--border-hi);background:var(--bg-2);color:var(--text);font:inherit}.docs-search-status{min-height:1.5rem;margin:.65rem 0;color:var(--text-dim);font-size:11px}.docs-search-results{display:grid;gap:1px;margin:0;padding:0;list-style:none;background:var(--border)}.docs-search-results li{background:var(--bg)}.docs-search-result{display:grid;gap:.4rem;padding:.9rem 1rem;color:var(--text-dim)}.docs-search-result:hover,.docs-search-result:focus-visible{background:var(--bg-2);color:var(--text);text-decoration:none}.docs-search-result strong{color:var(--text);font-size:11px;overflow-wrap:anywhere}.docs-search-result span{font-size:11px;line-height:1.65}.docs-search-close{margin-top:1rem;min-height:40px;padding:.55rem .9rem;border:1px solid var(--border-hi);background:var(--bg-2);color:var(--text);font:inherit;cursor:pointer}body.docs-search-open{overflow:hidden}
:where(a,button,input,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:760px){.global-nav{position:relative;align-items:stretch;flex-direction:column;padding-block:.75rem}.global-links{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));width:100%}.global-links a,.search-trigger{min-width:0;min-height:44px;justify-content:center;padding:.4rem .2rem;font-size:9px;text-align:center}.search-trigger span,.search-trigger kbd{display:none}.product-strip{grid-template-columns:1fr auto}.product-strip span:nth-child(2){grid-column:1/-1;grid-row:2}main{padding-top:36px}}
@media(max-width:420px){.estate-status span:last-child{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.estate-status{width:32px;justify-content:center;padding:0}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
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
        schema.maxLength !== undefined ? `${schema.maxLength} chars max` : "",
        schema.default !== undefined ? `default ${schema.default}` : "",
      ].filter(Boolean).join(", ");
      return `<code>${escapeHtml(parameter.name)}</code> ${requirement}` +
        (bounds ? `, ${escapeHtml(bounds)}` : "");
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
        return [{
          method: method.toUpperCase(),
          path,
          summary: operation.summary || "",
          description: operation.description || operation.summary || "Documented API operation.",
          parameters: operation.parameters || [],
          internal: Array.isArray(operation.security) && operation.security.length > 0,
        }];
      }),
    )
    .filter((entry) => entry.path !== "/v1" && entry.path !== "/v1/docs");
}

export function documentedEndpointKeys(spec = buildOpenApi()) {
  return endpointEntries(spec).map((entry) => `${entry.method} ${entry.path}`);
}

function endpointCard(endpoint) {
  const methodClass = endpoint.method === "GET" ? "get" : "post";
  const internal = endpoint.internal ? '<span class="tag">internal, bearer</span>' : "";
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
<title>Public API // Atlas Systems</title>
<meta name="description" content="Human-readable documentation for the versioned Atlas Systems public API, rendered directly from the OpenAPI authority.">
<meta name="theme-color" content="#0a0a0f">
<link rel="canonical" href="https://api.atlas-systems.uk/v1/docs">
<link rel="icon" href="/v1/docs/assets/favicon.ico" sizes="any">
<link rel="icon" href="/v1/docs/assets/favicon-16x16.png" sizes="16x16" type="image/png">
<link rel="icon" href="/v1/docs/assets/favicon-32x32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/v1/docs/assets/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="/v1/docs/assets/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:title" content="Public API // Atlas Systems">
<meta property="og:description" content="Human-readable documentation for the versioned Atlas Systems public API, rendered directly from the OpenAPI authority.">
<meta property="og:url" content="https://api.atlas-systems.uk/v1/docs">
<meta property="og:site_name" content="Atlas Systems">
<meta property="og:image" content="https://atlas-systems.uk/og-default.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Atlas Systems public API documentation">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Public API // Atlas Systems">
<meta name="twitter:description" content="Human-readable documentation for the versioned Atlas Systems public API, rendered directly from the OpenAPI authority.">
<meta name="twitter:image" content="https://atlas-systems.uk/og-default.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<nav class="global-nav" aria-label="Primary navigation">
  <div class="brand-cluster">
    <a class="wordmark" href="https://atlas-systems.uk/">Atlas<span>_</span>Systems</a>
    <a class="estate-status" href="https://status.atlas-systems.uk/" data-estate-status data-state="checking" aria-label="Atlas Systems status: checking"><span class="estate-status-dot" aria-hidden="true"></span><span>checking</span></a>
  </div>
  <ul class="global-links">
    <li><a href="https://atlas-systems.uk/work/">Work</a></li>
    <li><a href="https://atlas-systems.uk/writing/">Writing</a></li>
    <li><a href="https://atlas-systems.uk/lab/">Lab</a></li>
    <li><a href="https://atlas-systems.uk/about/">About</a></li>
    <li><button class="search-trigger" type="button" data-estate-search-open aria-label="Search the estate" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.2" y2="16.2"></line></svg><span>Search</span><kbd>ctrl k</kbd></button></li>
  </ul>
</nav>
<div class="product-strip"><strong>Public API</strong><span>versioned read surface rendered from OpenAPI</span><span>v${escapeHtml(spec.info.version)}</span></div>
<main>
<div class="crumb">atlas systems // api</div>
<h1>Public API, v1.</h1>
<p class="lede">The versioned human-readable catalogue for Atlas Systems topology, bounded Trace proof chains, public repository inventory, assurance evidence, semantic search, reliability, and live infrastructure state.</p>
<p class="sub">version ${escapeHtml(spec.info.version)} &middot; <a href="/v1/openapi.json">openapi.json</a> &middot; <a href="https://github.com/AtlasReaper311/atlas-api-public">source</a></p>

<p>This page is generated from the OpenAPI document in the same Worker deployment. It does not maintain a parallel endpoint list. Runtime state and declared source inventory remain separate: a public repository can exist without pretending to be a deployed service, and unavailable live evidence stays unavailable.</p>

<h2>Quick start</h2>
<pre><code>curl https://api.atlas-systems.uk/v1/topology
curl https://api.atlas-systems.uk/v1/trace
curl https://api.atlas-systems.uk/v1/registry
curl https://api.atlas-systems.uk/v1/search?q=tunnel
curl https://api.atlas-systems.uk/v1/evidence</code></pre>

<h2>Endpoints</h2>
${endpoints.map(endpointCard).join("\n")}

<h2>Rate limits</h2>
<div class="table-wrap"><table>
<tr><th>Scope</th><th>Limit</th><th>Why</th></tr>
<tr><td>General, per IP</td><td>60 / minute</td><td>Edge reads are cheap; this stops basic abuse</td></tr>
<tr><td><code>/v1/search</code>, per IP</td><td>10 / minute</td><td>Every hit costs a real embedding on local hardware</td></tr>
</table></div>
<p>Counters are per Cloudflare colo, which is the documented tradeoff of a zero-dependency limiter at this scale. A 429 clears within a minute.</p>

<h2>CORS and versioning</h2>
<p>Every public <code>GET</code> endpoint sends <code>access-control-allow-origin: *</code>. The <code>/v1</code> prefix is the response-shape contract. Additive endpoints and fields can ship within v1; breaking shape changes require <code>/v2</code>.</p>

<footer class="foot"><span>Atlas Systems // Public API</span><div><a href="https://atlas-systems.uk/">Estate home</a><a href="https://status.atlas-systems.uk/">Status</a><a href="https://github.com/AtlasReaper311/atlas-api-public">Source</a></div></footer>
</main>
<script src="/v1/docs/assets/shell.js" defer></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
