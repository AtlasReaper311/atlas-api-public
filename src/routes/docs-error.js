const CSS = `
*,*::before,*::after{box-sizing:border-box}
html{min-height:100%;background:var(--atlas-bg)}
body{min-height:100vh;margin:0;display:flex;flex-direction:column;background:var(--atlas-bg);color:var(--atlas-text);font-family:var(--atlas-font-body)}
a{color:inherit}
.error-header{--atlas-shell-gutter:max(24px,calc((100% - 1280px)/2));min-height:56px;grid-template-columns:minmax(230px,1fr) auto minmax(230px,1fr);padding-inline:var(--atlas-shell-gutter);background:rgba(10,10,15,.96)}
.error-brand{display:flex;align-items:center;gap:var(--atlas-space-3)}
.error-wordmark{min-height:var(--atlas-touch-min);display:inline-flex;align-items:center;color:var(--atlas-text);font-size:13px;font-weight:500;letter-spacing:.12em;text-decoration:none;text-transform:uppercase}.error-wordmark span{color:var(--atlas-accent)}
.error-status{min-height:var(--atlas-control-compact);display:inline-flex;align-items:center;gap:var(--atlas-space-2);padding-inline:var(--atlas-space-3);border:1px solid var(--atlas-border);border-radius:var(--atlas-radius-md);color:var(--atlas-text-dim);font-size:var(--atlas-type-meta);text-decoration:none}.error-status i{width:7px;height:7px;border-radius:50%;background:var(--atlas-unknown)}
.error-header .atlas-global-header__nav{gap:0}
.error-header .atlas-global-header__link{padding:.35rem .85rem;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.error-strip{display:grid;grid-template-columns:auto minmax(0,1fr) auto;min-height:44px;align-items:center;gap:var(--atlas-space-3);padding-inline:clamp(var(--atlas-space-4),4vw,var(--atlas-space-7));border-bottom:1px solid var(--atlas-border);color:var(--atlas-text-dim);font-size:var(--atlas-type-meta);letter-spacing:.08em;text-transform:uppercase}.error-strip strong{color:var(--atlas-accent);font-weight:500}.error-strip span:last-child{color:var(--atlas-unavailable)}
.error-main{width:min(100%,920px);margin:0 auto;flex:1;display:grid;align-items:center;padding:clamp(48px,10vw,120px) clamp(16px,5vw,48px)}
.error-panel{max-width:760px;border:1px solid var(--atlas-border-hi);border-radius:var(--atlas-radius-lg);padding:clamp(24px,5vw,48px);background:var(--atlas-bg-1)}
.error-code{margin:0 0 var(--atlas-space-3);color:var(--atlas-unavailable);font-size:var(--atlas-type-meta);letter-spacing:.14em;text-transform:uppercase}
.error-panel h1{margin:0;color:var(--atlas-text);font:400 clamp(42px,8vw,72px)/.98 var(--atlas-font-display)}
.error-panel p{max-width:640px;margin:var(--atlas-space-4) 0 0;color:var(--atlas-text-dim);font-size:var(--atlas-type-body);line-height:1.75}
.error-actions{display:flex;flex-wrap:wrap;gap:var(--atlas-space-3);margin-top:var(--atlas-space-6)}
.error-actions a{min-height:var(--atlas-touch-min);display:inline-flex;align-items:center;padding:0 var(--atlas-space-4);border:1px solid var(--atlas-border-hi);border-radius:var(--atlas-radius-sm);color:var(--atlas-text);text-decoration:none}.error-actions a:first-child{border-color:var(--atlas-accent);color:var(--atlas-accent)}.error-actions a:hover{background:var(--atlas-bg-2)}
.error-footer{max-width:920px;margin:var(--atlas-space-7) auto 0;padding:var(--atlas-space-4) clamp(var(--atlas-space-4),4vw,var(--atlas-space-7));display:flex;flex-wrap:wrap;align-items:center;gap:0 var(--atlas-space-4);border-top:1px solid var(--atlas-border-hi);color:var(--atlas-text-faint);font-size:var(--atlas-type-meta)}.error-footer .atlas-footer__identity{min-width:min(100%,220px);flex:1 1 260px;display:grid;gap:2px;color:var(--atlas-text)}.error-footer .atlas-footer__identity strong{font-weight:500;letter-spacing:.06em;text-transform:uppercase}.error-footer .atlas-footer__identity span{color:var(--atlas-text-faint)}.error-footer .atlas-footer__context,.error-footer .atlas-footer__evidence,.error-footer .atlas-footer__escape{display:flex;align-items:center;gap:var(--atlas-space-3);white-space:nowrap}.error-footer .atlas-footer__evidence,.error-footer .atlas-footer__escape{border-left:1px solid var(--atlas-border);padding-left:var(--atlas-space-4)}.error-footer a{min-height:var(--atlas-touch-min);display:inline-flex;align-items:center;color:var(--atlas-text-dim);text-underline-offset:.22em}
:where(a):focus-visible{outline:2px solid var(--atlas-focus);outline-offset:3px}
@media(max-width:767px){.error-header{grid-template-columns:minmax(0,1fr);padding-inline:var(--atlas-space-4)}.error-header .atlas-global-header__nav{display:none}.error-strip{grid-template-columns:1fr auto}.error-strip span:nth-child(2){grid-column:1/-1;grid-row:2}.error-main{padding-bottom:var(--atlas-space-8)}.error-footer{flex-direction:column;align-items:flex-start;padding-bottom:calc(var(--atlas-space-8) + env(safe-area-inset-bottom))}.error-footer .atlas-footer__identity,.error-footer .atlas-footer__context,.error-footer .atlas-footer__evidence,.error-footer .atlas-footer__escape{width:100%;border-left:0;padding-left:0;white-space:normal}}
`;

export function handleDocsNotFound() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="The requested Public API documentation route does not exist. Return to the versioned human-readable API catalogue.">
<meta name="robots" content="noindex, follow">
<meta name="theme-color" content="#0a0a0f">
<title>404 // Public API // Atlas Systems</title>
<link rel="icon" href="/v1/docs/assets/favicon.ico" sizes="any">
<link rel="icon" href="/v1/docs/assets/favicon-16x16.png" sizes="16x16" type="image/png">
<link rel="icon" href="/v1/docs/assets/favicon-32x32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/v1/docs/assets/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="/v1/docs/assets/site.webmanifest">
<link rel="stylesheet" href="/v1/docs/assets/fonts.css">
<link rel="stylesheet" href="/v1/docs/assets/interface-kit.css">
<style>${CSS}</style>
</head>
<body>
<header class="atlas-global-header error-header">
  <div class="atlas-global-header__identity error-brand">
    <a class="error-wordmark" href="https://atlas-systems.uk/">Atlas<span>_</span>Systems</a>
    <a class="error-status" href="https://status.atlas-systems.uk/"><i aria-hidden="true"></i><span>Status</span></a>
  </div>
  <nav class="atlas-global-header__nav" aria-label="Primary navigation">
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/work/">Work</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/writing/">Writing</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/lab/">Lab</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/systems/">Systems</a>
    <a class="atlas-global-header__link" href="https://atlas-systems.uk/about/">About</a>
  </nav>
</header>
<div class="error-strip"><strong>Public API</strong><span>Versioned read surface rendered from OpenAPI</span><span>docs route unavailable</span></div>
<main class="error-main">
  <section class="error-panel" aria-labelledby="error-title">
    <p class="error-code">HTTP 404 // documentation route</p>
    <h1 id="error-title">That page is not in the API catalogue.</h1>
    <p>The requested browser path is not part of the human documentation surface. Return to the versioned catalogue or inspect the machine-readable OpenAPI contract. No API operation or mutation was called to render this page.</p>
    <div class="error-actions"><a href="/v1/docs">Open API docs</a><a href="/v1/openapi.json">Open OpenAPI</a></div>
  </section>
</main>
<footer class="atlas-footer atlas-footer--product error-footer" aria-label="Public API product footer">
  <div class="atlas-footer__identity"><strong>Atlas Systems Public API</strong><span>Versioned read surface rendered from OpenAPI</span></div>
  <div class="atlas-footer__context"><a href="/v1/docs">Documentation</a></div>
  <div class="atlas-footer__evidence"><a href="/v1/openapi.json">OpenAPI contract</a><a href="https://github.com/AtlasReaper311/atlas-api-public">Source</a></div>
  <div class="atlas-footer__escape"><a href="https://atlas-systems.uk/">Atlas Systems home</a></div>
</footer>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
