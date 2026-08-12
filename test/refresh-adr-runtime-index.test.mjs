import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAuthoritySha,
  buildAuthorityPinDocument,
  parseArgs,
  readAuthorityPin,
  refreshAdrRuntimeIndex,
  serializeAuthorityPin,
} from "../scripts/refresh-adr-runtime-index.mjs";

test("authority SHA must be a full lowercase commit hash", () => {
  assert.equal(
    assertAuthoritySha("adfefd380730656f99ff9e832a27d4877a7b11d2"),
    "adfefd380730656f99ff9e832a27d4877a7b11d2",
  );
  assert.throws(() => assertAuthoritySha("adfefd3"), /40-character/);
  assert.throws(
    () => assertAuthoritySha("ADFEFD380730656F99FF9E832A27D4877A7B11D2"),
    /40-character/,
  );
});

test("authority pin document is deterministic", () => {
  const document = buildAuthorityPinDocument(
    "cccccccccccccccccccccccccccccccccccccccc",
  );
  assert.deepEqual(document, {
    schema_version: "atlas-public-trace-authority-pin/v1",
    repository: "AtlasReaper311/atlas-infra",
    authority_sha: "cccccccccccccccccccccccccccccccccccccccc",
  });
  assert.equal(
    readAuthorityPin(serializeAuthorityPin(document)),
    "cccccccccccccccccccccccccccccccccccccccc",
  );
});

test("parseArgs accepts refresh and check-only flags", () => {
  assert.deepEqual(
    parseArgs([
      "--authority-root",
      ".trace-authority",
      "--authority-sha",
      "dddddddddddddddddddddddddddddddddddddddd",
      "--check-only",
    ]),
    {
      authorityRoot: ".trace-authority",
      authoritySha: "dddddddddddddddddddddddddddddddddddddddd",
      output: "data/adr-runtime-index.json",
      authorityPin: "data/adr-trace-authority.json",
      checkOnly: true,
    },
  );
});

test("refresh writes projection and pin only when they drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr-runtime-refresh-"));
  const output = path.join(root, "data", "adr-runtime-index.json");
  const pin = path.join(root, "data", "adr-trace-authority.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, '{"schema_version":"old"}\n', "utf8");
  fs.writeFileSync(
    pin,
    serializeAuthorityPin(
      buildAuthorityPinDocument("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    ),
    "utf8",
  );

  const emitted =
    '{"schema_version":"atlas-control-plane/adr-runtime-index/v1","relationships":[]}\n';
  const first = refreshAdrRuntimeIndex({
    repoRoot: root,
    authorityRoot: "authority",
    authoritySha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    outputPath: output,
    authorityPinPath: pin,
    emit: () => emitted,
  });

  assert.equal(first.changed, true);
  assert.equal(first.projectionChanged, true);
  assert.equal(first.pinChanged, true);
  assert.equal(fs.readFileSync(output, "utf8"), emitted);
  assert.equal(
    readAuthorityPin(fs.readFileSync(pin, "utf8")),
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  );

  const second = refreshAdrRuntimeIndex({
    repoRoot: root,
    authorityRoot: "authority",
    authoritySha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    outputPath: output,
    authorityPinPath: pin,
    emit: () => emitted,
  });
  assert.equal(second.changed, false);
  assert.equal(second.projectionChanged, false);
  assert.equal(second.pinChanged, false);
});
