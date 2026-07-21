# Repository classification projection

## Authority

`atlas-api-public` does not author repository lifecycle, scope, or provenance.
Those axes are owned by `AtlasReaper311/atlas-infra` and published there as
`policy/public-repository-classifications.json`.

This repository vendors that projection at
`data/public-repository-classifications.json` so the Worker has a deterministic,
offline classification input at build and runtime. The vendored file is a
projection, not a second authority.

## Public topology inputs

`GET /v1/topology` combines three independent inputs with different jobs:

1. `data/estate.manifest.json` owns declared public topology and presentation
   metadata such as component kind, layer, URLs, dependency edges, and notes.
2. `data/public-repositories.json` provides the current public repository
   membership/visibility projection. Inventory maintenance is handled
   separately from classification authority.
3. `data/public-repository-classifications.json` provides lifecycle, scope,
   provenance, and whether the repository owns a runtime service.

For repository-backed components, classification values from the Atlas Infra
projection override any legacy lifecycle value still present in the manually
maintained manifest. Inventory-only repositories also receive classification
from the same projection rather than defaulting to `production`.

A repository-backed component is published only when both conditions are true:

- the repository is present as public in the public repository inventory; and
- the repository has an authoritative Atlas Infra classification whose
  lifecycle is not deprecated or archived.

Missing classification fails closed. A public repository appearing in GitHub
inventory is therefore not sufficient on its own to enter public topology.

Repo-less components remain governed as explicit component declarations in the
manifest because repository classification does not apply to them.

## Drift verification

Pull-request CI checks out `AtlasReaper311/atlas-infra` at `main` with a sparse
checkout of the classification projection and runs:

```bash
node scripts/verify-repository-classifications.mjs \
  data/public-repository-classifications.json \
  .classification-authority/policy/public-repository-classifications.json
```

The check validates the projection shape, deterministic repository ordering,
repository count, authority identity, and source fingerprint, then requires the
local projection to match Atlas Infra exactly. Classification changes therefore
require an explicit downstream refresh before `atlas-api-public` can pass CI.

No secret or provider credential is required for this check. The upstream file
is public and the workflow retains read-only repository permissions.

## Refresh procedure

When Atlas Infra classification changes:

1. update `data/public-repository-classifications.json` from the merged
   `atlas-infra/main` projection;
2. run `npm test` and `npm run lint`;
3. run the verifier against a clean checkout of `atlas-infra/main`;
4. open a reviewed pull request in `atlas-api-public`;
5. merge only with explicit owner approval because this repository deploys on
   pushes to `main`.

Do not edit the vendored lifecycle, scope, provenance, or runtime flags by hand
to make topology look correct. Correct the authority in Atlas Infra first, then
refresh the projection here.

## Deployment boundary

A merged source change is not proof of publication. `atlas-api-public` has a
push-to-main deployment workflow, so merge and live rollout remain separate
owner-controlled stages. Live verification is required after any approved
production rollout before the new topology should be considered published.
