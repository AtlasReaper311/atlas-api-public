<div align="center">
  <img src="https://raw.githubusercontent.com/AtlasReaper311/AtlasReaper311/main/atlas-icon-dark-256.png" width="88" alt="Atlas Systems"/>
</div>

# atlas-api-public

```
┌─────────────────────────────────────────────┐
│  ATLAS SYSTEMS // atlas-api-public          │
│  the versioned public surface of the        │
│  estate: registry, search, health, badge    │
└─────────────────────────────────────────────┘
```

[![CI](https://github.com/AtlasReaper311/atlas-api-public/actions/workflows/ci.yml/badge.svg)](https://github.com/AtlasReaper311/atlas-api-public/actions)
![Runtime](https://img.shields.io/badge/cloudflare-workers-f5a623?style=flat-square&labelColor=0a0a0f)
![Store](https://img.shields.io/badge/state-kv%20%2B%20cache%20api-aaa9a0?style=flat-square&labelColor=0a0a0f)
![Cost](https://img.shields.io/badge/cost-%C2%A34%2Fmo_plan%2C_%C2%A30_marginal-aaa9a0?style=flat-square&labelColor=0a0a0f)

One Worker on `api.atlas-systems.uk/v1*` that turns the estate outward: the Worker registry in a stable public shape, RAG search over the estate's own documentation, live infra health from [`specular-sentinel`](https://github.com/AtlasReaper311/specular-sentinel), query stats from [`atlas-corpus`](https://github.com/AtlasReaper311/atlas-corpus), measured uptime, an OpenAPI spec that CI proves against the router, and an SVG status badge. Versioning lives in the path; `/v2` would be a new router branch here, not a new Worker.

## Prerequisites

- `wrangler` v4 logged into the account (`npx wrangler whoami`)
- `atlas-notify` at v1.1.0 or later (the `signal_class` channel routing this Worker's alerts rely on)
- The `ATLAS_PUBLIC_KV` namespace created and its id patched into `wrangler.toml` (the build script does this; see the gotcha below)

## Setup

```bash
git clone https://github.com/AtlasReaper311/atlas-api-public.git
cd atlas-api-public
npm ci
npm test
npx wrangler kv namespace create ATLAS_PUBLIC_KV --config /dev/null
# paste the returned id into [[kv_namespaces]] in wrangler.toml
npx wrangler secret put NOTIFY_TOKEN
npx wrangler secret put INFRA_REPORT_KEY
npx wrangler secret put RAG_REPORT_KEY
npx wrangler deploy
```

`--config /dev/null` on the namespace create is deliberate: wrangler refuses to run any command while the config carries an empty KV id, including the command that would fill it in. Secrets are set only at those interactive prompts, per the estate rule; `INFRA_REPORT_KEY` pairs with `/etc/specular-sentinel/env` on the machine and `RAG_REPORT_KEY` pairs with the corpus `.env`.

## Surface

`data/estate.manifest.json` is the canonical declared map of Atlas Systems. It lists the owned sites, Workers, local services, external dependencies, storage surfaces, public endpoints, metadata coverage, and dependency edges. The live registry shows what is currently discoverable; the manifest explains what the estate intends to own.

| Endpoint | What it is |
|---|---|
| `GET /v1` | Endpoint index |
| `GET /v1/docs` | Human documentation, served by the Worker itself so docs and code deploy atomically |
| `GET /v1/openapi.json` | The spec; the smoke suite walks every path in it against the router, so drift fails CI |
| `GET /v1/registry` | The estate registry via a service binding to [`atlas-api-index`](https://github.com/AtlasReaper311/atlas-api-index), reshaped into a stable v1 form |
| `GET /v1/search?q=` | RAG search proxied to the corpus tunnel; visitor IPs stop at the edge |
| `GET /v1/stats` | Repos, components, and uptime measured from live probes, labelled with when measurement began |
| `GET /v1/infra/status` | The sentinel pipeline's verdict; staleness recomputed at read time |
| `GET /v1/rag/stats` | Query counts only; terms and IPs stay out of public responses structurally |
| `GET /v1/badge/status` | Shields-flat SVG, `N/M operational` |
| `GET /v1/control-plane/summary` | Public, redacted `ControlPlaneSummary` for sensor-only consumers; unavailable until a schema-valid bounded read model exists |
| `GET /v1/control-plane/tools/openapi.json` | Bearer-protected OpenAPI 3.1 document containing exactly nine read-only Ramone operations |
| `GET /v1/control-plane/tools/**` | Nine allowlisted GET operations over the same bounded fixture/KV read model; no provider proxy or raw evidence fetch |
| `POST /v1/infra/report` | Sentinel ingest, bearer `INFRA_REPORT_KEY` |
| `POST /v1/rag/report` | Corpus summary ingest, bearer `RAG_REPORT_KEY` |
| `data/estate.manifest.json` | Canonical machine-readable estate manifest; repo ownership, lifecycle, layer, public surface, dependencies, and feeds |

## Operational notes

**Route layering.** `/v1*` is more specific than `atlas-notify`'s `/*` wildcard on the same hostname, so this Worker takes `/v1` traffic without unwiring anything. That layering rule is what lets one hostname host four Workers.

**The dead-man's switch.** The sentinel observes what only the machine can see and deliberately decides nothing; this Worker owns state, transitions, and severity. The `*/10` cron marks a silent sentinel down and alerts `#infra-health` once, because the one failure a local monitor can never report is its own death. Recovery announces itself on the next report.

**KV write policy.** Infra state writes per report (about 288 a day) so the card's "last checked" is truthful; uptime and estate snapshots write once per cron pass. The per-report choice is a deliberate post-Workers-Plus revisit of the estate's conditional-write default, documented in `decisions.md`.

**Rate limiting.** The Workers rate limit binding, per client IP: 60/min general, 10/min on `/v1/search` because each hit runs a real embedding on the 5070. Counters are per colo; that is the documented tradeoff of a zero-dependency limiter, not a surprise.

**Uptime honesty.** No uptime history existed anywhere in the estate (the status page is a live client-side checker), so `/v1/stats` accrues its own inside a rolling window and says when measurement began. Measured-since-deploy beats invented history.

**CSP.** The site already allowlists `https://api.atlas-systems.uk` in `connect-src` (see `atlas-systems/_headers`), so the Live Systems cards can read this surface without a header change; any new hostname would need adding there first.

## Development

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev
npm test          # node --test, no network
npm run lint
```

### Phase 9 fixture mode

The control-plane routes read either the injected test fixture or the single
bounded KV document at `control-plane:read-model:v1`. This phase adds no writer,
provider client, deployment, schedule, or automatic OpenWebUI assignment. If
the document is missing or fails leak/shape validation, the public summary and
tools return `503`; absence is never healthy.

```bash
npm test -- --test-name-pattern='control-plane'
```

Tests use a fixture-only bearer value. The future deployed connection uses the
secret name `RAMONE_CONTROL_PLANE_READ_TOKEN`; no value belongs in Git, model
context, request parameters, diagnostics, or logs. OpenWebUI will hold it in
an administrator-owned external-tool connection after a separate live
inventory and enablement approval.

The dedicated tool document is deliberately separate from `/v1/openapi.json`.
It contains exactly `GetEstateSummary`, `GetServiceStatus`,
`GetReleaseStatus`, `ListActiveFindings`, `GetQuotaProjection`,
`GetBackupStatus`, `ListGardenerProposals`, `FindRunbook`, and
`SearchEvidence`. See
[`docs/control-plane-tool-server.md`](docs/control-plane-tool-server.md) and
the [unavailable-read-model runbook](docs/runbooks/control-plane-read-model-unavailable.md).

## How it fits into Atlas Systems

This is where the estate faces outward. It ingests from [`specular-sentinel`](https://github.com/AtlasReaper311/specular-sentinel) and [`atlas-corpus`](https://github.com/AtlasReaper311/atlas-corpus), reads [`atlas-api-index`](https://github.com/AtlasReaper311/atlas-api-index), [`github-pulse`](https://github.com/AtlasReaper311/github-pulse), and [`specular-telemetry`](https://github.com/AtlasReaper311/specular-telemetry) over service bindings, alerts through [`atlas-notify`](https://github.com/AtlasReaper311/atlas-notify)'s signal-class routing, and feeds the Live Systems cards on [atlas-systems.uk/lab](https://atlas-systems.uk/lab/) plus the profile badge.

The transferable principle: a public API earns trust by documenting its own failure modes, so build the honest 503 and the measured uptime window before the happy path gets polished.

---

Part of [atlas-systems.uk](https://atlas-systems.uk)
