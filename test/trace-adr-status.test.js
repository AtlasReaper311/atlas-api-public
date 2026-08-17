import assert from "node:assert/strict";
import test from "node:test";

import {
  isActivePublicAdrRelationship,
  isValidAdrRelationship,
} from "../src/routes/trace.js";

function relationship(status, visibility = "public") {
  return {
    schema_version: "atlas-control-plane/adr-runtime-relationship/v1",
    relationship_id: `adrrel:sha256:${"a".repeat(64)}`,
    adr: {
      id: "ADR-0010",
      status,
    },
    visibility,
  };
}

test("Trace accepts all contract-valid ADR statuses", () => {
  for (const status of ["proposed", "accepted", "superseded"]) {
    assert.equal(isValidAdrRelationship(relationship(status)), true);
  }

  assert.equal(isValidAdrRelationship(relationship("retired")), false);
});

test("Trace exposes only accepted public ADRs as active governance", () => {
  assert.equal(isActivePublicAdrRelationship(relationship("accepted")), true);
  assert.equal(isActivePublicAdrRelationship(relationship("proposed")), false);
  assert.equal(isActivePublicAdrRelationship(relationship("superseded")), false);
  assert.equal(
    isActivePublicAdrRelationship(relationship("accepted", "internal")),
    false,
  );
});
