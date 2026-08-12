#!/usr/bin/env node
/**
 * Refresh the vendored Atlas Trace ADR projection from an exact atlas-infra tree.
 *
 * Ownership:
 * - atlas-infra docs/adrs remains the decision authority
 * - data/adr-runtime-index.json is a deterministic projection only
 * - .github/workflows/ci.yml Trace authority pin must match the emitted projection
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
const TRACE_PIN_BLOCK =
  /(name:\s*Check out exact Atlas Infra ADR Trace authority[\s\S]*?\n\s+ref:\s*)([0-9a-f]{40})(\n\s+path:\s*\.trace-authority\b)/;

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    authorityRoot: null,
    authoritySha: null,
    output: "data/adr-runtime-index.json",
    ciWorkflow: ".github/workflows/ci.yml",
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
    } else if (arg === "--ci-workflow") {
      options.ciWorkflow = next;
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

export function updateTraceAuthorityPin(workflowText, authoritySha) {
  const sha = assertAuthoritySha(authoritySha);
  if (!TRACE_PIN_BLOCK.test(workflowText)) {
    throw new Error(
      "CI workflow is missing the exact Atlas Infra ADR Trace authority pin block",
    );
  }
  return workflowText.replace(TRACE_PIN_BLOCK, `$1${sha}$3`);
}

export function readCurrentTraceAuthorityPin(workflowText) {
  const match = workflowText.match(TRACE_PIN_BLOCK);
  if (!match) {
    throw new Error(
      "CI workflow is missing the exact Atlas Infra ADR Trace authority pin block",
    );
  }
  return match[2];
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
  ciWorkflowPath,
  checkOnly = false,
  emit = emitAuthorityIndex,
}) {
  const sha = assertAuthoritySha(authoritySha);
  const absoluteAuthorityRoot = resolvePath(repoRoot, authorityRoot);
  const absoluteOutput = resolvePath(repoRoot, outputPath);
  const absoluteWorkflow = resolvePath(repoRoot, ciWorkflowPath);

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

  const currentProjection = readTextOrEmpty(absoluteOutput);
  const currentWorkflow = fs.readFileSync(absoluteWorkflow, "utf8");
  const currentPin = readCurrentTraceAuthorityPin(currentWorkflow);
  const nextWorkflow = updateTraceAuthorityPin(currentWorkflow, sha);

  const projectionChanged = currentProjection !== emitted;
  const pinChanged = currentPin !== sha;
  const changed = projectionChanged || pinChanged;

  if (checkOnly) {
    return {
      changed,
      projectionChanged,
      pinChanged,
      authoritySha: sha,
      currentPin,
      outputPath: absoluteOutput,
      ciWorkflowPath: absoluteWorkflow,
    };
  }

  if (projectionChanged) {
    writeTextAtomic(absoluteOutput, emitted);
  }
  if (pinChanged) {
    writeTextAtomic(absoluteWorkflow, nextWorkflow);
  }

  return {
    changed,
    projectionChanged,
    pinChanged,
    authoritySha: sha,
    currentPin,
    outputPath: absoluteOutput,
    ciWorkflowPath: absoluteWorkflow,
  };
}

function printHelp() {
  console.log(`usage:
  node scripts/refresh-adr-runtime-index.mjs \\
    --authority-root <atlas-infra-checkout> \\
    --authority-sha <40-char-sha> \\
    [--output data/adr-runtime-index.json] \\
    [--ci-workflow .github/workflows/ci.yml] \\
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
    ciWorkflowPath: options.ciWorkflow,
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
