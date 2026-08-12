#!/usr/bin/env node
/**
 * Refresh the vendored Atlas Trace ADR projection from an exact atlas-infra tree.
 *
 * Ownership:
 * - atlas-infra docs/adrs remains the decision authority
 * - data/adr-runtime-index.json is a deterministic projection only
 * - data/adr-trace-authority.json pins the exact atlas-infra commit for CI
 *
 * This script never merges, deploys, or mutates live state.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;
const AUTHORITY_SCHEMA = "atlas-public-trace-authority-pin/v1";
const AUTHORITY_REPOSITORY = "AtlasReaper311/atlas-infra";

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    authorityRoot: null,
    authoritySha: null,
    output: "data/adr-runtime-index.json",
    authorityPin: "data/adr-trace-authority.json",
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--authority-root") {
      options.authorityRoot = next;
      index += 1;
    } else if (arg === "--authority-sha") {
      options.authoritySha = next;
      index += 1;
    } else if (arg === "--output") {
      options.output = next;
      index += 1;
    } else if (arg === "--authority-pin") {
      options.authorityPin = next;
      index += 1;
    } else if (arg === "--check-only") {
      options.checkOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

export function assertAuthoritySha(sha) {
  if (!FULL_SHA.test(String(sha || ""))) {
    throw new Error("authority SHA must be a full lowercase 40-character commit hash");
  }
  return sha;
}

export function buildAuthorityPinDocument(authoritySha) {
  return {
    schema_version: AUTHORITY_SCHEMA,
    repository: AUTHORITY_REPOSITORY,
    authority_sha: assertAuthoritySha(authoritySha),
  };
}

export function serializeAuthorityPin(document) {
  return `${JSON.stringify(document)}\n`;
}

export function readAuthorityPin(fileContents) {
  const document = JSON.parse(fileContents);
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("authority pin must be a JSON object");
  }
  if (document.schema_version !== AUTHORITY_SCHEMA) {
    throw new Error("authority pin has unsupported schema_version");
  }
  if (document.repository !== AUTHORITY_REPOSITORY) {
    throw new Error("authority pin has unexpected repository");
  }
  return assertAuthoritySha(document.authority_sha);
}

function resolvePath(root, value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function emitAuthorityIndex(authorityRoot, temporaryOutput) {
  const emitter = path.join(authorityRoot, "scripts", "adr_trace.py");
  if (!fs.existsSync(emitter)) {
    throw new Error(`missing ADR emitter at ${emitter}`);
  }
  const result = spawnSync(
    process.env.PYTHON || "python3",
    [emitter, "emit", "--root", authorityRoot, "--output", temporaryOutput],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `adr_trace.py emit failed${detail ? `: ${detail}` : ` with status ${result.status}`}`,
    );
  }
  return fs.readFileSync(temporaryOutput, "utf8");
}

function readTextOrEmpty(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function writeTextAtomic(filePath, contents) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );
  fs.writeFileSync(temporaryPath, contents, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

export function refreshAdrRuntimeIndex({
  repoRoot,
  authorityRoot,
  authoritySha,
  outputPath,
  authorityPinPath,
  checkOnly = false,
  emit = emitAuthorityIndex,
}) {
  const sha = assertAuthoritySha(authoritySha);
  const absoluteAuthorityRoot = resolvePath(repoRoot, authorityRoot);
  const absoluteOutput = resolvePath(repoRoot, outputPath);
  const absolutePin = resolvePath(repoRoot, authorityPinPath);

  const temporaryOutput = path.join(
    os.tmpdir(),
    `atlas-adr-runtime-index-${process.pid}.json`,
  );
  let emitted;
  try {
    emitted = emit(absoluteAuthorityRoot, temporaryOutput);
  } finally {
    fs.rmSync(temporaryOutput, { force: true });
  }

  if (!emitted.endsWith("\n")) {
    emitted = `${emitted}\n`;
  }

  const nextPin = serializeAuthorityPin(buildAuthorityPinDocument(sha));
  const currentProjection = readTextOrEmpty(absoluteOutput);
  const currentPinContents = readTextOrEmpty(absolutePin);
  const currentPin = currentPinContents ? readAuthorityPin(currentPinContents) : "";

  const projectionChanged = currentProjection !== emitted;
  const pinChanged = currentPin !== sha || currentPinContents !== nextPin;
  const changed = projectionChanged || pinChanged;

  if (checkOnly) {
    return {
      changed,
      projectionChanged,
      pinChanged,
      authoritySha: sha,
      currentPin,
      outputPath: absoluteOutput,
      authorityPinPath: absolutePin,
    };
  }

  if (projectionChanged) {
    writeTextAtomic(absoluteOutput, emitted);
  }
  if (pinChanged) {
    writeTextAtomic(absolutePin, nextPin);
  }

  return {
    changed,
    projectionChanged,
    pinChanged,
    authoritySha: sha,
    currentPin,
    outputPath: absoluteOutput,
    authorityPinPath: absolutePin,
  };
}

function printHelp() {
  console.log(`usage:
  node scripts/refresh-adr-runtime-index.mjs \\
    --authority-root <atlas-infra-checkout> \\
    --authority-sha <40-char-sha> \\
    [--output data/adr-runtime-index.json] \\
    [--authority-pin data/adr-trace-authority.json] \\
    [--check-only]`);
}

function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.authorityRoot || !options.authoritySha) {
    printHelp();
    throw new Error("--authority-root and --authority-sha are required");
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = refreshAdrRuntimeIndex({
    repoRoot,
    authorityRoot: options.authorityRoot,
    authoritySha: options.authoritySha,
    outputPath: options.output,
    authorityPinPath: options.authorityPin,
    checkOnly: options.checkOnly,
  });

  console.log(
    JSON.stringify(
      {
        changed: result.changed,
        projection_changed: result.projectionChanged,
        pin_changed: result.pinChanged,
        authority_sha: result.authoritySha,
        previous_pin: result.currentPin,
        check_only: options.checkOnly,
      },
      null,
      2,
    ),
  );

  if (options.checkOnly && result.changed) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
