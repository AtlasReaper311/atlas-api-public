import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const OWNER = "AtlasReaper311";
export const SCHEMA = "atlas-public-repositories/v2";
export const OUTPUT = new URL("../data/public-repositories.json", import.meta.url);
export const BLOCKED = new Set(["simple-proxy"]);

function headers() {
  const result = {
    Accept: "application/vnd.github+json",
    "User-Agent": "atlas-api-public-repository-inventory",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return result;
}

async function fetchPage(page) {
  const url =
    `https://api.github.com/users/${OWNER}/repos` +
    `?type=owner&sort=full_name&direction=asc&per_page=100&page=${page}`;

  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`GitHub repository inventory failed: HTTP ${response.status}`);
  }

  return response.json();
}

export function compareRepositoryNames(a, b) {
  const aFolded = a.name.toLowerCase();
  const bFolded = b.name.toLowerCase();
  if (aFolded < bFolded) return -1;
  if (aFolded > bFolded) return 1;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

export function normaliseRepository(repository) {
  return {
    name: repository.name,
    full_name: repository.full_name,
    html_url: repository.html_url,
    description: repository.description || "",
    homepage: repository.homepage || null,
    language: repository.language || null,
    topics: Array.isArray(repository.topics)
      ? repository.topics.slice().sort()
      : [],
    fork: repository.fork === true,
    archived: repository.archived === true,
    disabled: repository.disabled === true,
    visibility: repository.visibility,
    created_at: repository.created_at,
  };
}

function canonicalise(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

export function inventoryFingerprint(repositories) {
  const canonical = JSON.stringify(canonicalise(repositories));
  return `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}

export function buildPublicRepositoryInventory(repositories) {
  if (!Array.isArray(repositories)) {
    throw new TypeError("GitHub repository inventory must be an array");
  }

  const publicRepositories = repositories
    .filter((repository) => repository?.owner?.login === OWNER)
    .filter((repository) => repository.private !== true)
    .filter((repository) => repository.visibility === "public")
    .filter((repository) => repository.archived !== true)
    .filter((repository) => repository.disabled !== true)
    .filter((repository) => !BLOCKED.has(repository.name))
    .map(normaliseRepository)
    .sort(compareRepositoryNames);

  return {
    schema: SCHEMA,
    owner: OWNER,
    repository_count: publicRepositories.length,
    inventory_fingerprint: inventoryFingerprint(publicRepositories),
    repositories: publicRepositories,
  };
}

export function renderInventory(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function fetchAllRepositories() {
  const repositories = [];
  let page = 1;

  while (true) {
    const batch = await fetchPage(page);
    if (!Array.isArray(batch)) {
      throw new TypeError("GitHub repository page must be an array");
    }
    if (batch.length === 0) break;

    repositories.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return repositories;
}

async function main() {
  const repositories = await fetchAllRepositories();
  const document = buildPublicRepositoryInventory(repositories);
  await fs.writeFile(OUTPUT, renderInventory(document), "utf8");
  console.log(
    `Wrote ${document.repository_count} public repositories (${document.inventory_fingerprint}).`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
