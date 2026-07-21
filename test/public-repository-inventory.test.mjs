import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  buildPublicRepositoryInventory,
  inventoryFingerprint,
  renderInventory,
} from "../scripts/sync_public_repositories.mjs";

function repository(name, overrides = {}) {
  return {
    name,
    full_name: `AtlasReaper311/${name}`,
    html_url: `https://github.com/AtlasReaper311/${name}`,
    description: "Example repository",
    homepage: null,
    language: "JavaScript",
    topics: ["zeta", "alpha"],
    fork: false,
    archived: false,
    disabled: false,
    visibility: "public",
    private: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    pushed_at: "2026-07-20T00:00:00Z",
    owner: { login: "AtlasReaper311" },
    ...overrides,
  };
}

test("activity-only GitHub changes do not change the inventory", () => {
  const first = buildPublicRepositoryInventory([
    repository("atlas-example"),
  ]);
  const second = buildPublicRepositoryInventory([
    repository("atlas-example", {
      updated_at: "2026-07-21T12:00:00Z",
      pushed_at: "2026-07-21T12:00:00Z",
    }),
  ]);

  assert.equal(renderInventory(first), renderInventory(second));
  assert.equal(first.inventory_fingerprint, second.inventory_fingerprint);
  assert.equal("generated_at" in first, false);
  assert.equal("updated_at" in first.repositories[0], false);
  assert.equal("pushed_at" in first.repositories[0], false);
});

test("membership additions and removals change the projection", () => {
  const one = buildPublicRepositoryInventory([repository("atlas-one")]);
  const two = buildPublicRepositoryInventory([
    repository("atlas-one"),
    repository("atlas-two"),
  ]);

  assert.equal(one.repository_count, 1);
  assert.equal(two.repository_count, 2);
  assert.notEqual(one.inventory_fingerprint, two.inventory_fingerprint);
});

test("private archived disabled and blocked repositories fail closed", () => {
  const inventory = buildPublicRepositoryInventory([
    repository("atlas-public"),
    repository("private-repository", { private: true, visibility: "private" }),
    repository("archived-repository", { archived: true }),
    repository("disabled-repository", { disabled: true }),
    repository("simple-proxy"),
    repository("wrong-owner", { owner: { login: "SomeoneElse" } }),
  ]);

  assert.deepEqual(
    inventory.repositories.map((item) => item.name),
    ["atlas-public"],
  );
});

test("repository ordering and topics are deterministic", () => {
  const inventory = buildPublicRepositoryInventory([
    repository("deploy-watch"),
    repository("AtlasReaper311"),
    repository("atlas-api-public"),
  ]);

  assert.deepEqual(
    inventory.repositories.map((item) => item.name),
    ["atlas-api-public", "AtlasReaper311", "deploy-watch"],
  );
  assert.deepEqual(inventory.repositories[0].topics, ["alpha", "zeta"]);
});

test("committed inventory is v2, private-safe and fingerprint-valid", async () => {
  const document = JSON.parse(
    await fs.readFile(new URL("../data/public-repositories.json", import.meta.url), "utf8"),
  );

  assert.equal(document.schema, "atlas-public-repositories/v2");
  assert.equal(document.owner, "AtlasReaper311");
  assert.equal(document.repository_count, document.repositories.length);
  assert.equal(document.repository_count, 31);
  assert.equal(
    document.inventory_fingerprint,
    inventoryFingerprint(document.repositories),
  );

  for (const item of document.repositories) {
    assert.equal(item.visibility, "public");
    assert.equal(item.archived, false);
    assert.equal(item.disabled, false);
    assert.equal("updated_at" in item, false);
    assert.equal("pushed_at" in item, false);
  }
});
