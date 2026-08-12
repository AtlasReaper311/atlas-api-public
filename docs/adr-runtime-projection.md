# ADR runtime Trace projection

## Purpose

`data/adr-runtime-index.json` is the deterministic ADR-to-runtime projection
consumed by public Trace and the Proof Chain surface.

`data/adr-trace-authority.json` pins the exact `AtlasReaper311/atlas-infra`
commit that produced that projection. CI checks out that commit and verifies the
projection byte-for-byte.

`atlas-infra/docs/adrs/` remains the decision authority. These files are only a
validated projection plus pin. They are not a second place to author architecture
decisions.

## Refresh behaviour

`.github/workflows/adr-runtime-projection.yml` refreshes:

- `data/adr-runtime-index.json`
- `data/adr-trace-authority.json`

It does not modify workflow YAML, so the default `GITHUB_TOKEN` can open the
draft pull request without `workflows` permission.

Triggers:

- `workflow_dispatch` with an optional exact `authority_sha`
- `repository_dispatch` with type `adr-runtime-projection` and optional
  `client_payload.authority_sha`

When no SHA is supplied, the workflow uses current `AtlasReaper311/atlas-infra`
`main`.

The workflow validates the emitted projection, runs Trace tests, then opens or
updates a **draft** pull request on `automation/adr-runtime-projection`. It does
not merge the pull request and it does not deploy the Worker.

An unchanged projection and pin produce no commit and no pull request update.

## Local refresh

```bash
node scripts/refresh-adr-runtime-index.mjs \
  --authority-root /path/to/atlas-infra \
  --authority-sha <full-40-char-sha>

node scripts/verify-adr-runtime-index.mjs \
  data/adr-runtime-index.json \
  /tmp/adr-runtime-index.json

npm test
```

## Upstream dispatch

`atlas-infra` may dispatch this workflow after ADR authority changes land on
`main`. That path requires a fine-grained token stored as
`ATLAS_API_PUBLIC_DISPATCH_TOKEN` in `atlas-infra` with:

- repository: `AtlasReaper311/atlas-api-public`
- permissions: `Actions: write`, `Metadata: read`

Preferred call shape is `workflow_dispatch` against
`adr-runtime-projection.yml`.

## Rollback

Revert the focused projection pull request or restore the previous
`data/adr-runtime-index.json` and `data/adr-trace-authority.json` together. Do
not edit relationship fingerprints by hand.
