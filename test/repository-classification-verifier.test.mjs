import assert from "node:assert/strict";
import test from "node:test";

import {
  readProjection,
  validateProjection,
  verifyProjection,
} from "../scripts/verify-repository-classifications.mjs";

const localProjection = readProjection("data/public-repository-classifications.json");

test("vendored classification projection is structurally valid", () => {
  assert.doesNotThrow(() => validateProjection(localProjection));
});

test("identical authoritative projections verify", () => {
  assert.doesNotThrow(() =>
    verifyProjection(localProjection, structuredClone(localProjection)),
  );
});

test("classification drift fails verification", () => {
  const changed = structuredClone(localProjection);
  changed.repositories[0].lifecycle =
    changed.repositories[0].lifecycle === "active" ? "production" : "active";

  assert.throws(
    () => verifyProjection(localProjection, changed),
    /differs from AtlasReaper311\/atlas-infra main/,
  );
});

test("unsorted projections fail closed", () => {
  const changed = structuredClone(localProjection);
  [changed.repositories[0], changed.repositories[1]] = [
    changed.repositories[1],
    changed.repositories[0],
  ];

  assert.throws(
    () => validateProjection(changed),
    /not deterministically sorted/,
  );
});
