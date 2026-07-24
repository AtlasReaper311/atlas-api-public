/**
 * /v1/docs: human documentation rendered from the OpenAPI contract.
 *
 * The OpenAPI document is the endpoint authority. This page contains no
 * parallel endpoint array, so adding or removing a documented route changes
 * the HTML catalogue automatically in the same deployment.
 */

import { buildOpenApi } from "../openapi-trace.js";

const CSS = `
:root{--bg:var(--atlas-bg);--bg-1:var(--atlas-bg-1);--bg-2:var(--atlas-bg-2);--border:var(--atlas-border);--border-hi:var(--atlas-border-hi);--text:var(--atlas-text);--text-dim:var(--atlas-text-dim);--text-faint:var(--atlas-text-faint);--accent:var(--atlas-accent);--green:var(--atlas-operational);--red:var(--atlas-unavailable);--mono:var(--atlas-font-body);--serif:var(--atlas-font-display);--nav-h:56px}
*,*::before,*::after{box-sizing:border-box}
html{scroll-padding-top:calc(var(--nav-h) + var(--atlas-space-5))}
body{margin:0;min-height:100vh;overflow-x:hidden;background:var(--bg);background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:80px 80px;color:var(--text);font:400 var(--atlas-type-body)/1.75 var(--mono)}
a{color:var(--accent);text-underline-offset:.22em}
.api-global-header{min-height:var(--nav-h);padding-inline:clamp(var(--atlas-space-4),4vw,var(--atlas-space-7));background:rgba(10,10,15,.96)}
.api-global-header .atlas-global-header__identity{min-width:0}
.wordmark{flex:none;color:var(--text);font-size:13px;font-weight:500;letter-spacing:.12em;text-decoration:none;text-transform:uppercase;white-space:nowrap}.wordmark span{color:var(--accent)}
.api-global-header .atlas-global-header__nav{gap:var(--atlas-space-3)}
.api-global-header .atlas-global-header__link{padding-inline:var(--atlas-space-2);font-size:var(--atlas-type-meta);letter-spacing:.06em;text-transform:uppercase}
.estate-status{min-height:var(--atlas-control-compact);padding-inline:var(--atlas-space-3);border-radius:var(--atlas-radius-md);background:var(--bg-1);text-decoration:none;white-space:nowrap}.estate-status-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--atlas-unknown)}.estate-status[data-state="operational"] .estate-status-dot{background:var(--green);box-shadow:0 0 0 3px rgba(74,222,128,.12)}.estate-status[data-state="degraded"] .estate-status-dot,.estate-status[data-state="checking"] .estate-status-dot{background:var(--accent);box-shadow:0 0 0 3px rgba(245,166,35,.12)}.estate-status[data-state="unavailable"] .estate-status-dot{background:var(--red);box-shadow:0 0 0 3px rgba(226,75,74,.12)}
.search-trigger{display:inline-flex;min-height:var(--atlas-control-standard);align-items:center;gap:var(--atlas-space-2);padding-inline:var(--atlas-space-3);border:1px solid var(--border);border-radius:var(--atlas-radius-md);background:var(--bg-1);color:var(--text-dim);font:500 var(--atlas-type-meta)/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;cursor:pointer}.search-trigger:hover,.search-trigger:focus-visible{border-color:var(--border-hi);color:var(--text)}.search-trigger svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.5}.search-trigger kbd{color:var(--text-faint);font:inherit;font-size:var(--atlas-type-tiny)}
.api-product-strip{display:grid;grid-template-columns:auto minmax(0,1fr) auto;min-height:44px;padding-inline:clamp(var(--atlas-space-4),4vw,var(--atlas-space-7));color:var(--text-dim);font:500 var(--atlas-type-meta)/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase}.api-product-strip strong{color:var(--accent);font-weight:500}.api-product-strip span:last-child{color:var(--text-faint)}
main{max-width:920px;margin:0 auto;padding:0 var(--atlas-space-5) var(--atlas-space-9)}
.api-page-intro{padding-inline:0}.api-page-intro .sub{margin:var(--atlas-space-4) 0 0;color:var(--text-dim);font-size:var(--atlas-type-supporting)}.api-page-intro .sub a{display:inline-flex;min-height:var(--atlas-touch-min);align-items:center}
.prose-intro{max-width:var(--atlas-prose);margin:0 0 var(--atlas-space-6);color:var(--text-dim)}
h2{margin:var(--atlas-space-7) 0 var(--atlas-space-4);color:var(--text);font:400 30px/1.15 var(--serif)}h3{margin:0;color:var(--text);font:500 var(--atlas-type-supporting)/1.5 var(--mono)}
p{color:var(--text-dim)}code{border-radius:var(--atlas-radius-sm);padding:2px 6px;background:var(--bg-2);font-size:13px;overflow-wrap:anywhere}pre{margin:var(--atlas-space-4) 0;padding:var(--atlas-space-5);overflow-x:auto;border:1px solid var(--border);border-radius:var(--atlas-radius-md);background:var(--bg-1);font-size:13px;line-height:1.65}pre code{padding:0;background:none}
.endpoint{margin:0 0 var(--atlas-space-4)}.endpoint:hover{border-color:var(--border-hi)}.sig{display:flex;align-items:center;gap:var(--atlas-space-3);margin-bottom:var(--atlas-space-3);flex-wrap:wrap}.method{min-height:24px;display:inline-flex;align-items:center;padding:0 var(--atlas-space-2);border-radius:var(--atlas-radius-sm);font-size:var(--atlas-type-meta);font-weight:500;letter-spacing:.06em}.get{border:1px solid var(--green);color:var(--green)}.post{border:1px solid var(--text-dim);color:var(--text-dim)}.path{font-weight:500;overflow-wrap:anywhere}.tag{font-size:var(--atlas-type-meta)}.endpoint p{margin:var(--atlas-space-2) 0 0;font-size:var(--atlas-type-supporting);line-height:1.75}.params{margin-top:var(--atlas-space-3);color:var(--text-dim)}.params code{color:var(--text)}
.table-wrap{margin:var(--atlas-space-4) 0}.table-wrap table{min-width:560px;font-size:var(--atlas-type-supporting)}td,th{border-bottom:1px solid var(--border);padding:var(--atlas-space-3) var(--atlas-space-4);color:var(--text-dim);text-align:left}th{color:var(--text);font-weight:500}
.api-footer{max-width:none;margin-top:var(--atlas-space-9);padding-inline:0;display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--atlas-space-4)}.api-footer div{display:flex;flex-wrap:wrap;gap:var(--atlas-space-5)}.api-footer a{min-height:var(--atlas-touch-min);display:inline-flex;align-items:center}
.docs-search-root{position:fixed;inset:0;z-index:var(--atlas-z-dialog);display:grid;place-items:start center;padding:min(12vh,7rem) var(--atlas-space-4) var(--atlas-space-4)}.docs-search-root[hidden]{display:none}.docs-search-scrim{position:absolute;inset:0;width:100%;height:100%;border:0;background:rgba(4,4,8,.82);backdrop-filter:blur(8px);cursor:default}.docs-search-panel{position:relative;width:min(720px,100%);max-height:min(720px,78vh);overflow:auto;padding:var(--atlas-card-standard);border:1px solid var(--border-hi);border-radius:var(--atlas-radius-lg);background:var(--bg-1);box-shadow:var(--atlas-shadow-floating)}.docs-search-heading{margin:0 0 var(--atlas-space-3);color:var(--accent);font-size:var(--atlas-type-meta);letter-spacing:.14em}.docs-search-input{width:100%;min-height:48px;padding:var(--atlas-space-3) var(--atlas-space-4);border:1px solid var(--border-hi);border-radius:var(--atlas-radius-sm);background:var(--bg-2);color:var(--text);font:inherit}.docs-search-status{min-height:1.5rem;margin:var(--atlas-space-3) 0;color:var(--text-dim);font-size:var(--atlas-type-supporting)}.docs-search-results{display:grid;gap:1px;margin:0;padding:0;overflow:hidden;border-radius:var(--atlas-radius-sm);background:var(--border);list-style:none}.docs-search-results li{background:var(--bg)}.docs-search-result{display:grid;gap:var(--atlas-space-2);min-height:var(--atlas-touch-min);padding:var(--atlas-space-4);color:var(--text-dim);text-decoration:none}.docs-search-result:hover,.docs-search-result:focus-visible{background:var(--bg-2);color:var(--text)}.docs-search-result strong{color:var(--text);font-size:var(--atlas-type-supporting);overflow-wrap:anywhere}.docs-search-result span{font-size:var(--atlas-type-supporting);line-height:1.65}.docs-search-close{min-height:var(--atlas-touch-min);margin-top:var(--atlas-space-4);padding:0 var(--atlas-space-4);border:1px solid var(--border-hi);border-radius:var(--atlas-radius-sm);background:var(--bg-2);color:var(--text);font:inherit;cursor:pointer}body.docs-search-open{overflow:hidden}
.api-bottom-nav a{letter-spacing:-.02em}
:where(a,button,input,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:767px){.api-global-header{position:sticky;grid-template-columns:minmax(0,1fr) auto;gap:var(--atlas-space-2);padding-inline:var(--atlas-space-4)}.api-global-header .atlas-global-header__identity{gap:var(--atlas-space-2)}.search-trigger{min-width:44px;min-height:44px;justify-content:center;padding:0}.search-trigger span,.search-trigger kbd{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.api-product-strip{grid-template-columns:1fr auto}.api-product-strip span:nth-child(2){grid-column:1/-1;grid-row:2}.api-page-intro{padding-top:var(--atlas-space-7)}main{padding-inline:var(--atlas-space-4)}}
@media(max-width:420px){.estate-status{width:32px;justify-content:center;padding:0}.estate-status [data-estate-status-label]{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.api-footer{padding-bottom:var(--atlas-space-5)}}
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
  const internal = endpoint.internal ? '<span class="atlas-badge atlas-badge--type tag">internal, bearer</span>' : "";
  return `<article class="atlas-card atlas-card--interactive endpoint">
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
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/v1/docs/assets/interface-kit.css">
<style>${CSS}</style>
</head>
<body data-atlas-bottom-nav="true">
<header class="atlas-global-header api-global-header">
  <div class="atlas-global-header__identity">
    <a class="wordmark" href="https://atlas-systems.uk/">Atlas<span>_</span>Systems</a>
    <a class="atlas-status estate-status" href="https://status.atlas-systems.uk/" data-estate-status data-state="checking" aria-label="Atlas Systems status: Checking"><span class="estate-status-dot" aria-hidden="true"></span><span data-estate-status-label>Checking</span></a>
  </div>
  <nav class="atlas-global-header__nav" aria-label="Primary navigation">
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/work/">Work</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/writing/">Writing</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/lab/">Lab</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/systems/">Systems</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/about/">About</a>
  </nav>
  <div class="atlas-global-header__actions">
    <button class="search-trigger" type="button" data-estate-search-open aria-label="Search the estate" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.2" y2="16.2"></line></svg><span>Search</span><kbd>ctrl k</kbd></button>
  </div>
</header>
<div class="atlas-product-strip api-product-strip"><strong>Public API</strong><span>versioned read surface rendered from OpenAPI</span><span>v${escapeHtml(spec.info.version)}</span></div>
<main>
<header class="atlas-page-intro api-page-intro">
  <p class="atlas-page-intro__eyebrow">atlas systems // api</p>
  <h1 class="atlas-page-intro__title">Public API, v1.</h1>
  <p class="atlas-page-intro__purpose">The versioned human-readable catalogue for Atlas Systems topology, bounded Trace proof chains, public repository inventory, assurance evidence, semantic search, reliability, and live infrastructure state.</p>
  <p class="sub">version ${escapeHtml(spec.info.version)} &middot; <a href="/v1/openapi.json">openapi.json</a> &middot; <a href="https://github.com/AtlasReaper311/atlas-api-public">source</a></p>
</header>

<p class="prose-intro">This page is generated from the OpenAPI document in the same Worker deployment. It does not maintain a parallel endpoint list. Runtime state and declared source inventory remain separate: a public repository can exist without pretending to be a deployed service, and unavailable live evidence stays unavailable.</p>

<h2>Quick start</h2>
<pre tabindex="0" aria-label="Quick start commands; scroll horizontally when needed"><code>curl https://api.atlas-systems.uk/v1/topology
curl https://api.atlas-systems.uk/v1/trace
curl https://api.atlas-systems.uk/v1/registry
curl https://api.atlas-systems.uk/v1/search?q=tunnel
curl https://api.atlas-systems.uk/v1/evidence</code></pre>

<h2>Endpoints</h2>
${endpoints.map(endpointCard).join("\n")}

<h2>Rate limits</h2>
<div class="atlas-table-wrap table-wrap" tabindex="0" aria-label="Rate limit table; scroll horizontally when needed"><table>
<tr><th>Scope</th><th>Limit</th><th>Why</th></tr>
<tr><td>General, per IP</td><td>60 / minute</td><td>Edge reads are cheap; this stops basic abuse</td></tr>
<tr><td><code>/v1/search</code>, per IP</td><td>10 / minute</td><td>Every hit costs a real embedding on local hardware</td></tr>
</table></div>
<p>Counters are per Cloudflare colo, which is the documented tradeoff of a zero-dependency limiter at this scale. A 429 clears within a minute.</p>

<h2>CORS and versioning</h2>
<p>Every public <code>GET</code> endpoint sends <code>access-control-allow-origin: *</code>. The <code>/v1</code> prefix is the response-shape contract. Additive endpoints and fields can ship within v1; breaking shape changes require <code>/v2</code>.</p>

<footer class="atlas-footer api-footer"><span>Atlas Systems // Public API</span><div><a href="https://atlas-systems.uk/">Estate home</a><a href="https://status.atlas-systems.uk/">Status</a><a href="https://github.com/AtlasReaper311/atlas-api-public">Source</a></div></footer>
</main>
<nav class="atlas-bottom-nav api-bottom-nav" aria-label="Mobile navigation">
  <a href="https://atlas-systems.uk/work/">Work</a>
  <a href="https://atlas-systems.uk/writing/">Writing</a>
  <a href="https://atlas-systems.uk/lab/">Lab</a>
  <a href="https://atlas-systems.uk/systems/">Systems</a>
  <a href="https://atlas-systems.uk/about/">About</a>
</nav>
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
