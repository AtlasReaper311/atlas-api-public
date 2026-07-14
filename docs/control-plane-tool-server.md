# Ramone control-plane tool server

## Ownership and boundary

`atlas-api-public` owns the external HTTPS read surface because its existing
Worker already owns the versioned bounded API, rate limiting, public/private
response boundary, and KV read model. `atlas-infra` owns the operation policy,
summary contract, generated fixture, rollout gates, and rollback guidance.

This is an additive route group in the existing service, not a new service or
provider proxy. Phase 9 does not deploy it or write the KV read model.

## Data source

The route module accepts one bounded object:

- tests inject `CONTROL_PLANE_FIXTURES` as an in-memory object;
- a future reviewed producer may place the same object at
  `control-plane:read-model:v1` in the existing `ATLAS_PUBLIC_KV` namespace.

The route code performs no GitHub, Cloudflare, Home Assistant, backup, SSH, or
arbitrary HTTP call. It performs no KV write. Missing or invalid data returns
`503` and is never projected as healthy. Response objects use positive field
allowlists and approved public reference origins; an expired KV document is
reclassified as stale at read time.

## Authentication

The public summary needs no credential and contains aggregate fields only.
Every `/v1/control-plane/tools/**` route, including the dedicated OpenAPI
document, requires `RAMONE_CONTROL_PLANE_READ_TOKEN` as a bearer. The token has
no provider scope. OpenWebUI will hold it later; the model must not receive it.
Tests use a fixture-only token.

## Exact operations

- `GetEstateSummary`
- `GetServiceStatus`
- `GetReleaseStatus`
- `ListActiveFindings`
- `GetQuotaProjection`
- `GetBackupStatus`
- `ListGardenerProposals`
- `FindRunbook`
- `SearchEvidence`

All are GET operations with allowlisted parameters and bounded results.
Runbook search returns summaries/references without diagnostic command text.
Evidence search returns metadata/references without dereferencing a payload.

## Failure behavior

- missing/wrong bearer: `401`;
- undeclared filter or invalid bound: `400`;
- write method: `405`;
- missing, malformed, private, or secret-bearing read model: `503`;
- valid non-healthy source: `200` with its explicit state;
- oversized result: `503` with a narrowing hint.

See the focused runbook for triage. Do not add a fallback fetch, provider call,
raw evidence response, Home Assistant action, or write operation to make an
unavailable result appear successful.

## Local validation

```bash
npm test
npm run lint
node --check src/routes/control-plane.js
node --check src/control-plane-openapi.js
```

No live endpoint, provider account, secret, or Worker deployment is required.
