import fs from "node:fs";

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function load(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const [projectionPath, authorityPath] = process.argv.slice(2);
if (!projectionPath || !authorityPath) {
  throw new Error(
    "usage: node scripts/verify-adr-runtime-index.mjs <projection> <authority>",
  );
}

const projection = sortValue(load(projectionPath));
const authority = sortValue(load(authorityPath));
const left = JSON.stringify(projection);
const right = JSON.stringify(authority);

if (left !== right) {
  throw new Error(
    "data/adr-runtime-index.json does not match the pinned Atlas Infra ADR projection",
  );
}

console.log("ADR runtime projection matches pinned Atlas Infra authority");
