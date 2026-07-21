#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const EXPECTED_SCHEMA = "atlas-public-repository-classifications/projection/v1";
const EXPECTED_AUTHORITY = "AtlasReaper311/atlas-infra";
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

export function readProjection(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function validateProjection(projection, label = "projection") {
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error(`${label} must be a JSON object`);
  }

  if (projection.schema_version !== EXPECTED_SCHEMA) {
    throw new Error(`${label} has unsupported schema_version`);
  }

  if (projection.authority !== EXPECTED_AUTHORITY) {
    throw new Error(`${label} has unexpected classification authority`);
  }

  if (!FINGERPRINT.test(String(projection.source_fingerprint || ""))) {
    throw new Error(`${label} has invalid source_fingerprint`);
  }

  if (!Array.isArray(projection.repositories)) {
    throw new Error(`${label}.repositories must be an array`);
  }

  if (projection.repository_count !== projection.repositories.length) {
    throw new Error(`${label}.repository_count does not match repositories length`);
  }

  const seen = new Set();
  let previous = null;

  for (const item of projection.repositories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${label} contains a non-object repository entry`);
    }

    const repository = item.repository;
    if (
      typeof repository !== "string" ||
      !/^AtlasReaper311\/[A-Za-z0-9._-]+$/.test(repository)
    ) {
      throw new Error(`${label} contains a malformed repository identity`);
    }

    if (seen.has(repository)) {
      throw new Error(`${label} contains duplicate repository ${repository}`);
    }

    if (previous !== null && previous.localeCompare(repository) > 0) {
      throw new Error(`${label} repository entries are not deterministically sorted`);
    }

    if (!new Set(["production", "active", "experimental", "deprecated", "archived"]).has(item.lifecycle)) {
      throw new Error(`${label} has invalid lifecycle for ${repository}`);
    }

    if (!new Set(["public", "internal"]).has(item.scope)) {
      throw new Error(`${label} has invalid scope for ${repository}`);
    }

    if (!new Set(["original", "external-derived"]).has(item.provenance)) {
      throw new Error(`${label} has invalid provenance for ${repository}`);
    }

    if (typeof item.runtime_service !== "boolean") {
      throw new Error(`${label} has invalid runtime_service for ${repository}`);
    }

    seen.add(repository);
    previous = repository;
  }
}

function canonical(value) {
  return JSON.stringify(value);
}

export function verifyProjection(localProjection, upstreamProjection) {
  validateProjection(localProjection, "local classification projection");
  validateProjection(upstreamProjection, "Atlas Infra classification projection");

  if (canonical(localProjection) !== canonical(upstreamProjection)) {
    throw new Error(
      "local classification projection differs from AtlasReaper311/atlas-infra main",
    );
  }
}

function main() {
  const [localArg, upstreamArg] = process.argv.slice(2);
  if (!localArg || !upstreamArg) {
    throw new Error(
      "usage: verify-repository-classifications.mjs <local-projection> <atlas-infra-projection>",
    );
  }

  const localPath = path.resolve(localArg);
  const upstreamPath = path.resolve(upstreamArg);
  const localProjection = readProjection(localPath);
  const upstreamProjection = readProjection(upstreamPath);

  verifyProjection(localProjection, upstreamProjection);
  console.log(
    `classification projection verified: ${localProjection.repository_count} repositories (${localProjection.source_fingerprint})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
