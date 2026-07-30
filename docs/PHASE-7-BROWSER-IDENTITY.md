# Phase 7 browser identity

## Finding

The human Public API documentation root already satisfies the accepted browser identity:

- page-first title and description;
- exact canonical and Open Graph URL;
- route-specific social card and matching image alt text;
- complete repository-local browser icons and manifest;
- repository-local fonts and interface assets;
- product-specific footer and Atlas estate escape;
- OpenAPI-derived endpoint catalogue.

The measured gap was error identity for browser navigation below `/v1/docs`. Unknown documentation paths returned the same JSON error as machine endpoints.

## Change

Unknown documentation requests now use bounded content negotiation:

- `GET /v1/docs/*` requests that accept HTML, or declare browser navigation mode, receive a noindex HTML 404;
- API-style requests to the same unknown path retain the existing JSON error;
- unknown `/v1/*` machine endpoints remain JSON regardless of an HTML `Accept` header;
- documentation assets continue to resolve before the error boundary.

The HTML error response includes:

- `404 // Public API // Atlas Systems` title;
- description, `noindex, follow`, and theme colour;
- no canonical URL or social card;
- the existing local docs icon, manifest, font, and interface asset routes;
- product identity, recovery to docs and OpenAPI, source evidence, and estate escape;
- no script and no API operation or mutation.

## Protected boundaries

This branch does not modify:

- the OpenAPI contract or endpoint catalogue;
- response schemas or cache policy;
- CORS or method handling;
- rate-limit configuration;
- evidence, reliability, topology, registry, search, stats, SLO, infrastructure, or RAG routes;
- cron behavior;
- bindings, provider settings, or secrets;
- the JSON-only API index root owned by `atlas-api-index`.

## Validation

Repository-native tests must prove root metadata, noindex docs errors, HTML-versus-JSON negotiation, unchanged machine fallbacks, local assets, OpenAPI-derived content, security headers, and isolated preview behavior.

## Rollout boundary

This branch stops at a draft pull request. A later merge will trigger the Worker deployment and requires separate exact-head rollout approval and live verification.
