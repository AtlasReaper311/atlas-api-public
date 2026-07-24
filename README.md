<div align="center">
  <img src="https://raw.githubusercontent.com/AtlasReaper311/AtlasReaper311/main/atlas-icon-dark-256.png" width="88" alt="Atlas Systems"/>
</div>

# atlas-api-public

```
┌─────────────────────────────────────────────┐
│  ATLAS SYSTEMS // atlas-api-public          │
│  versioned public estate projection         │
└─────────────────────────────────────────────┘
```

[![CI](https://github.com/AtlasReaper311/atlas-api-public/actions/workflows/ci.yml/badge.svg)](https://github.com/AtlasReaper311/atlas-api-public/actions)
![Runtime](https://img.shields.io/badge/cloudflare-workers-f5a623?style=flat-square&labelColor=0a0a0f)
![Store](https://img.shields.io/badge/state-kv%20%2B%20cache%20api-aaa9a0?style=flat-square&labelColor=0a0a0f)
![Cost](https://img.shields.io/badge/cost-%C2%A34%2Fmo_plan%2C_%C2%A30_marginal-aaa9a0?style=flat-square&labelColor=0a0a0f)

The versioned public API for Atlas Systems. It projects only intentionally public topology, Worker metadata, reliability evidence, search, telemetry, and sanitized event data; account-level discovery and authenticated internal operations are not public contracts.

## Prerequisites

- Wrangler v4 authenticated to the Cloudflare account.
- The existing public service bindings declared in `wrangler.toml`.
- The `ATLAS_PUBLIC_KV` namespace.
- Required secrets entered only through interactive `wrangler secret put` prompts.

## Setup

```bash
git clone https://github.com/AtlasReaper311/atlas-api-public.git
cd atlas-api-public
npm ci
npm test
npm run lint
npx wrangler deploy --dry-run --outdir dist
```

Production deployment is a separate owner-approved action.

## Public projection boundary

`data/estate.manifest.json` is the canonical declared map of the public Atlas Systems estate. It describes public sites, public Workers, intentionally documented local components, external dependencies, and public relationships.

The manifest is not a complete account inventory. Private repositories and services own their governance elsewhere and are never projected into this file.

The runtime boundary is enforced twice:

1. `atlas-api-index` publishes only an explicit allowlist of public Workers.
2. `/v1/registry` filters the upstream result again against public Worker declarations in the manifest.

The topology boundary also checks repository visibility. A component backed by a GitHub repository is excluded when that repository is not present in the generated public repository inventory.

Unknown components fail closed.

## Surface

| Endpoint | What it is |
|---|---|
| `GET /v1` | Endpoint index |
| `GET /v1/docs` | Human documentation generated from the public API contract |
| `GET /v1/openapi.json` | Machine-readable OpenAPI contract |
| `GET /v1/registry` | Approved public Worker registry |
| `GET /v1/topology` | Declared public repository and component topology |
| `GET /v1/search?q=` | Public corpus search projection |
| `GET /v1/stats` | Public component verdicts and measured estate evidence |
| `GET /v1/infra/status` | Bounded public infrastructure health projection |
| `GET /v1/rag/stats` | Aggregate corpus query counts |
| `GET /v1/badge/status` | Public estate status badge |
| `GET /v1/reliability` | Derived public reliability and error-budget evidence |
| `GET /v1/reliability/services/{id}` | One public measured service result |
| `GET /v1/reliability/objectives` | Published reliability policy |
| `GET /v1/reliability/baseline/{id}` | Release baseline when evidence supports one |
| `GET /notify/recent` | Sanitized public recent-event projection |
| `POST /v1/infra/report` | Authenticated infrastructure evidence ingest |
| `POST /v1/rag/report` | Authenticated corpus summary ingest |
| `POST /v1/reliability/objectives/report` | Authenticated reliability policy ingest |

## Human docs interface

`GET /v1/docs` is the human-facing view of the same OpenAPI authority served at
`GET /v1/openapi.json`. Endpoint cards are derived during request rendering;
there is no second hand-maintained endpoint inventory.

The page consumes Atlas Interface Kit `0.1.1` from
`assets/docs-interface/v0.1.1/`. The Worker embeds and serves the pinned
stylesheet at `GET /v1/docs/assets/interface-kit.css`, so the interface has no
cross-domain runtime dependency. Verify and rebuild the deterministic local
bundle with:

```bash
npm run verify:docs-interface
npm run build:docs-interface
git diff --exit-code -- src/routes/docs-interface.generated.js
```

Interface pull requests publish an isolated `workers.dev` preview with no
production routes or bindings. Chrome and Firefox evidence covers 320, 375,
768, 1024, and 1440 px before manual visual approval. Preview approval does not
authorize a production deploy.

## Sanitized event projection

The operational event router can retain richer evidence for authenticated internal consumers. The public `/notify/recent` route is owned by this Worker and filters events before they reach the site or Status page.

Repository identities are allowed only when they belong to the public repository inventory. Unknown GitHub identities fail closed. Counts and level summaries are recalculated after filtering so the public response does not reveal how many hidden events were removed.

This route is intentionally more specific than the event router's wildcard route on the same hostname.

## Reliability derivation

Reliability verdicts are derived from measured counters and published objectives. Missing, stale, or insufficient evidence becomes an explicit unavailable or unmeasured state rather than synthetic health.

Targets arrive through fingerprint-verified policy ingest. State transitions can emit bounded operational events through the existing notify binding.

## Public evidence surface

`GET /v1/evidence` indexes the latest scored public conformance and chaos-assurance records. Authenticated producer routes validate the versioned evidence contracts and fingerprints before accepting writes.

Evidence producers remain separate from this public read boundary. The API stores and presents approved public evidence; it does not gain deployment authority by doing so.

## Operational notes

**Route layering.** Specific public routes are deliberately narrower than wildcard Worker routes on the same hostname. This lets the public API own a sanitized projection without changing the internal producer's service-binding contract.

**Fail closed.** Upstream account inventory is never trusted as a publication decision. A Worker or repository must be explicitly represented by the public estate before this API exposes it.

**KV write policy.** Durable state writes are bounded by scheduled evidence collection and meaningful state updates rather than being used as a naive per-request cache.

**Rate limiting.** General and search routes use Cloudflare rate-limit bindings. Search is more constrained because each request performs real local embedding work.

**Uptime honesty.** Reliability history begins when measurement begins. The API reports its evidence window rather than inventing pre-existing uptime.

**CSP.** Browser consumers require the API hostname in the site's `connect-src` policy. New public hostnames require an explicit site header review.

## Development

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev
npm test
npm run lint
```

Tests include regression coverage for the public registry, topology, and recent-event privacy boundaries.

## How it fits into Atlas Systems

`atlas-api-public` is the publication membrane between internal evidence producers and the public portfolio. It reads approved public registry data, bounded telemetry, public repository inventory, and reliability evidence, then exposes stable public contracts consumed by the Lab, Status surface, and profile badge.

The transferable principle is that an API boundary should decide what may be published, not merely reformat everything an upstream system can see.

---

Part of [atlas-systems.uk](https://atlas-systems.uk)
