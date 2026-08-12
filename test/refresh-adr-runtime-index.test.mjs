import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAuthoritySha,
  parseArgs,
  readCurrentTraceAuthorityPin,
  refreshAdrRuntimeIndex,
  updateTraceAuthorityPin,
} from "../scripts/refresh-adr-runtime-index.mjs";

const SAMPLE_WORKFLOW = `name: CI
jobs:
  test:
    steps:
      - name: Check out pinned Atlas Infra Worker contract validator
        with:
          ref: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
          path: .atlas-infra-contracts
      - name: Check out exact Atlas Infra ADR Trace authority
        # Pin must be the atlas-infra commit that produced data/adr-runtime-index.json.
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.0, Node 24
        with:
          repository: AtlasReaper311/atlas-infra
          ref: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
          path: .trace-authority
          persist-credentials: false
`;

test("authority SHA must be a full lowercase commit hash", () => {
  assert.equal(
    assertAuthoritySha("adfefd380730656f99ff9e832a27d4877a7b11d2"),
    "adfefd380730656f99ff9e832a27d4877a7b11d2",
  );
  assert.throws(() => assertAuthoritySha("adfefd3"), /40-character/);
  assert.throws(() => assertAuthoritySha("ADFEFD380730656F99FF9E832A27D4877A7B11D2"), /40-character/);
});

test("Trace pin updater only rewrites the .trace-authority checkout", () => {
  const next = updateTraceAuthorityPin(
    SAMPLE_WORKFLOW,
    "cccccccccccccccccccccccccccccccccccccccc",
  );
  assert.match(
    next,
    /ref: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\s+path: \.atlas-infra-contracts/,
  );
  assert.match(
    next,
    /ref: cccccccccccccccccccccccccccccccccccccccc\n\s+path: \.trace-authority/,
  );
  assert.equal(
    readCurrentTraceAuthorityPin(next),
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
      ciWorkflow: ".github/workflows/ci.yml",
      checkOnly: true,
    },
  );
});

test("refresh writes projection and pin only when they drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adr-runtime-refresh-"));
  const output = path.join(root, "data", "adr-runtime-index.json");
  const workflow = path.join(root, ".github", "workflows", "ci.yml");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(workflow), { recursive: true });
  fs.writeFileSync(output, '{"schema_version":"old"}\n', "utf8");
  fs.writeFileSync(workflow, SAMPLE_WORKFLOW, "utf8");

  const emitted = '{"schema_version":"atlas-control-plane/adr-runtime-index/v1","relationships":[]}\n';
  const first = refreshAdrRuntimeIndex({
    repoRoot: root,
    authorityRoot: "authority",
    authoritySha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    outputPath: output,
    ciWorkflowPath: workflow,
    emit: () => emitted,
  });

  assert.equal(first.changed, true);
  assert.equal(first.projectionChanged, true);
  assert.equal(first.pinChanged, true);
  assert.equal(fs.readFileSync(output, "utf8"), emitted);
  assert.equal(
    readCurrentTraceAuthorityPin(fs.readFileSync(workflow, "utf8")),
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  );

  const second = refreshAdrRuntimeIndex({
    repoRoot: root,
    authorityRoot: "authority",
    authoritySha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    outputPath: output,
    ciWorkflowPath: workflow,
    emit: () => emitted,
  });
  assert.equal(second.changed, false);
  assert.equal(second.projectionChanged, false);
  assert.equal(second.pinChanged, false);
});
