# ADR runtime Trace projection

## Purpose

`data/adr-runtime-index.json` is the deterministic ADR-to-runtime projection
consumed by public Trace and the Proof Chain surface.

`atlas-infra/docs/adrs/` remains the decision authority. This file is only a
validated projection of accepted ADR frontmatter. It is not a second place to
author architecture decisions.

## Refresh behaviour

`.github/workflows/adr-runtime-projection.yml` refreshes:

- `data/adr-runtime-index.json`
- the exact Trace authority pin in `.github/workflows/ci.yml`

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
python3 /path/to/atlas-infra/scripts/adr_trace.py emit \
  --root /path/to/atlas-infra \
  --output /tmp/adr-runtime-index.json

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

Preferred call shape is `workflow_dispatch`. `repository_dispatch` remains
supported for compatibility but needs `Contents: write` on this repository.

## Rollback

Revert the focused projection pull request or restore the previous
`data/adr-runtime-index.json` and CI pin together. Do not edit relationship
fingerprints by hand.
