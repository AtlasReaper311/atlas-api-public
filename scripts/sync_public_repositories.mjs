import fs from "node:fs/promises";

const OWNER = "AtlasReaper311";
const OUTPUT = new URL("../data/public-repositories.json", import.meta.url);
const BLOCKED = new Set(["simple-proxy"]);

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

  const response = await fetch(url, {
    headers: headers(),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub repository inventory failed: HTTP ${response.status}`,
    );
  }

  return response.json();
}

function normalise(repository) {
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
    visibility: repository.visibility || "public",
    created_at: repository.created_at,
    updated_at: repository.updated_at,
    pushed_at: repository.pushed_at,
  };
}

const repositories = [];
let page = 1;

while (true) {
  const batch = await fetchPage(page);

  if (!Array.isArray(batch) || batch.length === 0) {
    break;
  }

  repositories.push(...batch);

  if (batch.length < 100) {
    break;
  }

  page += 1;
}

const publicRepositories = repositories
  .filter((repository) => repository.owner?.login === OWNER)
  .filter((repository) => repository.private !== true)
  .filter((repository) => repository.visibility === "public")
  .filter((repository) => repository.archived !== true)
  .filter((repository) => repository.disabled !== true)
  .filter((repository) => !BLOCKED.has(repository.name))
  .map(normalise)
  .sort((a, b) => a.name.localeCompare(b.name));

const document = {
  schema: "atlas-public-repositories/v1",
  owner: OWNER,
  generated_at: new Date().toISOString(),
  count: publicRepositories.length,
  repositories: publicRepositories,
};

await fs.writeFile(
  OUTPUT,
  `${JSON.stringify(document, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${publicRepositories.length} public repositories.`);
