# Phase D: Public API Docs Interface V2

## Outcome

Bring the human-facing `GET /v1/docs` surface into the approved Atlas Public
Interface System v2 while preserving `atlas-api-public` as the independently
deployed Worker and preserving its OpenAPI document as the sole endpoint
authority.

This is a presentation migration, not an API redesign.

## Protected boundaries

The phase must not:

- add, remove, rename, or change an API route;
- change OpenAPI schemas, versioning, authentication, CORS, rate limits, or
  reliability semantics;
- create a parallel hand-maintained endpoint catalogue;
- change production Worker routes, bindings, schedules, or deployment
  ownership;
- fetch the interface kit or other presentation assets from another Atlas
  domain at runtime;
- expose private estate data or add a new search/status data source;
- merge or deploy to production before manual visual approval of the exact
  preview commit.

## Accepted interface contract

### Global shell

- Desktop header has three zones:
  - left: `ATLAS_SYSTEMS` and aggregate status;
  - centre: Work, Writing, Lab, Systems, About;
  - right: compact estate search.
- The product strip identifies `Public API`, explains that the surface is
  rendered from OpenAPI, and displays the current OpenAPI version.
- Mobile and narrow tablet layouts keep wordmark, aggregate status, and search
  in the top header and move the five estate routes to fixed bottom navigation.
- Estate-owned destinations open in the same tab. External destinations open
  in a new tab with `noopener noreferrer`.

### Status and search

- Status starts as `Checking`.
- Runtime states are `operational`, `degraded`, `unavailable`, and `unknown`.
- A fully healthy, fresh response is labelled `Operational`.
- Stale, malformed, failed, or timed-out evidence is labelled `Unknown`; the
  interface never invents health.
- Status consumes only the existing bounded `GET /v1/stats` projection.
- Estate search consumes only the existing bounded `GET /v1/search` projection,
  supports the compact header trigger and `Ctrl/Cmd+K`, traps focus, restores
  focus on close, and has explicit empty/rate-limited/unavailable messaging.

### Content and hierarchy

- The page retains `Public API, v1.` as its principal title and keeps every
  endpoint card generated from the current OpenAPI document.
- OpenAPI JSON, source, quick-start commands, parameter information, rate-limit
  guidance, CORS/versioning guidance, and route escape links remain available.
- API documentation uses the shared tokens and component roles while retaining
  a compact technical character appropriate to a machine-facing system.
- Body copy is 16 px preferred, supporting copy is 14 px preferred, metadata is
  at least 11 px, and essential touch targets are at least 44 px.
- Tables remain horizontally scrollable without causing page-level overflow.
- Fixed bottom navigation must not obscure the document or footer.

### Local interface bundle

- Pin Atlas Interface Kit `0.2.0`.
- Store the copied CSS, JSON contracts, typefaces, and licence files in this
  repository.
- Serve the shared stylesheets and typefaces from `/v1/docs/assets/` through
  this Worker.
- Verify file sizes and SHA-256 fingerprints against the pinned manifest.
- Generation and verification are deterministic and idempotent.

## Implementation ownership

- `src/routes/docs.js` owns the server-rendered human documentation and
  product-specific layout.
- `src/routes/docs-shell.js` owns bounded client-side status, search, focus, and
  owned-link behaviour.
- `src/openapi-trace.js` remains the API contract authority.
- `src/index.js` remains the Worker route owner.
- Repository-local assets under `assets/docs-interface/` and
  `assets/docs-icons/` are embedded and served by `atlas-api-public`.
- `.github/workflows/interface-preview.yml` owns the isolated, non-production
  visual approval preview.

## Validation and evidence

The exact pull-request head must pass:

1. deterministic interface-bundle and icon generation checks;
2. ESLint and the complete Node test suite;
3. explicit proof that every documented endpoint still comes from OpenAPI;
4. production-shaped and isolated-preview Wrangler dry runs;
5. the pinned Worker contract validator;
6. browser checks in Chrome and Firefox at 320, 375, 768, 1024, and 1440 px;
7. serious accessibility checks with zero serious or critical violations;
8. checks for horizontal overflow, usable 44 px touch controls, correct
   desktop/mobile navigation, status states, search keyboard/focus behaviour,
   and local asset responses;
9. deterministic screenshots and a machine-readable evidence artifact retained
   for 14 days.

## Rollout gate

The pull request remains draft while the isolated preview is reviewed. The
preview comment must identify its exact commit and state that production is
unchanged. Phase D stops after evidence and preview delivery until the owner
explicitly approves that exact visual result. Merge and production deployment
are separate, owner-approved actions.

## Rollback

Before merge, close the draft pull request and delete its branch or isolated
preview Worker. After an approved merge, revert the Phase D merge commit and let
the existing Worker deployment workflow restore the prior docs shell. API
routes, OpenAPI, bindings, and stored data are unchanged, so rollback is limited
to presentation assets and presentation code.
