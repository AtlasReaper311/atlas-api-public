# Public repository inventory

## Purpose

`data/public-repositories.json` is the deterministic public repository membership projection consumed by `/v1/topology`.

It answers a narrow question: which non-archived public repositories owned by `AtlasReaper311` are eligible to participate in the public topology projection, together with stable descriptive metadata needed by that projection.

It is not an activity feed and it is not a classification authority.

- repository lifecycle, scope, provenance, and runtime-service classification come from the vendored Atlas Infra classification projection;
- live GitHub activity belongs to `github-pulse`;
- private repository governance remains source-owned and never enters this public file.

## Deterministic v2 contract

The v2 document deliberately excludes volatile activity fields:

- no `generated_at`;
- no repository `updated_at`;
- no repository `pushed_at`.

A normal push therefore does not change the inventory. The scheduled workflow opens or refreshes a pull request only when public membership or retained stable metadata changes.

The document contains a SHA-256 `inventory_fingerprint` over the canonical repository array. Repository order is deterministic and topics are sorted before hashing.

## Inclusion rules

A repository is included only when all of the following are true:

- owner is exactly `AtlasReaper311`;
- repository is not private;
- visibility is `public`;
- repository is not archived;
- repository is not disabled;
- repository is not on the explicit publication blocklist.

Unknown or non-public repositories fail closed.

## Refresh behaviour

`.github/workflows/public-repository-inventory.yml` runs the generator, then executes lint and the full test suite before considering a pull request.

An unchanged deterministic document produces no commit and no pull request update. Membership additions, removals, archival changes, visibility changes, or retained descriptive metadata changes produce a reviewable diff.

The workflow may create or update `automation/public-repository-inventory`; it does not merge the pull request and it does not itself deploy the Worker.

## Validation

`test/public-repository-inventory.test.mjs` proves that:

- activity-only timestamp changes produce byte-identical output;
- membership additions and removals change the fingerprint;
- private, archived, disabled, blocked, and wrong-owner repositories are excluded;
- repository ordering and topics are deterministic;
- the committed v2 inventory contains no volatile activity timestamps and has a valid fingerprint.

## Rollback

Revert the focused inventory-stability change if the projection becomes incompatible with a consumer. Do not restore push timestamps as a freshness signal. Repository activity should remain in `github-pulse`, while this file remains a membership projection.
