# Phase G: Public Interface V2 conformance

## Outcome

Declare the human Public API documentation surface through the accepted
`atlas-control-plane/public-interface-surface/v1` manifest and validate it
against a pinned, merged `atlas-infra` authority.

This is a nonvisual governance adoption. It does not change OpenAPI authority,
Worker routes, bindings, public schemas, live topology evidence, deployment, or
provider configuration.

## Boundary

The declaration covers `https://api.atlas-systems.uk/v1/docs`. OpenAPI, JSON
API, health, metadata, topology, trace, and badge responses remain
machine-facing and outside the browser interface contract.

## Authority and evidence

- authority commit: `e40d5a5cee6001df17918f69700aebb85d3d1cdd`;
- declaration: `.atlas/public-interface.json`;
- validator: `atlas-infra/scripts/validate_public_interface.py`;
- evidence retention: 14 days.

The conformance job is read-only, validates the exact candidate commit, verifies
the pinned authority SHA, and fails closed if the manifest repository identity
does not match the caller.

## Local validation

```bash
python3 ../atlas-infra/scripts/validate_public_interface.py \
  --root ../atlas-infra \
  --manifest .atlas/public-interface.json
```

## Rollback

Revert the Phase G commit. The Worker and its production deployment are not
changed by the conformance declaration.
